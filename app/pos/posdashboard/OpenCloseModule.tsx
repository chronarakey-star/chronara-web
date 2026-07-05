"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../../utils/supabase";

interface OpenCloseProps {
  companyId: string;
  storeId: string;
  tillId: string;
  tillName: string;
  themeColor: string;
  user: any;
  setActiveModule: (module: string) => void;
}

const DENOMINATIONS = [
  { label: "$100 Bills", mult: 100.0 },
  { label: "$50 Bills", mult: 50.0 },
  { label: "$20 Bills", mult: 20.0 },
  { label: "$10 Bills", mult: 10.0 },
  { label: "$5 Bills", mult: 5.0 },
  { label: "$2 Coins", mult: 2.0 },
  { label: "$1 Coins", mult: 1.0 },
  { label: "25¢ Quarters", mult: 0.25 },
  { label: "10¢ Dimes", mult: 0.10 },
  { label: "5¢ Nickels", mult: 0.05 }
];

// --- TIMEZONE HELPERS ---
const getStoreTimezone = (province: string, isAllStores: boolean) => {
    if (isAllStores) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    const map: Record<string, string> = {
        'BC': 'America/Vancouver',
        'AB': 'America/Edmonton', 'NT': 'America/Edmonton',
        'SK': 'America/Regina',
        'MB': 'America/Winnipeg',
        'ON': 'America/Toronto', 'QC': 'America/Toronto', 'NU': 'America/Toronto',
        'NB': 'America/Halifax', 'NS': 'America/Halifax', 'PE': 'America/Halifax',
        'NL': 'America/St_Johns',
        'YT': 'America/Whitehorse'
    };
    return map[province?.toUpperCase()] || Intl.DateTimeFormat().resolvedOptions().timeZone;
};

const normalizeProvince = (province?: string) => {
    return (province || "ON").trim().toUpperCase();
};

const getFederalTaxPayableAccount = (taxCode?: string) => {
    const code = (taxCode || "Exempt").trim().toUpperCase();

    if (["GST", "HST", "HST/GST", "GST/HST"].includes(code)) {
        return "HST/GST Payable";
    }

    if (["", "E", "EXEMPT", "ZERO-RATED", "NONE"].includes(code)) {
        return null;
    }

    return `${taxCode} Payable`;
};

const getProvincialTaxPayableAccount = (province?: string, taxCode?: string) => {
    const prov = normalizeProvince(province);
    const code = (taxCode || "Exempt").trim().toUpperCase();

    if (["", "E", "EXEMPT", "ZERO-RATED", "NONE"].includes(code)) {
        return null;
    }

    if (code === "PST") {
        if (prov === "BC") return "BC PST Payable";
        if (prov === "SK") return "SK PST Payable";
        return null;
    }

    if (code === "RST") {
        if (prov === "MB") return "MB RST Payable";
        return null;
    }

    return null;
};

const getDefaultProvincialTaxCode = (province?: string) => {
    const prov = normalizeProvince(province);

    if (["BC", "SK"].includes(prov)) return "PST";
    if (prov === "MB") return "RST";

    return "Exempt";
};

const ensureCompanyAccount = async (
    companyId: string,
    accountName: string,
    accountType: string,
    defaultTax = "Exempt"
): Promise<string> => {
    const cleanCompanyId = String(companyId || "").trim();
    const cleanAccountName = String(accountName || "")
        .trim()
        .replace(/\s+/g, " ");

    const { data: existingAccount, error: existingError } =
        await supabase
            .from("chart_of_accounts")
            .select("id, is_active")
            .eq("company_id", cleanCompanyId)
            .ilike("name", cleanAccountName)
            .limit(1)
            .maybeSingle();

    if (existingError) {
        throw existingError;
    }

    if (existingAccount?.id) {
        if (!existingAccount.is_active) {
            const { error: reactivateError } =
                await supabase
                    .from("chart_of_accounts")
                    .update({
                        is_active: 1
                    })
                    .eq("id", existingAccount.id)
                    .eq("company_id", cleanCompanyId);

            if (reactivateError) {
                throw reactivateError;
            }
        }

        return String(existingAccount.id);
    }

    const safeCompany = cleanCompanyId
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();

    const safeName = cleanAccountName
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();

    let accountId =
        `acc_def_${safeCompany}_${safeName}`;

    const { data: conflictingId, error: conflictError } =
        await supabase
            .from("chart_of_accounts")
            .select("id")
            .eq("id", accountId)
            .limit(1)
            .maybeSingle();

    if (conflictError) {
        throw conflictError;
    }

    if (conflictingId?.id) {
        accountId =
            `acc_${crypto.randomUUID().replace(/-/g, "")}`;
    }

    const { error: insertError } =
        await supabase
            .from("chart_of_accounts")
            .insert([{
                id: accountId,
                company_id: cleanCompanyId,
                name: cleanAccountName,
                account_type: accountType,
                default_tax: defaultTax,
                is_prime: 1,
                parent_name: "",
                is_active: 1
            }]);

    if (insertError) {
        throw insertError;
    }

    return accountId;
};

