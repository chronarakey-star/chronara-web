"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../../utils/supabase";

interface OpenCloseProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  user: any;
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

export default function OpenCloseModule({ companyId, storeId, themeColor, user }: OpenCloseProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storeName, setStoreName] = useState("");
  
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
  const [showSuccess, setShowSuccess] = useState(false);
  const [successHeader, setSuccessHeader] = useState("");
  const [successBody, setSuccessBody] = useState("");

  // Keep Ref synced with actual state so the heartbeat always knows what screen we are looking at
  useEffect(() => {
    sessionTypeRef.current = sessionType;
  }, [sessionType]);

  // --- INITIALIZATION ---
  useEffect(() => {
    loadSessionData();
  }, [companyId, storeId]);

  const loadSessionData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Store Name & Company Config
      let sName = storeId === "ALL_STORES" ? "All Stores" : storeId;
      
      if (storeId && storeId !== "ALL_STORES") {
        const { data: sData } = await supabase.from('stores').select('name').eq('id', storeId).single();
        if (sData?.name) sName = sData.name;
      }
      setStoreName(sName);

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
      const { data: lastSession } = await supabase
        .from('cash_sessions')
        .select('type, timestamp, total')
        .eq('company_id', companyId)
        .eq('store_id', storeId === "ALL_STORES" ? null : storeId)
        .in('type', ['Open', 'Close'])
        .neq('is_deleted', true)
        .order('timestamp', { ascending: false })
        .limit(1);

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
      if (currentType === "Close" && ts > 0) {
         await calculateExpectations(ts, openingFloat, methods);
      }

    } catch (err) {
      console.error("Failed to load session data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // --- NEW: THE 3-SECOND CLOUD HEARTBEAT ---
  // ==========================================
  useEffect(() => {
    if (!companyId) return;

    const pingCloudStatus = async () => {
      try {
        let query = supabase
          .from('cash_sessions')
          .select('type')
          .eq('company_id', companyId)
          .in('type', ['Open', 'Close'])
          .neq('is_deleted', true)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (storeId && storeId !== "ALL_STORES") {
          query = query.eq('store_id', storeId);
        } else {
          query = query.is('store_id', null);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          const remoteLastType = data[0].type;
          const expectedNextAction = remoteLastType === "Open" ? "Close" : "Open";
          
          // If the cloud says we should be looking at a different screen, instantly reload!
          if (expectedNextAction !== sessionTypeRef.current) {
            console.log("State mismatch detected by heartbeat. Syncing...");
            loadSessionData();
          }
        }
      } catch (err) {
        // Silently fail if network drops temporarily
      }
    };

    const intervalId = setInterval(pingCloudStatus, 3000);
    return () => clearInterval(intervalId); // Cleanup on dismount
  }, [companyId, storeId]);
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

  const calculateExpectations = async (sinceTs: number, openingFloat: number, currentMethods: string[]) => {
    try {
      const sinceDate = new Date(sinceTs * 1000);
      const year = sinceDate.getFullYear();
      const month = String(sinceDate.getMonth() + 1).padStart(2, "0");
      const day = String(sinceDate.getDate()).padStart(2, "0");
      const hours = String(sinceDate.getHours()).padStart(2, "0");
      const mins = String(sinceDate.getMinutes()).padStart(2, "0");
      const secs = String(sinceDate.getSeconds()).padStart(2, "0");
      const sinceStr = `${year}-${month}-${day} ${hours}:${mins}:${secs}`;

      const targetStoreId = storeId === "ALL_STORES" ? null : storeId;

      // Cash Drops/Adds
      let dropsQuery = supabase.from('cash_sessions')
        .select('total')
        .eq('company_id', companyId)
        .gte('timestamp', sinceTs)
        .in('type', ['Add Cash', 'Remove Cash'])
        .neq('is_deleted', true);
      
      if (targetStoreId) dropsQuery = dropsQuery.eq('store_id', targetStoreId);
      else dropsQuery = dropsQuery.is('store_id', null);

      const dropsData = await fetchAll(dropsQuery);
      const netDrops = dropsData.reduce((acc, row) => acc + parseFloat(row.total || 0), 0);

      // Cash Sales
      let salesQuery = supabase.from('sales')
        .select('id, total')
        .eq('company_id', companyId)
        .gte('date', sinceStr)
        .eq('method', 'Cash')
        .neq('is_deleted', true);

      if (targetStoreId) salesQuery = salesQuery.eq('store_id', targetStoreId);
      else salesQuery = salesQuery.is('store_id', null);

      const salesData = await fetchAll(salesQuery);
      const cashSales = salesData.reduce((acc, row) => acc + parseFloat(row.total || 0), 0);

      setExpectedCash(openingFloat + netDrops + cashSales);

      // Non-Cash Expectations
      let allSalesQuery = supabase.from('sales')
        .select('id')
        .eq('company_id', companyId)
        .gte('date', sinceStr)
        .neq('is_deleted', true);
        
      if (targetStoreId) allSalesQuery = allSalesQuery.eq('store_id', targetStoreId);
      else allSalesQuery = allSalesQuery.is('store_id', null);

      const allSalesData = await fetchAll(allSalesQuery);
      const saleIds = allSalesData.map(s => s.id);

      const ncTotals: Record<string, number> = {};
      currentMethods.forEach(m => ncTotals[m] = 0.0);

      if (saleIds.length > 0) {
         let paymentsQuery = supabase.from('sale_payments')
           .select('method, amount')
           .in('sale_id', saleIds)
           .neq('is_deleted', true);
           
         const paymentsData = await fetchAll(paymentsQuery);
         paymentsData.forEach(p => {
            const m = p.method;
            if (m && m.toLowerCase() !== 'cash') {
               ncTotals[m] = (ncTotals[m] || 0) + parseFloat(p.amount || 0);
            }
         });
      }
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
    // --- NEW: PRE-SAVE CLOUD VERIFICATION (RACE CONDITION FIX) ---
    // =======================================================
    try {
      let query = supabase
        .from('cash_sessions')
        .select('type')
        .eq('company_id', companyId)
        .in('type', ['Open', 'Close'])
        .neq('is_deleted', true)
        .order('timestamp', { ascending: false })
        .limit(1);

      if (storeId && storeId !== "ALL_STORES") query = query.eq('store_id', storeId);
      else query = query.is('store_id', null);

      const { data: preSaveData, error: preSaveError } = await query;
      if (!preSaveError && preSaveData && preSaveData.length > 0) {
        const cloudLastType = preSaveData[0].type;
        const expectedNextAction = cloudLastType === "Open" ? "Close" : "Open";
        
        if (expectedNextAction !== sessionTypeRef.current) {
            const msgAction = cloudLastType === "Open" ? "opened" : "closed";
            alert(`Conflict: Store is already ${msgAction} on another device.\nThe screen will now refresh.`);
            setIsSaving(false);
            loadSessionData();
            return; // ABORT SAVE
        }
      }
    } catch (err) {
      console.warn("Pre-save verification bypassed due to network error", err);
    }
    // =======================================================

    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      const secs = String(now.getSeconds()).padStart(2, "0");
      const todayDateStr = `${year}-${month}-${day}`;
      const nowIso = `${todayDateStr} ${hours}:${mins}:${secs}`;
      const nowTs = Math.floor(now.getTime() / 1000);
      const targetStoreId = storeId === "ALL_STORES" ? null : storeId;

      const sessionId = `cs_${crypto.randomUUID().replace(/-/g, "")}`;

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

        // Auto Inject internal gift card amounts
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

      // 1. Save Cash Session (FIXED: using nowIso for the date field so sync_worker catches it!)
      const { error: sessionError } = await supabase.from('cash_sessions').insert([{
         id: sessionId,
         date: nowIso, 
         timestamp: nowTs,
         type: sessionType,
         company_id: companyId,
         store_id: targetStoreId,
         user: user?.username || "Unknown",
         total: currentCashTotal,
         expected_cash: sessionType === "Close" ? expectedCash : 0,
         variance: sessionType === "Close" ? cashVariance : 0,
         notes: notes.trim(),
         denominations: denomJsonStr
      }]);

      if (sessionError) throw sessionError;

      // ==========================================
      // PHASE 4: BOOKKEEPING INTEGRATION (Z-REPORT)
      // ==========================================
      if (sessionType === "Close") {
          // A. Dynamically Ensure System Accounts Exist
          const sysAccounts = [
              { name: "Cash Over/Short", type: "Expense", tax: "E" },
              { name: "Tips Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Gift Card Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Commission Payable", type: "Current Liability", tax: "Exempt" },
              { name: "Commission Expense", type: "Expense", tax: "Exempt" }
          ];

          const { data: existingAccs } = await supabase.from('chart_of_accounts').select('name').eq('company_id', companyId).in('name', sysAccounts.map(a => a.name));
          const existingNames = existingAccs?.map(a => a.name) || [];

          for (const acc of sysAccounts) {
              if (!existingNames.includes(acc.name)) {
                  const safeName = acc.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                  await supabase.from('chart_of_accounts').insert([{
                      id: `acc_def_${safeName}`,
                      company_id: companyId,
                      name: acc.name,
                      account_type: acc.type,
                      default_tax: acc.tax,
                      is_prime: 1,
                      parent_name: ''
                  }]);
              }
          }

          // B. Aggregate Data for the Shift
          const sinceStr = new Date(lastOpenTimestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);
          
          let shiftSalesQuery = supabase.from('sales').select('id, total, tax_val, prov_tax_val').eq('company_id', companyId).gte('date', sinceStr).neq('is_deleted', true);
          if (targetStoreId) shiftSalesQuery = shiftSalesQuery.eq('store_id', targetStoreId);
          else shiftSalesQuery = shiftSalesQuery.is('store_id', null);

          const shiftSales = await fetchAll(shiftSalesQuery);
          const saleIds = shiftSales.map(s => s.id);

          const grossSales = shiftSales.reduce((sum, s) => sum + (s.total || 0), 0);
          const totalTax = shiftSales.reduce((sum, s) => sum + (s.tax_val || 0) + (s.prov_tax_val || 0), 0);

          let shiftTips = 0;
          let shiftCommissions = 0;
          let gcLoads = 0;
          let totalCogs = 0;

          if (saleIds.length > 0) {
             const tipsData = await fetchAll(supabase.from('tips_ledger').select('amount').in('sale_id', saleIds).neq('is_deleted', true));
             shiftTips = tipsData.reduce((sum, t) => sum + (t.amount || 0), 0);

             const commsData = await fetchAll(supabase.from('commissions_ledger').select('amount').in('sale_id', saleIds).neq('is_deleted', true));
             shiftCommissions = commsData.reduce((sum, c) => sum + (c.amount || 0), 0);

             const itemsData = await fetchAll(supabase.from('sale_items').select('sku, qty, price, cost').in('sale_id', saleIds).neq('is_deleted', true));
             
             itemsData.forEach(item => {
                 if (item.sku === 'SYS_GIFT_CARD') {
                     gcLoads += (item.qty * item.price);
                 } else if (item.sku !== 'SYS_TIP') {
                     totalCogs += (item.qty * item.cost);
                 }
             });
          }

          const netSales = grossSales - totalTax - shiftTips - gcLoads;

          // C. Create Master Journal Entry
          const jeId = `je_${crypto.randomUUID().replace(/-/g, "")}`;
          const totalVariance = cashVariance + ncVarianceTotal;
          const varStr = totalVariance > 0 ? `+$${totalVariance.toFixed(2)}` : `-$${Math.abs(totalVariance).toFixed(2)}`;
          const jeDesc = Math.abs(totalVariance) > 0.01 ? `End of Day Z-Report (Variance: ${varStr})` : "End of Day Z-Report (Balanced)";

          await supabase.from('journal_entries').insert([{
             id: jeId,
             company_id: companyId,
             store_id: targetStoreId,
             date: todayDateStr,
             type: 'Z-Report',
             ref_number: sessionId,
             total_amount: grossSales, // Will be updated
             description: jeDesc,
             created_at: nowIso,
             username: user?.username || "System"
          }]);

          const lines: any[] = [];
          const pushLine = (acc: string, amt: number, isDebitNormal: boolean) => {
             if (Math.abs(amt) < 0.001) return;
             let dr = 0, cr = 0;
             if (isDebitNormal) {
                if (amt > 0) dr = amt; else cr = Math.abs(amt);
             } else {
                if (amt > 0) cr = amt; else dr = Math.abs(amt);
             }
             lines.push({ entry_id: jeId, account: acc, debit: dr, credit: cr });
          };

          // Credits
          pushLine('Sales', netSales, true);
          pushLine('HST/GST Payable', totalTax, true);
          pushLine('Tips Payable', shiftTips, true);
          pushLine('Gift Card Payable', gcLoads, true);
          pushLine('Commission Payable', shiftCommissions, true);
          pushLine('Commission Expense', shiftCommissions, false);
          pushLine('Cost of Goods Sold', totalCogs, false);
          pushLine('Inventory Asset', totalCogs, true);

          // Debits (Undeposited Funds & Terminals)
          let cashSalesFromDB = 0;
          if (saleIds.length > 0) {
             const cashPayData = await fetchAll(supabase.from('sale_payments').select('amount').in('sale_id', saleIds).eq('method', 'Cash').neq('is_deleted', true));
             cashSalesFromDB = cashPayData.reduce((sum, p) => sum + (p.amount || 0), 0);
          }
          const actualCashFromSales = cashSalesFromDB + cashVariance;
          pushLine('Undeposited Funds', actualCashFromSales, false);

          activePayments.forEach(method => {
             const actVal = denomJsonDict[`${method}_Actual`] || 0.0;
             const targetAcc = method.toLowerCase() === 'gift card' ? 'Gift Card Payable' : 'Undeposited Funds';
             pushLine(targetAcc, actVal, false);
          });

          // Variance
          pushLine('Cash Over/Short', totalVariance, false);

          if (lines.length > 0) {
             await supabase.from('journal_lines').insert(lines);
             const jeTotalDr = lines.reduce((sum, l) => sum + l.debit, 0);
             await supabase.from('journal_entries').update({ total_amount: jeTotalDr }).eq('id', jeId);
          }
      }

      // Log Action
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
        date: todayDateStr,
        timestamp: nowTs,
        company_id: companyId,
        store_id: targetStoreId,
        user_id: user?.id || null,
        user_name: user?.username || "Unknown",
        action: actionType,
        description: fullLogDesc,
      }]);

      // Show Success
      let msg = `Till ${sessionType}ed successfully.`;
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

      setSuccessHeader(`Session Saved Successfully`);
      setSuccessBody(msg);
      setShowSuccess(true);

    } catch (err: any) {
      console.error("Save Error:", err);
      alert(`Failed to save session.\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleModalClose = () => {
    setShowSuccess(false);
    loadSessionData(); // Flip Open/Close state
  };

  // --- UI RENDER ---
  if (isLoading) {
    return <div className="flex h-full items-center justify-center bg-[#181818]"><p className="text-gray-500">Loading Configuration...</p></div>;
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#181818] font-sans overflow-hidden">
      
      <div className="p-8 pb-4 flex flex-col items-center">
         <h1 className="text-[28px] font-bold tracking-wide" style={{ color: themeColor }}>
           {sessionType} Till - {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
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
                         if (val === "" || val === "." || /^\d*\.?\d*$/.test(val)) {
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

         <div className="mt-8 mb-10 w-[400px]">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              style={{ backgroundColor: themeColor }}
              className="w-full py-4 rounded-xl text-white font-bold text-[16px] tracking-widest uppercase transition-transform active:scale-95 shadow-lg disabled:opacity-50 hover:brightness-110"
            >
              {isSaving ? "SAVING..." : `CONFIRM ${sessionType === "Close" ? 'CLOSING' : 'OPENING'} BALANCE`}
            </button>
         </div>

      </div>

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
                 onClick={() => alert("Print Z-Report module is currently under construction for the web app.")}
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