export default function OpenCloseModule({
  companyId,
  storeId,
  tillId,
  tillName,
  themeColor,
  user,
  setActiveModule
}: OpenCloseProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [storeProvince, setStoreProvince] = useState("ON"); // <--- NEW: Track province for Z-Report time
  
  // Session State
  const [sessionType, setSessionType] = useState<"Open" | "Close">("Open");
  const sessionTypeRef = useRef<"Open" | "Close">("Open"); // <--- NEW: Tracks state for the heartbeat
  const [lastOpenTimestamp, setLastOpenTimestamp] = useState<number>(0);
  const [blindCloseEnabled, setBlindCloseEnabled] = useState(true);
  
  // Expected Totals
  const [expectedCash, setExpectedCash] = useState(0.0);
  const [activePayments, setActivePayments] = useState<string[]>(["Debit", "Visa", "Mastercard"]);
  const [expectedNonCash, setExpectedNonCash] = useState<Record<string, number>>({});
  

  
  // Inputs
  const [denomCounts, setDenomCounts] = useState<Record<string, string>>({});
  const [nonCashInputs, setNonCashInputs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  // Success Modal
  const [showSuccess, setShowSuccess] =
    useState(false);

  const [successHeader, setSuccessHeader] =
    useState("");

  const [successBody, setSuccessBody] =
    useState("");

  const [
    showClosingSyncReminder,
    setShowClosingSyncReminder
  ] = useState(false);

  // Read-only web warning. Repairs remain available only in the
  // official Chronara Key desktop application.
  const [
    managementReviewType,
    setManagementReviewType
  ] = useState<
    "duplicate" | "update" | null
  >(null);

  // Keep Ref synced with actual state so the heartbeat always knows what screen we are looking at
  useEffect(() => {
    sessionTypeRef.current = sessionType;
    setShowClosingSyncReminder(
      sessionType === "Close"
    );
  }, [sessionType]);

  // --- INITIALIZATION ---
  useEffect(() => {
    loadSessionData();
  }, [
    companyId,
    storeId,
    tillId
  ]);

  const fetchBooksPostingStatus =
    async (): Promise<{
      ownsBooks: boolean;
      activatedAt: string | null;
    }> => {
      const [
        licenseResult,
        activationResult
      ] = await Promise.all([
        supabase
          .from("licenses")
          .select("module")
          .eq(
            "claimed_by_company",
            companyId
          )
          .eq(
            "is_active",
            true
          ),

        supabase
          .from("company_feature_flags")
          .select(
            "enabled, created_at"
          )
          .eq(
            "company_id",
            companyId
          )
          .eq(
            "feature_key",
            "books_module_activated"
          )
          .maybeSingle()
      ]);

      if (licenseResult.error) {
        throw licenseResult.error;
      }

      if (activationResult.error) {
        throw activationResult.error;
      }

      const licenses =
        licenseResult.data || [];

      const ownsBooks = licenses.some(
        license => {
          const moduleName = String(
            license.module || ""
          ).toUpperCase();

          return (
            moduleName === "BOOKS"
            || moduleName === "SUITE"
            || moduleName.includes(
              "BOOKS"
            )
            || moduleName.includes(
              "SUITE"
            )
          );
        }
      );

      const activationFlag =
        activationResult.data;

      const activatedAt =
        ownsBooks
        && Boolean(
          activationFlag?.enabled
        )
        && activationFlag?.created_at
          ? String(
              activationFlag.created_at
            )
          : null;

      return {
        ownsBooks,
        activatedAt
      };
    };
    
  const loadSessionData = async () => {
    setIsLoading(true);

    if (
      !companyId
      || !storeId
      || !tillId
    ) {
      setSessionType("Open");
      setLastOpenTimestamp(0);
      setExpectedCash(0);
      setExpectedNonCash({});
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Store Name, Province, & Company Config
      let sName = storeId === "ALL_STORES" ? "All Stores" : storeId;
      let sProv = "ON"; // Default fallback
      
      if (storeId && storeId !== "ALL_STORES") {
        const { data: sData } = await supabase.from('stores').select('name, province').eq('id', storeId).single();
        if (sData?.name) sName = sData.name;
        if (sData?.province) sProv = normalizeProvince(sData.province);
      } else {
        const { data: cData } = await supabase.from('companies').select('province').eq('id', companyId).single();
        if (cData?.province) sProv = normalizeProvince(cData.province);
      }
      setStoreName(sName);
      setStoreProvince(normalizeProvince(sProv));

      // Verify that the company can read its current Bookkeeping
      // licence and permanent activation record.
      await fetchBooksPostingStatus();

      const { data: compData } = await supabase.from('companies').select('config_json').eq('id', companyId).single();
      let isBlind = true;
      let methods = ["Debit", "Visa", "Mastercard"];
      
      if (compData?.config_json) {
        const cfg = typeof compData.config_json === 'string' ? JSON.parse(compData.config_json) : compData.config_json;
        if (cfg[`${companyId}_blind_close`] !== undefined) {
           const val = cfg[`${companyId}_blind_close`];
           isBlind = (typeof val === 'string') ? !['false', '0', 'no'].includes(val.toLowerCase()) : Boolean(val);
        }
        if (cfg.payment_methods && Array.isArray(cfg.payment_methods)) {
           methods = cfg.payment_methods.filter((m: string) => m.toLowerCase() !== 'cash');
        }
      }
      setBlindCloseEnabled(isBlind);
      setActivePayments(methods);

      // Initialize inputs
      const initDenoms: Record<string, string> = {};
      DENOMINATIONS.forEach(d => initDenoms[d.label] = "0");
      setDenomCounts(initDenoms);

      const initNC: Record<string, string> = {};
      methods.forEach(m => { if (m.toLowerCase() !== 'gift card') initNC[m] = "0.00"; });
      setNonCashInputs(initNC);

      // 2. Determine Session Type (Open vs Close)
      let lastSessionQuery = supabase
        .from('cash_sessions')
        .select(
          'type, timestamp, total'
        )
        .eq('company_id', companyId)
        .eq('till_id', tillId)
        .in('type', ['Open', 'Close'])
        .neq('is_deleted', true)
        .order('timestamp', {
          ascending: false
        })
        .limit(1);

      if (
        storeId
        && storeId !== "ALL_STORES"
      ) {
        lastSessionQuery =
          lastSessionQuery.eq(
            'store_id',
            storeId
          );
      } else {
        lastSessionQuery =
          lastSessionQuery.is(
            'store_id',
            null
          );
      }

      const {
        data: lastSession,
        error: lastSessionError
      } = await lastSessionQuery;

      if (lastSessionError) {
        throw lastSessionError;
      }

      let currentType: "Open" | "Close" = "Open";
      let ts = 0;
      let openingFloat = 0.0;

      if (lastSession && lastSession.length > 0) {
         if (lastSession[0].type === "Open") {
            currentType = "Close";
            ts = parseFloat(lastSession[0].timestamp);
            openingFloat = parseFloat(lastSession[0].total || 0);
         }
      }

      setSessionType(currentType);
      setLastOpenTimestamp(ts);

      // 3. Calculate Expectations if Closing
      if (
        currentType === "Close"
        && ts > 0
      ) {
        await calculateExpectations(
          ts,
          openingFloat,
          methods
        );
      }

      // The web app only displays management notices.
      // Resolution remains in the desktop application.
      await checkForManagementReview();

    } catch (err) {
      console.error("Failed to load session data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // --- CLOUD HEARTBEAT ---
  // ==========================================
  useEffect(() => {
    if (!companyId) return;

    const pingCloudStatus = async () => {
      try {
        if (!tillId) {
          return;
        }

        let query = supabase
          .from('cash_sessions')
          .select('type')
          .eq('company_id', companyId)
          .eq('till_id', tillId)
          .in('type', ['Open', 'Close'])
          .neq('is_deleted', true)
          .order('timestamp', {
            ascending: false
          })
          .limit(1);

        if (
          storeId
          && storeId !== "ALL_STORES"
        ) {
          query = query.eq(
            'store_id',
            storeId
          );
        } else {
          query = query.is(
            'store_id',
            null
          );
        }

        const { data, error } = await query;

        if (error) {
          throw error;
        }

        const remoteLastType =
          data && data.length > 0
            ? data[0].type
            : null;

        const expectedNextAction:
          "Open" | "Close" =
          remoteLastType === "Open"
            ? "Close"
            : "Open";

        if (
          expectedNextAction
          !== sessionTypeRef.current
        ) {
          console.log(
            "Till state mismatch detected. Syncing..."
          );

          loadSessionData();
        }
      } catch (err) {
        // Silently fail if network drops temporarily.
      }
    };

    const intervalId =
      setInterval(
        pingCloudStatus,
        15000
      );

    return () =>
      clearInterval(intervalId);

  }, [
    companyId,
    storeId,
    tillId
  ]);


  // Periodically check whether management must review duplicate
  // closes or update a past till report in the desktop program.
  useEffect(() => {
    if (
      !companyId
      || !storeId
    ) {
      return;
    }

    const refreshManagementNotice =
      () => {
        checkForManagementReview();
      };

    refreshManagementNotice();

    const intervalId =
      setInterval(
        refreshManagementNotice,
        60000
      );

    return () =>
      clearInterval(intervalId);

  }, [
    companyId,
    storeId,
    tillId
  ]);

  // ==========================================

  const fetchAll = async (query: any) => {
    let allData: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;
    while (hasMore) {
       const { data, error } = await query.range(from, from + step - 1);
       if (error) throw error;
       if (data && data.length > 0) {
           allData = allData.concat(data);
           from += step;
           if (data.length < step) hasMore = false;
       } else {
           hasMore = false;
       }
    }
    return allData;
  };

  const parseDenominations = (
    rawValue: any
  ): Record<string, any> => {
    if (
      rawValue
      && typeof rawValue === "object"
      && !Array.isArray(rawValue)
    ) {
      return rawValue;
    }

    if (
      typeof rawValue === "string"
      && rawValue.trim()
    ) {
      try {
        const parsed =
          JSON.parse(rawValue);

        if (
          parsed
          && typeof parsed === "object"
          && !Array.isArray(parsed)
        ) {
          return parsed;
        }
      } catch {
        // Invalid or legacy JSON is treated as empty.
      }
    }

    return {};
  };


  const parseStoredNumber = (
    value: any
  ): number => {
    if (
      value === null
      || value === undefined
    ) {
      return 0;
    }

    if (typeof value === "number") {
      return Number.isFinite(value)
        ? value
        : 0;
    }

    const parsed = parseFloat(
      String(value).replace(
        /[^0-9.-]+/g,
        ""
      )
    );

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  };


  const checkForManagementReview =
    async () => {
      if (
        !companyId
        || !storeId
      ) {
        setManagementReviewType(null);
        return;
      }

      try {
        let sessionQuery = supabase
          .from("cash_sessions")
          .select(
            "id, type, timestamp, total, expected_cash, denominations, till_id, store_id"
          )
          .eq(
            "company_id",
            companyId
          )
          .in(
            "type",
            ["Open", "Close"]
          )
          .neq(
            "is_deleted",
            true
          )
          .not(
            "till_id",
            "is",
            null
          )
          .order(
            "till_id",
            {
              ascending: true
            }
          )
          .order(
            "timestamp",
            {
              ascending: true
            }
          );

        if (
          storeId
          && storeId !== "ALL_STORES"
        ) {
          sessionQuery =
            sessionQuery.eq(
              "store_id",
              storeId
            );
        } else {
          sessionQuery =
            sessionQuery.is(
              "store_id",
              null
            );
        }

        const sessionRows =
          await fetchAll(
            sessionQuery
          );

        const rowsByTill =
          new Map<string, any[]>();

        for (const row of sessionRows) {
          const rowTillId =
            String(
              row.till_id
              || ""
            ).trim();

          if (!rowTillId) {
            continue;
          }

          const existing =
            rowsByTill.get(
              rowTillId
            ) || [];

          existing.push(row);

          rowsByTill.set(
            rowTillId,
            existing
          );
        }

        const duplicateCloseIds =
          new Set<string>();

        const closedShifts: Array<{
          tillId: string;
          open: any;
          close: any;
        }> = [];

        let hasDuplicate = false;

        for (
          const [
            rowTillId,
            tillRows
          ] of rowsByTill.entries()
        ) {
          let currentOpen: any = null;
          let currentCloses: any[] = [];

          const finishCurrentShift = () => {
            if (!currentOpen) {
              return;
            }

            if (
              currentCloses.length > 1
            ) {
              hasDuplicate = true;

              currentCloses.forEach(
                closeRow => {
                  if (closeRow.id) {
                    duplicateCloseIds.add(
                      String(closeRow.id)
                    );
                  }
                }
              );
            } else if (
              currentCloses.length === 1
            ) {
              closedShifts.push({
                tillId: rowTillId,
                open: currentOpen,
                close: currentCloses[0]
              });
            }
          };

          for (const row of tillRows) {
            if (row.type === "Open") {
              finishCurrentShift();

              currentOpen = row;
              currentCloses = [];

            } else if (
              row.type === "Close"
              && currentOpen
            ) {
              currentCloses.push(row);
            }
          }

          finishCurrentShift();
        }

        // Duplicate structural conflicts take priority over ordinary
        // report updates, matching the desktop application.
        if (hasDuplicate) {
          setManagementReviewType(
            "duplicate"
          );
          return;
        }

        // Only desktop Closes explicitly marked as saved offline can
        // require the Update Past Till Reports workflow.
        const offlineShifts =
          closedShifts
            .filter(shift => {
              const denominations =
                parseDenominations(
                  shift.close
                    .denominations
                );

              return Boolean(
                denominations[
                  "_chronara_offline_action"
                ]
              );
            })
            .slice(0, 250);

        for (
          const shift of offlineShifts
        ) {
          if (
            duplicateCloseIds.has(
              String(
                shift.close.id
                || ""
              )
            )
          ) {
            continue;
          }

          const openTimestamp =
            parseStoredNumber(
              shift.open.timestamp
            );

          const closeTimestamp =
            parseStoredNumber(
              shift.close.timestamp
            );

          if (
            openTimestamp <= 0
            || closeTimestamp <= 0
          ) {
            continue;
          }

          const sinceIso =
            new Date(
              openTimestamp * 1000
            ).toISOString();

          const closeIso =
            new Date(
              closeTimestamp * 1000
            ).toISOString();

          let salesQuery = supabase
            .from("sales")
            .select(
              "id, total"
            )
            .eq(
              "company_id",
              companyId
            )
            .eq(
              "till_id",
              shift.tillId
            )
            .gte(
              "date",
              sinceIso
            )
            .lte(
              "date",
              closeIso
            )
            .neq(
              "is_deleted",
              true
            );

          if (
            storeId
            && storeId !== "ALL_STORES"
          ) {
            salesQuery =
              salesQuery.eq(
                "store_id",
                storeId
              );
          } else {
            salesQuery =
              salesQuery.is(
                "store_id",
                null
              );
          }

          const sales =
            await fetchAll(
              salesQuery
            );

          const saleIds =
            sales
              .map(sale => sale.id)
              .filter(Boolean);

          const payments: any[] = [];

          for (
            let index = 0;
            index < saleIds.length;
            index += 100
          ) {
            const idChunk =
              saleIds.slice(
                index,
                index + 100
              );

            const chunkPayments =
              await fetchAll(
                supabase
                  .from(
                    "sale_payments"
                  )
                  .select(
                    "method, amount"
                  )
                  .eq(
                    "company_id",
                    companyId
                  )
                  .in(
                    "sale_id",
                    idChunk
                  )
                  .neq(
                    "is_deleted",
                    true
                  )
              );

            payments.push(
              ...chunkPayments
            );
          }

          let activityQuery = supabase
            .from("cash_sessions")
            .select("total")
            .eq(
              "company_id",
              companyId
            )
            .eq(
              "till_id",
              shift.tillId
            )
            .gte(
              "timestamp",
              openTimestamp
            )
            .lte(
              "timestamp",
              closeTimestamp
            )
            .in(
              "type",
              [
                "Add Cash",
                "Remove Cash"
              ]
            )
            .neq(
              "is_deleted",
              true
            );

          if (
            storeId
            && storeId !== "ALL_STORES"
          ) {
            activityQuery =
              activityQuery.eq(
                "store_id",
                storeId
              );
          } else {
            activityQuery =
              activityQuery.is(
                "store_id",
                null
              );
          }

          const cashActivity =
            await fetchAll(
              activityQuery
            );

          let currentCashSales = 0;
          const currentNonCash:
            Record<string, number> = {};

          for (const payment of payments) {
            const method =
              String(
                payment.method
                || ""
              ).trim();

            const amount =
              parseStoredNumber(
                payment.amount
              );

            if (
              method.toLowerCase()
              === "cash"
            ) {
              currentCashSales += amount;
            } else if (method) {
              currentNonCash[method] =
                (
                  currentNonCash[
                    method
                  ] || 0
                ) + amount;
            }
          }

          const activityTotal =
            cashActivity.reduce(
              (
                total,
                activity
              ) =>
                total
                + parseStoredNumber(
                    activity.total
                  ),
              0
            );

          const currentExpectedCash =
            parseStoredNumber(
              shift.open.total
            )
            + currentCashSales
            + activityTotal;

          const savedExpectedCash =
            parseStoredNumber(
              shift.close
                .expected_cash
            );

          const denominations =
            parseDenominations(
              shift.close
                .denominations
            );

          const savedNonCash:
            Record<string, number> = {};

          Object.entries(
            denominations
          ).forEach(
            ([key, value]) => {
              if (
                !key.endsWith(
                  "_Expected"
                )
              ) {
                return;
              }

              const method =
                key.slice(
                  0,
                  -9
                );

              if (method) {
                savedNonCash[
                  method
                ] =
                  parseStoredNumber(
                    value
                  );
              }
            }
          );

          const allMethods =
            new Set([
              ...Object.keys(
                currentNonCash
              ),
              ...Object.keys(
                savedNonCash
              )
            ]);

          const terminalChanged =
            Array.from(
              allMethods
            ).some(method =>
              Math.abs(
                (
                  currentNonCash[
                    method
                  ] || 0
                )
                -
                (
                  savedNonCash[
                    method
                  ] || 0
                )
              ) > 0.005
            );

          const savedSourceCount =
            denominations[
              "_chronara_source_sale_count"
            ];

          let sourceCountChanged =
            false;

          if (
            savedSourceCount
            !== undefined
            && savedSourceCount
            !== null
          ) {
            sourceCountChanged =
              Number(
                savedSourceCount
              ) !== sales.length;
          }

          const cashChanged =
            Math.abs(
              currentExpectedCash
              - savedExpectedCash
            ) > 0.005;

          if (
            cashChanged
            || terminalChanged
            || sourceCountChanged
          ) {
            setManagementReviewType(
              "update"
            );
            return;
          }
        }

        setManagementReviewType(null);

      } catch (error) {
        // Do not display a false warning when the check itself fails.
        console.error(
          "Could not check till reports requiring management review:",
          error
        );
      }
    };
  const calculateExpectations = async (sinceTs: number, openingFloat: number, currentMethods: string[]) => {
    try {
      const sinceStr = new Date(sinceTs * 1000).toISOString();
      const targetStoreId = storeId === "ALL_STORES" ? null : storeId;

      const parseMoney = (val: any) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === "number") return val;
        const str = String(val).replace(/[^0-9.-]+/g, "");
        return parseFloat(str) || 0;
      };

      let dropsQuery = supabase
        .from("cash_sessions")
        .select("total")
        .eq("company_id", companyId)
        .eq("till_id", tillId)
        .gte("timestamp", sinceTs)
        .in(
          "type",
          ["Add Cash", "Remove Cash"]
        )
        .neq("is_deleted", true);

      if (targetStoreId) dropsQuery = dropsQuery.eq("store_id", targetStoreId);
      else dropsQuery = dropsQuery.is("store_id", null);

      const dropsData = await fetchAll(dropsQuery);
      const netDrops = dropsData.reduce((acc, row) => acc + parseMoney(row.total), 0);

      let allSalesQuery = supabase
        .from("sales")
        .select("id")
        .eq("company_id", companyId)
        .eq("till_id", tillId)
        .gte("date", sinceStr)
        .neq("is_deleted", true);

      if (targetStoreId) allSalesQuery = allSalesQuery.eq("store_id", targetStoreId);
      else allSalesQuery = allSalesQuery.is("store_id", null);

      const allSalesData = await fetchAll(allSalesQuery);
      const saleIds = allSalesData.map((s: any) => s.id);

      let cashSales = 0.0;
      const ncTotals: Record<string, number> = {};
      currentMethods.forEach((m) => (ncTotals[m] = 0.0));

      if (saleIds.length > 0) {
        const chunkSize = 100;
        let allPayments: any[] = [];

        for (let i = 0; i < saleIds.length; i += chunkSize) {
          const chunk = saleIds.slice(i, i + chunkSize);
          const paymentsData = await fetchAll(
            supabase
              .from("sale_payments")
              .select("method, amount")
              .eq("company_id", companyId)
              .in("sale_id", chunk)
              .neq("is_deleted", true)
          );
          allPayments = allPayments.concat(paymentsData);
        }

        allPayments.forEach((p) => {
          const method = p.method || "";
          const amount = parseMoney(p.amount);

          if (method.toLowerCase() === "cash") {
            cashSales += amount;
          } else if (method) {
            ncTotals[method] = (ncTotals[method] || 0) + amount;
          }
        });
      }

      setExpectedCash(openingFloat + netDrops + cashSales);
      setExpectedNonCash(ncTotals);
    } catch (e) {
      console.error("Error calculating expectations:", e);
    }
  };

  // --- CALCULATION HELPERS ---
  const currentCashTotal = useMemo(() => {
    let total = 0;
    DENOMINATIONS.forEach(d => {
      const count = parseInt(denomCounts[d.label]) || 0;
      total += (count * d.mult);
    });
    return total;
  }, [denomCounts]);

  const cashVariance = currentCashTotal - expectedCash;
  const isBalanced = Math.abs(cashVariance) < 0.01;

  // --- SAVE & Z-REPORT LOGIC ---
  const handleSave = async () => {
    if (currentCashTotal === 0 && !window.confirm(`Total cash ${sessionType} is $0.00. Are you sure?`)) {
      return;
    }

    setIsSaving(true);

    // =======================================================
    // --- PRE-SAVE CLOUD VERIFICATION (RACE CONDITION FIX) ---
    // =======================================================
    try {
      if (!tillId) {
        alert(
          "Select an active till before opening or closing."
        );
        setIsSaving(false);
        return;
      }

      let query = supabase
        .from('cash_sessions')
        .select('type')
        .eq('company_id', companyId)
        .eq('till_id', tillId)
        .in('type', ['Open', 'Close'])
        .neq('is_deleted', true)
        .order('timestamp', {
          ascending: false
        })
        .limit(1);

      if (
        storeId
        && storeId !== "ALL_STORES"
      ) {
        query = query.eq(
          'store_id',
          storeId
        );
      } else {
        query = query.is(
          'store_id',
          null
        );
      }

      const { data: preSaveData, error: preSaveError } = await query;
      if (!preSaveError && preSaveData && preSaveData.length > 0) {
        const cloudLastType = preSaveData[0].type;
        const expectedNextAction = cloudLastType === "Open" ? "Close" : "Open";
        
        if (expectedNextAction !== sessionTypeRef.current) {
            const msgAction = cloudLastType === "Open" ? "opened" : "closed";
            alert(
              `Conflict: ${tillName || "The selected till"} is already ${msgAction} on another device.\nThe screen will now refresh.`
            );
            setIsSaving(false);
            loadSessionData();
            return; 
        }
      }
    } catch (err) {
      console.warn("Pre-save verification bypassed due to network error", err);
    }

    try {
      // --- STRICT UTC RULE ---
      const now = new Date();
      const nowIso = now.toISOString();
      const nowTs = Math.floor(
        now.getTime() / 1000
      );

      const targetStoreId =
        storeId === "ALL_STORES"
          ? null
          : storeId;

      // Open records never post to Bookkeeping.
      //
      // For a Close, recheck the cloud licence and activation flag at
      // the exact moment of saving instead of relying only on React
      // state loaded earlier.
      let booksPostingEligible =
        false;

      if (sessionType === "Close") {
        const currentBooksStatus =
          await fetchBooksPostingStatus();



        if (
          currentBooksStatus.ownsBooks
          && currentBooksStatus.activatedAt
        ) {
          const activationDateOnly =
            String(
              currentBooksStatus
                .activatedAt
            ).slice(
              0,
              10
            );

          const closeDateOnly =
            nowIso.slice(
              0,
              10
            );

          booksPostingEligible =
            closeDateOnly
            >= activationDateOnly;
        }
      }

      // --- LOCAL PROJECTION FOR Z-REPORT DISPLAY ---
      const localTz = getStoreTimezone(storeProvince, storeId === "ALL_STORES");
      const localDisplayTime = new Intl.DateTimeFormat('en-US', {
          timeZone: localTz, month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(now);

      const sessionId = `cs_${crypto.randomUUID().replace(/-/g, "")}`;
      
      let baseNumericId = Math.floor(Math.random() * 1000000000) + 1000000000;
      const getNextId = () => baseNumericId++;

      // Build JSON Ledger
      const denomJsonDict: any = { ...denomCounts };
      let ncVarianceTotal = 0.0;
      let ncExpectedTotal = 0.0;
      let ncActualTotal = 0.0;

      if (sessionType === "Close") {
        Object.keys(nonCashInputs).forEach(method => {
           const exp = expectedNonCash[method] || 0.0;
           const act = parseFloat(nonCashInputs[method]) || 0.0;
           denomJsonDict[`${method}_Expected`] = exp;
           denomJsonDict[`${method}_Actual`] = act;
           ncExpectedTotal += exp;
           ncActualTotal += act;
           ncVarianceTotal += (act - exp);
        });

        if (activePayments.includes("Gift Card")) {
           const gcExp = expectedNonCash["Gift Card"] || 0.0;
           denomJsonDict["Gift Card_Expected"] = gcExp;
           denomJsonDict["Gift Card_Actual"] = gcExp;
           ncExpectedTotal += gcExp;
           ncActualTotal += gcExp;
        }
      }

      const denomJsonStr = JSON.stringify(denomJsonDict);

      // Detailed text breakdown
      let detailsText = "\n--- CASH BREAKDOWN ---\n";
      DENOMINATIONS.forEach(d => {
         const count = denomCounts[d.label] || "0";
         detailsText += `${d.label}: ${count}\n`;
      });

      if (sessionType === "Close" && activePayments.length > 0) {
         detailsText += "\n--- TERMINAL BREAKDOWN ---\n";
         activePayments.forEach(method => {
            const exp = denomJsonDict[`${method}_Expected`] || 0.0;
            const act = denomJsonDict[`${method}_Actual`] || 0.0;
            const varAmt = act - exp;
            detailsText += `${method}: Actual $${act.toFixed(2)} | Expected $${exp.toFixed(2)} | Var: $${varAmt.toFixed(2)}\n`;
         });
      }

      // 1. Save Cash Session (Always runs)
      const { error: sessionError } =
        await supabase
          .from("cash_sessions")
          .insert([
            {
              id: sessionId,
              date: nowIso,
              timestamp: nowTs,
              type: sessionType,
              company_id: companyId,
              store_id: targetStoreId,
              till_id: tillId,
              user:
                user?.username
                || "Unknown",
              total: currentCashTotal,
              expected_cash:
                sessionType === "Close"
                  ? expectedCash
                  : 0,
              variance:
                sessionType === "Close"
                  ? cashVariance
                  : 0,
              notes: notes.trim(),
              denominations:
                denomJsonStr,
              books_posting_eligible:
                booksPostingEligible
            }
          ]);

      if (sessionError) throw new Error(`Failed to save Cash Session: ${sessionError.message}`);

      // ==========================================
      // PHASE 4: BOOKKEEPING INTEGRATION (Z-REPORT)
      // ==========================================
      if (
        sessionType === "Close"
        && booksPostingEligible
      ) {

          // B. Aggregate Data for the Shift
          const sinceIso = new Date(lastOpenTimestamp * 1000).toISOString();
          
          let shiftSalesQuery = supabase
            .from("sales")
            .select(
              "id, total, tax_val, prov_tax_val"
            )
            .eq("company_id", companyId)
            .eq("till_id", tillId)
            .gte("date", sinceIso)
            .lte("date", nowIso)
            .neq("is_deleted", true);

          if (targetStoreId) shiftSalesQuery = shiftSalesQuery.eq("store_id", targetStoreId);
          else shiftSalesQuery = shiftSalesQuery.is("store_id", null);

          const shiftSales = await fetchAll(shiftSalesQuery);
          const saleIds = shiftSales.map(s => s.id);

          const parseMoney = (val: any) => {
              if (val === null || val === undefined) return 0;
              if (typeof val === 'number') return val;
              const str = String(val).replace(/[^0-9.-]+/g, "");
              return parseFloat(str) || 0;
          };

          const grossSales = shiftSales.reduce((sum, s) => sum + parseMoney(s.total), 0);
          const fedTaxTotal = shiftSales.reduce((sum, s) => sum + parseMoney(s.tax_val), 0);
          const provTaxTotal = shiftSales.reduce((sum, s) => sum + parseMoney(s.prov_tax_val), 0);

          let shiftTips = 0;
          let shiftCommissions = 0;
          let gcLoads = 0;
          let totalCogs = 0;
          let serviceSales = 0;
          
          const productLookup: Record<string, any> = {};
          const ingredientParentSkus = new Set<string>();
          const dynamicTaxMap: Record<string, number> = {};
          let fedTaxRouted = 0.0;
          let provTaxRouted = 0.0;

          if (saleIds.length > 0) {
             const chunkSize = 100;
             let allTips: any[] = [];
             let allComms: any[] = [];
             let allItems: any[] = [];

             for (let i = 0; i < saleIds.length; i += chunkSize) {
                 const chunk = saleIds.slice(i, i + chunkSize);
                 const [tipsData, commsData, itemsData] = await Promise.all([
                     fetchAll(
                         supabase
                             .from('tips_ledger')
                             .select('amount')
                             .eq('company_id', companyId)
                             .in('sale_id', chunk)
                     ),
                     fetchAll(
                         supabase
                             .from('commissions_ledger')
                             .select('amount')
                             .eq('company_id', companyId)
                             .in('sale_id', chunk)
                     ),
                     fetchAll(
                         supabase
                             .from('sale_items')
                             .select('sku, product_id, qty, price, cost, tax_code, prov_tax_code, tax_val, prov_tax_val, is_damaged')
                             .eq('company_id', companyId)
                             .in('sale_id', chunk)
                             .neq('is_deleted', true)
                     )
                 ]);
                 allTips = allTips.concat(tipsData);
                 allComms = allComms.concat(commsData);
                 allItems = allItems.concat(itemsData);
             }

             shiftTips = allTips.reduce((sum, t) => sum + parseMoney(t.amount), 0);
             shiftCommissions = allComms.reduce((sum, c) => sum + parseMoney(c.amount), 0);

             const productIds = Array.from(
                 new Set(
                     allItems
                         .map(item => item.product_id)
                         .filter(id => id !== null && id !== undefined && String(id).trim() !== "")
                         .map(id => String(id))
                 )
             );

             const itemSkus = Array.from(
                 new Set(
                     allItems
                         .map(item => item.sku)
                         .filter(sku => sku !== null && sku !== undefined && String(sku).trim() !== "")
                         .map(sku => String(sku))
                 )
             );

             if (productIds.length > 0) {
                 for (let i = 0; i < productIds.length; i += 100) {
                     const chunk = productIds.slice(i, i + 100);
                     const productsById = await fetchAll(
                         supabase
                             .from("products")
                             .select("id, sku, store_id, track_inventory")
                             .eq("company_id", companyId)
                             .in("id", chunk)
                     );

                     productsById.forEach((p: any) => {
                         if (p.id) productLookup[`id:${String(p.id)}`] = p;
                         if (p.sku) productLookup[`sku:${String(p.sku)}`] = p;
                     });
                 }
             }

             if (itemSkus.length > 0) {
                 for (let i = 0; i < itemSkus.length; i += 100) {
                     const chunk = itemSkus.slice(i, i + 100);
                     const productsBySku = await fetchAll(
                         supabase
                             .from("products")
                             .select("id, sku, store_id, track_inventory")
                             .eq("company_id", companyId)
                             .in("sku", chunk)
                     );

                     productsBySku.forEach((p: any) => {
                         if (p.id) productLookup[`id:${String(p.id)}`] = p;
                         if (p.sku) productLookup[`sku:${String(p.sku)}`] = p;
                     });
                 }

                 for (let i = 0; i < itemSkus.length; i += 100) {
                     const chunk = itemSkus.slice(i, i + 100);
                     const ingredients = await fetchAll(
                         supabase
                             .from("product_ingredients")
                             .select("parent_sku")
                             .eq("company_id", companyId)
                             .in("parent_sku", chunk)
                     );

                     ingredients.forEach((ing: any) => {
                         if (ing.parent_sku) ingredientParentSkus.add(String(ing.parent_sku));
                     });
                 }
             }

             allItems.forEach(item => {
                 const qty = parseMoney(item.qty);
                 const price = parseMoney(item.price);
                 const cost = parseMoney(item.cost);

                 const isDamagedRefundItem =
                     item.is_damaged === true ||
                     item.is_damaged === 1 ||
                     item.is_damaged === "1" ||
                     String(item.is_damaged).toLowerCase() === "true";

                 const sku = item.sku ? String(item.sku) : "";
                 const product =
                     (item.product_id ? productLookup[`id:${String(item.product_id)}`] : null) ||
                     (sku ? productLookup[`sku:${sku}`] : null);

                 const trackInventoryRaw = product?.track_inventory;
                 const tracksInventory =
                     trackInventoryRaw === true ||
                     trackInventoryRaw === 1 ||
                     trackInventoryRaw === "1" ||
                     String(trackInventoryRaw).toLowerCase() === "true";

                 const productSku = product?.sku ? String(product.sku) : sku;
                 const hasIngredients = productSku ? ingredientParentSkus.has(productSku) : false;
                 const isServiceItem =
                     sku !== "SYS_GIFT_CARD" &&
                     sku !== "SYS_TIP" &&
                     product &&
                     !tracksInventory &&
                     !hasIngredients;

                 if (sku === 'SYS_GIFT_CARD') {
                     gcLoads += (qty * price);
                 } else {
                     if (isServiceItem) {
                         serviceSales += (qty * price);
                     }

                     if (!isServiceItem && !isDamagedRefundItem && (tracksInventory || hasIngredients)) {
                         // Damaged / non-restocked refunds should NOT reverse COGS or Inventory Asset.
                         totalCogs += (qty * cost);
                     }
                 }
                 
                 // --- CLEAN TAX ACCOUNT AGGREGATION ---
                 const tCode = item.tax_code || 'Exempt';
                 const pCode = item.prov_tax_code || 'Exempt';
                 const tVal = parseMoney(item.tax_val);
                 const pVal = parseMoney(item.prov_tax_val);

                 const fedAccName = getFederalTaxPayableAccount(tCode);
                 if (fedAccName && Math.abs(tVal) > 0.005) {
                     dynamicTaxMap[fedAccName] = (dynamicTaxMap[fedAccName] || 0) + tVal;
                     fedTaxRouted += tVal;
                 }

                 const provAccName = getProvincialTaxPayableAccount(storeProvince, pCode);
                 if (provAccName && Math.abs(pVal) > 0.005) {
                     dynamicTaxMap[provAccName] = (dynamicTaxMap[provAccName] || 0) + pVal;
                     provTaxRouted += pVal;
                 }
             });
          }

          const netSales = grossSales - fedTaxTotal - provTaxTotal - shiftTips - gcLoads;
          const productSales = netSales - serviceSales;

          const fedAccountFallback = "HST/GST Payable";

          const defaultProvTaxCode = getDefaultProvincialTaxCode(storeProvince);
          const provAccountFallback = getProvincialTaxPayableAccount(storeProvince, defaultProvTaxCode);

          const fedRemainder = fedTaxTotal - fedTaxRouted;
          if (Math.abs(fedRemainder) > 0.001) {
              dynamicTaxMap[fedAccountFallback] = (dynamicTaxMap[fedAccountFallback] || 0) + fedRemainder;
          }

          const provRemainder = provTaxTotal - provTaxRouted;
          if (Math.abs(provRemainder) > 0.001 && provAccountFallback) {
              dynamicTaxMap[provAccountFallback] = (dynamicTaxMap[provAccountFallback] || 0) + provRemainder;
          }

          const sysAccounts = [
              { name: "Cash Over/Short", type: "Expense", tax: "Exempt" },
              { name: "Tips Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Gift Card Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Commission Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Commission Expense", type: "Expense", tax: "Exempt" },
              { name: "Cost of Goods Sold", type: "Cost of Goods Sold", tax: "Exempt" },
              { name: "Inventory Asset", type: "Current Asset", tax: "Exempt" },
              { name: "Service Revenue", type: "Income", tax: "Taxable" }
          ];
          
          Object.keys(dynamicTaxMap).forEach(accName => {
              sysAccounts.push({ name: accName, type: "Current Liability", tax: "Exempt" });
          });

          await supabase
              .from("chart_of_accounts")
              .update({
                  account_type: "Cost of Goods Sold"
              })
              .eq("company_id", companyId)
              .eq("name", "Cost of Goods Sold")
              .eq("account_type", "Expense");

          for (const acc of sysAccounts) {
              await ensureCompanyAccount(
                  companyId,
                  acc.name,
                  acc.type,
                  acc.tax
              );
          }

          const jeId = `je_${crypto.randomUUID().replace(/-/g, "")}`;
          const totalVariance = cashVariance + ncVarianceTotal;
          const varStr = totalVariance > 0 ? `+$${totalVariance.toFixed(2)}` : `-$${Math.abs(totalVariance).toFixed(2)}`;
          const jeDesc = Math.abs(totalVariance) > 0.01 ? `End of Day Z-Report (Variance: ${varStr})` : "End of Day Z-Report (Balanced)";

          const { error: jeError } =
            await supabase
              .from('journal_entries')
              .insert([{
                id: jeId,
                company_id: companyId,
                store_id: targetStoreId,
                till_id: tillId,
                date: nowIso,
                type: 'Z-Report',
                ref_number: sessionId,
                total_amount: grossSales,
                description:
                  `${jeDesc} — ${tillName || "Till"}`,
                created_at: nowIso,
                username:
                  user?.username
                  || "System"
              }]);
          if (jeError) throw new Error(`Failed to create Journal Entry: ${jeError.message}`);

          const lines: any[] = [];
          const addLine = (account: string, debit: number, credit: number) => {
              if (Math.abs(debit) < 0.001 && Math.abs(credit) < 0.001) return;

              lines.push({
                  id: getNextId(),
                  entry_id: jeId,
                  company_id: companyId,
                  account,
                  debit,
                  credit,
                  created_at: nowIso,
                  updated_at: nowIso,
                  is_deleted: false
              });
          };
          
          if (productSales > 0) addLine('Sales', 0.0, productSales);
          else if (productSales < 0) addLine('Sales', Math.abs(productSales), 0.0);

          if (serviceSales > 0) addLine('Service Revenue', 0.0, serviceSales);
          else if (serviceSales < 0) addLine('Service Revenue', Math.abs(serviceSales), 0.0);

          Object.entries(dynamicTaxMap).forEach(([accName, amt]) => {
              if (amt > 0) addLine(accName, 0.0, amt);
              else if (amt < 0) addLine(accName, Math.abs(amt), 0.0);
          });

          if (shiftTips > 0) addLine('Tips Payable', 0.0, shiftTips);
          else if (shiftTips < 0) addLine('Tips Payable', Math.abs(shiftTips), 0.0);

          if (shiftCommissions > 0) {
              addLine('Commission Expense', shiftCommissions, 0.0);
              addLine('Commission Payable', 0.0, shiftCommissions);
          } else if (shiftCommissions < 0) {
              addLine('Commission Expense', 0.0, Math.abs(shiftCommissions));
              addLine('Commission Payable', Math.abs(shiftCommissions), 0.0);
          }

          if (gcLoads > 0) addLine('Gift Card Payable', 0.0, gcLoads);
          else if (gcLoads < 0) addLine('Gift Card Payable', Math.abs(gcLoads), 0.0);

          if (totalCogs > 0) {
              addLine('Cost of Goods Sold', totalCogs, 0.0);
              addLine('Inventory Asset', 0.0, totalCogs);
          } else if (totalCogs < 0) {
              addLine('Cost of Goods Sold', 0.0, Math.abs(totalCogs));
              addLine('Inventory Asset', Math.abs(totalCogs), 0.0);
          }

          let cashSalesFromDB = 0.0;

          if (saleIds.length > 0) {
            const chunkSize = 100;
            let allCashPayments: any[] = [];

            for (let i = 0; i < saleIds.length; i += chunkSize) {
              const chunk = saleIds.slice(i, i + chunkSize);
              const paymentsData = await fetchAll(
                supabase
                  .from("sale_payments")
                  .select("method, amount")
                  .eq("company_id", companyId)
                  .in("sale_id", chunk)
                  .eq("method", "Cash")
                  .neq("is_deleted", true)
              );
              allCashPayments = allCashPayments.concat(paymentsData);
            }

            cashSalesFromDB = allCashPayments.reduce((sum, p) => sum + parseMoney(p.amount), 0);
          }

          const actualCashFromSales = cashSalesFromDB + cashVariance;
          if (actualCashFromSales > 0) addLine('Undeposited Funds', actualCashFromSales, 0.0);
          else if (actualCashFromSales < 0) addLine('Undeposited Funds', 0.0, Math.abs(actualCashFromSales));

          activePayments.forEach(method => {
             const actVal = parseMoney(denomJsonDict[`${method}_Actual`]);
             const targetAcc = method.toLowerCase() === 'gift card' ? 'Gift Card Payable' : 'Undeposited Funds';
             if (actVal > 0) addLine(targetAcc, actVal, 0.0);
             else if (actVal < 0) addLine(targetAcc, 0.0, Math.abs(actVal));
          });

          if (totalVariance < 0) addLine('Cash Over/Short', Math.abs(totalVariance), 0.0);
          else if (totalVariance > 0) addLine('Cash Over/Short', 0.0, totalVariance);

          if (lines.length > 0) {
            const { error: jlError } =
              await supabase
                .from('journal_lines')
                .insert(lines);

            if (jlError) {
              throw new Error(
                `Failed to map Journal Lines: ${jlError.message}`
              );
            }

            // The visible Z-report amount must remain gross customer
            // sales. Do not replace it with total journal debits,
            // because those debits may also include COGS, commissions,
            // inventory adjustments, and variance lines.
            const { error: jeUpdateError } =
              await supabase
                .from('journal_entries')
                .update({
                  total_amount: grossSales
                })
                .eq('id', jeId)
                .eq('company_id', companyId)
                .eq('store_id', targetStoreId)
                .eq('till_id', tillId);

            if (jeUpdateError) {
              throw new Error(
                `Failed to index Journal Totals: ${jeUpdateError.message}`
              );
            }
          }
      }
      // ==========================================
      // END OF PHASE 4
      // ==========================================

      // Log Action (Always runs!)
      const actionType = sessionType === "Open" ? "Store Open" : "Store Close";
      let logDesc = `Cash Total: $${currentCashTotal.toFixed(2)}`;
      
      if (sessionType === "Close") {
         logDesc += ` (Exp: $${expectedCash.toFixed(2)}, Var: $${cashVariance.toFixed(2)})`;
         if (activePayments.length > 0) {
            logDesc += ` | Terminal Total: $${ncActualTotal.toFixed(2)} (Exp: $${ncExpectedTotal.toFixed(2)}, Var: $${ncVarianceTotal.toFixed(2)})`;
         }
      }
      
      const fullLogDesc = `${logDesc}\n${detailsText}` + (notes.trim() ? `\n\nNotes: ${notes.trim()}` : "");

      await supabase.from("activity_log").insert([{
        id: getNextId(),
        date: nowIso, 
        timestamp: nowTs,
        company_id: companyId,
        store_id: targetStoreId,
        user_id: user?.id || null,
        user_name: user?.username || "Unknown",
        action: actionType,
        description: fullLogDesc,
      }]);

      let msg =
        `${tillName || "Till"} was `
        + `${sessionType === "Open" ? "opened" : "closed"} `
        + `successfully on ${localDisplayTime}.`;
      if (sessionType === "Close") {
         const stat = isBalanced ? "BALANCED" : (cashVariance > 0 ? "OVER" : "UNDER");
         msg += `\n\n--- CASH RECONCILIATION ---`;
         msg += `\nYour Count: $${currentCashTotal.toFixed(2)}`;
         msg += `\nExpected:   $${expectedCash.toFixed(2)}`;
         msg += `\nVariance:   $${cashVariance.toFixed(2)} (${stat})`;

         if (activePayments.length > 0) {
            const ncStat = Math.abs(ncVarianceTotal) < 0.01 ? "BALANCED" : (ncVarianceTotal > 0 ? "OVER" : "UNDER");
            msg += `\n\n--- TERMINAL RECONCILIATION ---`;
            msg += `\nYour Count: $${ncActualTotal.toFixed(2)}`;
            msg += `\nExpected:   $${ncExpectedTotal.toFixed(2)}`;
            msg += `\nVariance:   $${ncVarianceTotal.toFixed(2)} (${ncStat})`;
         }
      }
      msg += `\n${detailsText}`;

      setSuccessHeader(
        `${tillName || "Till"} ${
          sessionType === "Open"
            ? "Opened"
            : "Closed"
        } Successfully`
      );
      setSuccessBody(msg);
      setShowSuccess(true);

    } catch (err: any) {
      console.error("Save Error:", err);
      alert(`Failed to save session.\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintZReport = () => {
    const printWindow = window.open("", "_blank", "width=600,height=800");
    if (!printWindow) {
      alert("Please allow pop-ups to print the Z-Report.");
      return;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>
          Z-Report - ${storeName} - ${tillName || "Till"}
        </title>
        <style>
          @media print {
            @page { margin: 0; }
            body { margin: 10mm; }
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            color: #000;
            line-height: 1.4;
            max-width: 80mm; /* Standard receipt width */
            margin: 0 auto;
            padding: 20px;
          }
          .title {
            text-align: center;
            font-family: Arial, sans-serif;
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .header-info {
            font-family: Arial, sans-serif;
            font-size: 12px;
            margin-bottom: 20px;
          }
          .content {
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <div class="title">Z-REPORT SUMMARY</div>
        <div class="header-info">
          <div>Store: ${storeName}</div>
          <div>Till: ${tillName || "Unknown Till"}</div>
          <div>User: ${user?.username || "Unknown"}</div>
        </div>
        <div class="content">${successBody}</div>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleModalClose = () => {
    setShowSuccess(false);
    setActiveModule("Sell");
  };
  

  // --- UI RENDER ---
  if (isLoading) {
    return <div className="flex h-full items-center justify-center bg-[#181818]"><p className="text-gray-500">Loading Configuration...</p></div>;
  }

  // Project the header date to the specific store's timezone
  const currentStoreTz = getStoreTimezone(storeProvince, storeId === "ALL_STORES");
  const headerDateStr = new Intl.DateTimeFormat('en-US', { 
      timeZone: currentStoreTz, 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
  }).format(new Date());

  return (
    <div className="relative flex flex-col h-full w-full bg-[#181818] font-sans overflow-hidden">
      
      <div className="p-8 pb-4 flex flex-col items-center">
         <h1 className="text-[28px] font-bold tracking-wide" style={{ color: themeColor }}>
           {sessionType} Till - {headerDateStr}
         </h1>
         <p className="text-gray-500 text-[12px] mt-2 font-medium">
           User: {user?.username} | Store: {storeName}
         </p>
      </div>
      <div className="flex-1 overflow-y-auto px-10 pb-10 flex flex-col items-center scrollbar-hide">
         
         {/* Cash Grid */}
         <div className="bg-[#1e1e1e] p-8 rounded-xl border border-gray-800 shadow-xl w-full max-w-[1050px]">
            <div className="grid grid-cols-5 gap-x-4 gap-y-6">
               {DENOMINATIONS.map((d, i) => (
                 <div key={d.label} className="flex justify-center items-center gap-3 w-full">
                    <span className="text-gray-300 font-bold text-[14px] whitespace-nowrap w-[95px] text-right shrink-0">
                      {d.label}
                    </span>
                    <input 
                      type="number"
                      value={denomCounts[d.label]}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                         const val = e.target.value;
                         if (val === "" || /^\d+$/.test(val)) {
                            setDenomCounts(prev => ({...prev, [d.label]: val}));
                         }
                      }}
                      style={{ "--focus-color": themeColor } as React.CSSProperties}
                      className="w-[80px] shrink-0 bg-[#141414] border border-gray-600 rounded-lg py-2 px-2 text-center text-white font-bold text-[15px] outline-none focus:[border-color:var(--focus-color)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                 </div>
               ))}
            </div>
         </div>

         {/* Totals Engine */}
         <div className="mt-8 flex flex-col items-center">
            <h2 className="text-[34px] font-bold text-white tracking-tight">Total Cash Count: ${currentCashTotal.toFixed(2)}</h2>
            
            {sessionType === "Close" && !blindCloseEnabled && (
               <div className="mt-2 text-center">
                 <p className="text-gray-400 text-[16px] font-medium">Expected Cash: ${expectedCash.toFixed(2)}</p>
                 <p className={`text-[18px] font-bold mt-1 ${isBalanced ? 'text-[#2CC985]' : (cashVariance > 0 ? 'text-[#2CC985]' : 'text-[#C92C2C]')}`}>
                   Variance: {cashVariance > 0 ? '+' : ''}${cashVariance.toFixed(2)} ({isBalanced ? 'BALANCED' : (cashVariance > 0 ? 'OVER' : 'UNDER')})
                 </p>
               </div>
            )}
         </div>

         {/* Non-Cash Terminals */}
         {sessionType === "Close" && activePayments.length > 0 && (
           <div className="mt-6 bg-[#1e1e1e] p-6 rounded-xl border border-gray-800 shadow-xl w-full max-w-[850px] flex flex-col items-center">
             <h3 className="text-[20px] font-bold mb-6 tracking-wide" style={{ color: themeColor }}>Terminal Reconciliation</h3>
             
             <div className="w-full grid grid-cols-2 gap-x-16 gap-y-4 px-10">
               {activePayments.filter(m => m.toLowerCase() !== 'gift card').map(method => (
                 <div key={method} className="flex justify-between items-center w-full">
                   <div className="flex flex-col">
                     <span className="text-gray-300 font-bold text-[15px]">
                       {method} 
                     </span>
                     {!blindCloseEnabled && (
                       <span className="text-gray-500 font-normal text-[12px] mt-0.5">(Exp: ${(expectedNonCash[method] || 0).toFixed(2)})</span>
                     )}
                   </div>
                   <input 
                      type="text"
                      value={nonCashInputs[method]}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                         const val = e.target.value;
                         if (val === "" || val === "." || val === "-" || val === "-." || /^-?\d*\.?\d*$/.test(val)) {
                            setNonCashInputs(prev => ({...prev, [method]: val}));
                         }
                      }}
                      style={{ "--focus-color": themeColor } as React.CSSProperties}
                      className="w-[90px] bg-[#141414] border border-gray-600 rounded-lg py-2 px-3 text-center text-white font-bold text-[15px] outline-none focus:[border-color:var(--focus-color)] transition-colors"
                    />
                 </div>
               ))}
             </div>
           </div>
         )}

         <div className="mt-8 w-[500px]">
            <label className="text-gray-300 font-bold text-[14px] block mb-2 pl-2">Notes:</label>
            <textarea 
               value={notes}
               onChange={(e) => setNotes(e.target.value)}
               className="w-full bg-[#141414] border border-gray-700 rounded-xl p-4 text-white text-[15px] resize-none h-[100px] outline-none focus:border-gray-500 transition-colors"
            />
         </div>

         <div className="mt-8 mb-5 w-[400px]">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              style={{ backgroundColor: themeColor }}
              className="w-full py-4 rounded-xl text-white font-bold text-[16px] tracking-widest uppercase transition-transform active:scale-95 shadow-lg disabled:opacity-50 hover:brightness-110"
            >
              {isSaving
                ? "SAVING..."
                : `CONFIRM ${
                    sessionType === "Close"
                      ? "CLOSING"
                      : "OPENING"
                  } BALANCE`}
            </button>
         </div>

         {managementReviewType && (
           <div className="w-full max-w-[850px] mb-10 px-6 text-center">
             <p className="text-orange-400 text-[13px] font-semibold leading-relaxed">
               {managementReviewType === "duplicate"
                 ? (
                     "Management attention required: Duplicate till closing records must be reviewed and approved in the official Chronara Key desktop application."
                   )
                 : (
                     "Management attention required: One or more past till reports require updating in the official Chronara Key desktop application."
                   )}
             </p>
           </div>
         )}

      </div>

      {sessionType === "Close" && showClosingSyncReminder && (
        <div className="absolute bottom-6 right-6 z-40 w-[390px] rounded-xl border border-orange-500/50 bg-[#202020] shadow-2xl">
          <div className="flex items-start gap-3 p-5">
            <div className="text-orange-400 text-[22px] leading-none">
              ⚠
            </div>

            <div className="flex-1">
              <p className="text-white text-[15px] font-bold">
                Before Closing
              </p>

              <p className="mt-2 text-gray-300 text-[13px] leading-relaxed">
                If any computer went offline today, make sure it has
                reconnected and finished syncing before closing this till.
                This helps ensure all sales and activity are included in
                the final till report.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setShowClosingSyncReminder(false)
              }
              className="text-gray-500 hover:text-white text-[20px] leading-none"
              aria-label="Dismiss closing sync reminder"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* --- SUCCESS MODAL OVERLAY --- */}
      {showSuccess && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl border border-gray-600 shadow-2xl w-full max-w-[500px] flex flex-col max-h-[85vh]">
            
            <div className="p-6 pb-2 text-center shrink-0">
               <h2 className="text-2xl font-bold tracking-wide" style={{ color: themeColor }}>{successHeader}</h2>
            </div>

            <div className="p-6 flex-1 overflow-y-auto scrollbar-hide">
               <div className="bg-[#141414] border border-gray-700 rounded-lg p-5">
                  <pre className="text-gray-300 font-sans text-[14px] whitespace-pre-wrap">{successBody}</pre>
               </div>
            </div>

            <div className="p-6 pt-2 shrink-0 flex gap-4">
                <button 
                  onClick={handlePrintZReport}
                  style={{ backgroundColor: themeColor }}
                  className="flex-1 py-3 rounded-lg text-white font-bold text-[15px] transition-transform active:scale-95 shadow-md tracking-wider uppercase hover:brightness-110"
                >
                  PRINT Z-REPORT
                </button>
                <button 
                  onClick={handleModalClose}
                  className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold text-[15px] transition-transform active:scale-95 shadow-md tracking-wider uppercase border border-gray-600"
                >
                  OKAY
                </button>
             </div>

          </div>
        </div>
      )}

    </div>
  );
}