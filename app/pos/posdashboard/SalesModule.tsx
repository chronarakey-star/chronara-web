"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../../utils/supabase";

// --- INTERFACES ---
interface SalesModuleProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  user: any;
  onInitiateRefund?: (saleData: any) => void;
}

interface Sale {
  id: string;
  date: string;
  total: number;
  method: string;
  user_id: string;
  store_id: string;
  customer: string;
  is_refund_of: string | null;
  tax_val: number;
  prov_tax_val: number; // <--- THE FIX: Now it pulls provincial tax from the DB!
  promo_code: string;
  promo_disc_type?: string | null;
  promo_disc_val?: number;
  manual_disc_type?: string | null;
  manual_disc_val?: number;
  status_card_number: string | null;
}

interface SaleItem {
  id: number;
  sale_id: string;
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  price: number;
  disc_type: string | null;
  disc_val: number;
  is_damaged: number;
  ingredients_snapshot: string | null;
}

interface SalePayment {
  id: number;
  method: string;
  amount: number;
}

interface SalePayment {
  id: number;
  method: string;
  amount: number;
  payment_ref: string | null;
}


// NEW HELPER FUNCTION TO ADD ABOVE COMPONENT
const getItemSurcharge = (item: any) => {
    if (!item.ingredients) return 0;
    return item.ingredients.reduce((sum: number, ing: any) => {
        const diff = ing.current_qty - ing.base_qty;
        return diff > 0 && ing.extra_cost > 0 ? sum + (diff * ing.extra_cost) : sum;
    }, 0);
};

const printWebReceipt = (receiptData: any, configJson: any) => {
    const defaultSettings = {
        font: "Times-Roman",
        paper_width: "80(mm)",
        company_size: 30,
        std_size: 9,
        bottom_text: "",
        thank_you_text: "Thank you for your business!",
        show_barcode: true
    };
    
    let receiptConfig = defaultSettings;
    if (configJson && configJson.receipt_settings) {
        receiptConfig = { ...defaultSettings, ...configJson.receipt_settings };
    }

    const is58 = receiptConfig.paper_width.includes("58");
    const isLetter = receiptConfig.paper_width.includes("8.5");
    
    const width = isLetter ? "8.5in" : (is58 ? "58mm" : "80mm");
    const fontSize = `${receiptConfig.std_size}pt`;
    const companyFontSize = `${receiptConfig.company_size}pt`;
    
    let html = `
        <html>
        <head>
            <style>
                body {
                    font-family: ${receiptConfig.font === 'Courier' ? 'Courier, monospace' : (receiptConfig.font === 'Helvetica' ? 'Helvetica, sans-serif' : 'Times New Roman, serif')};
                    width: ${width};
                    margin: 0 auto;
                    padding: 10px;
                    color: black;
                    font-size: ${fontSize};
                }
                .center { text-align: center; }
                .left { text-align: left; }
                .right { text-align: right; }
                .bold { font-weight: bold; }
                .flex { display: flex; justify-content: space-between; }
                .divider { border-top: 1px dashed black; margin: 5px 0; }
                .solid-divider { border-top: 1px solid black; margin: 5px 0; }
                .item-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
                .sub-row { display: flex; justify-content: space-between; font-size: 0.9em; color: #333; margin-left: 10px; }
                .barcode { text-align: center; font-family: 'Libre Barcode 128', monospace; font-size: 40px; margin-top: 10px; }
            </style>
            <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="center bold" style="font-size: ${companyFontSize}; margin-bottom: 5px;">${receiptData.companyName}</div>
    `;

    if (configJson && configJson.store_info) {
        const store = configJson.store_info;
        if (store.address) html += `<div class="center">${store.address}</div>`;
        const cityPostal = [store.city, store.postal].filter(Boolean).join(", ");
        if (cityPostal) html += `<div class="center">${cityPostal}</div>`;
        if (store.phone) html += `<div class="center">Tel: ${store.phone}</div>`;
        if (store.email) html += `<div class="center">${store.email}</div>`;
        html += `<div style="margin-bottom: 5px;"></div>`;
    }

    html += `
            <div class="center">Date: ${receiptData.date}</div>
            <div class="center">Invoice #: ${String(receiptData.sale_id).slice(-6)}</div>
            <div class="center">Served by: ${receiptData.cashier}</div>
            ${receiptData.customer && receiptData.customer !== 'Guest' ? `<div class="center">Customer: ${receiptData.customer}</div>` : ''}
            
            <div class="solid-divider"></div>
            <div class="flex bold"><span>ITEM</span><span>AMOUNT</span></div>
            <div class="solid-divider"></div>
    `;

    let discountableSub = 0.0;

    (receiptData.items || []).forEach((item: any) => {
        const qty = parseFloat(item.qty || 0);
        // The price from the database already includes ingredient surcharges
        const dbUnitPrice = parseFloat(item.price || 0); 
        let surchargeTotal = 0;
        let ingListHtml = '';

        if (item.ingredients) {
            item.ingredients.forEach((ing: any) => {
                const diff = parseFloat(ing.current_qty || 0) - parseFloat(ing.base_qty || 0);
                const cost = parseFloat(ing.extra_cost || 0);
                
                // EXACT BURGER LOGIC: (Less) doesn't refund, (Add) prints visually, but only charges if extra cost > 0
                if (diff < -0.001) {
                    const absDiff = Math.abs(diff);
                    const qtyStr = Number.isInteger(absDiff) ? absDiff.toString() : absDiff.toFixed(2);
                    ingListHtml += `<div class="sub-row"><span>(Less) ${qtyStr}x ${ing.name}</span><span></span></div>`;
                } else if (diff > 0.001) {
                    const qtyStr = Number.isInteger(diff) ? diff.toString() : diff.toFixed(2);
                    if (cost > 0) {
                        const lineCost = diff * cost * qty;
                        surchargeTotal += lineCost;
                        ingListHtml += `<div class="sub-row"><span>(Add) ${qtyStr}x ${ing.name}</span><span>$${lineCost.toFixed(2)}</span></div>`;
                    } else {
                        ingListHtml += `<div class="sub-row"><span>(Add) ${qtyStr}x ${ing.name}</span><span></span></div>`;
                    }
                }
            });
        }

        // Reverse-engineer the base price for visual display
        const combinedLineTotal = dbUnitPrice * qty;
        const baseLineTotal = combinedLineTotal - surchargeTotal;
        const baseUnitPrice = qty !== 0 ? baseLineTotal / qty : dbUnitPrice;

        html += `<div class="item-row bold"><span>${item.name}</span><span>$${baseLineTotal.toFixed(2)}</span></div>`;
        
        // THE FIX: Bulletproof name-check fallback for system items
        const isTip = item.is_tip || item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
        const isGiftCard = item.is_gift_card || item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');

        if (!isTip && !isGiftCard) {
            const qtyStr = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
            // Display the base unit price visually
            html += `<div class="sub-row"><span>${qtyStr} @ $${baseUnitPrice.toFixed(2)}/ea</span></div>`;
            
            // Subtotal math uses the true combined line value
            let lineRaw = combinedLineTotal;
            if (item.disc_type === '%') {
                lineRaw -= lineRaw * (parseFloat(item.disc_val || 0) / 100);
            } else if (item.disc_type === '$') {
                if (lineRaw < 0) lineRaw += Math.abs(parseFloat(item.disc_val || 0));
                else lineRaw -= parseFloat(item.disc_val || 0);
            }
            // THE FIX: Use absolute value to calculate global discounts on refunds
            discountableSub += Math.abs(lineRaw); 
        }

        if (item.disc_type) {
            const discVal = parseFloat(item.disc_val || 0);
            let amt = item.disc_type === '%' ? Math.abs(combinedLineTotal * (discVal / 100.0)) : Math.abs(discVal);
            let sign = combinedLineTotal < 0 ? '+' : '-';
            html += `<div class="sub-row"><span>Discount (${discVal}${item.disc_type === '%' ? '%' : ''})</span><span>${sign}$${amt.toFixed(2)}</span></div>`;
        }

        html += ingListHtml;
    });

    html += `
            <div class="solid-divider"></div>
            <div class="flex"><span>Subtotal</span><span>$${receiptData.subtotal}</span></div>
    `;

    let currentRunningSub = Math.abs(discountableSub);
    const subVal = parseFloat(String(receiptData.subtotal).replace(/[^0-9.-]+/g,""));
    let isRefund = subVal < 0;

    const discountsToPrint = [];
    if (receiptData.promo_discount?.type) discountsToPrint.push({ label: "Promo", key: "promo_discount", data: receiptData.promo_discount });
    if (receiptData.manual_discount?.type) discountsToPrint.push({ label: "Discount", key: "manual_discount", data: receiptData.manual_discount });

    discountsToPrint.forEach(disc => {
        let sign = "-";
        let amt = 0.0;
        const rawVal = parseFloat(disc.data.val || 0);
        
        if (disc.data.type === "%") {
            amt = currentRunningSub * (rawVal / 100.0);
            sign = isRefund ? "+" : "-";
        } else {
            amt = Math.abs(rawVal);
            if (isRefund) sign = rawVal < 0 ? "-" : "+";
            else sign = "-";
        }

        if (amt >= 0.001) {
            currentRunningSub = Math.max(0, currentRunningSub - amt);
            const pctSuffix = disc.data.type === "%" ? "%" : "";
            const codeOrVal = disc.key === 'promo_discount' ? (receiptData.promo_code || `${rawVal}${pctSuffix}`) : `${rawVal}${pctSuffix}`;
            
            html += `<div class="flex"><span>${disc.label} (${codeOrVal})</span><span>${sign}$${amt.toFixed(2)}</span></div>`;
        }
    });

    if (receiptData.tax_breakdown && Object.keys(receiptData.tax_breakdown).length > 0) {
        Object.entries(receiptData.tax_breakdown).forEach(([label, amt]) => {
            html += `<div class="flex"><span>${label}</span><span>$${parseFloat(amt as string).toFixed(2)}</span></div>`;
        });
    } else {
        const taxLabel = receiptData.status_card && receiptData.status_card !== 'None' ? "Tax (Native Exempt)" : "Tax";
        html += `<div class="flex"><span>${taxLabel}</span><span>$${receiptData.tax}</span></div>`;
    }

    html += `
            <div class="solid-divider" style="margin-top:10px;"></div>
            <div class="flex bold" style="font-size: 1.2em;"><span>TOTAL</span><span>$${receiptData.total}</span></div>
            <div style="margin-bottom:10px;"></div>
    `;

    // THE FIX: Break Gift Card into two separate HTML rows using simple divs
    (receiptData.payments || []).forEach((p: any) => {
        const methodStr = p.method ? String(p.method).trim().toLowerCase() : "";
        if (methodStr === "gift card" && p.payment_ref) {
            html += `<div class="flex"><span>Paid via ${p.method}</span><span>$${parseFloat(p.amount || 0).toFixed(2)}</span></div>`;
            html += `<div class="flex"><span>&nbsp;&nbsp;&nbsp;(Card: ${p.payment_ref})</span><span></span></div>`;
        } else {
            html += `<div class="flex"><span>Paid via ${p.method}</span><span>$${parseFloat(p.amount || 0).toFixed(2)}</span></div>`;
        }
    });
    
    if (receiptData.gc_balances && receiptData.gc_balances.length > 0) {
        html += `<div class="solid-divider"></div>`;
        receiptData.gc_balances.forEach((gc: string) => {
             html += `<div class="center" style="font-size: 0.9em;">${gc}</div>`;
        });
    }

    html += `
            <div class="solid-divider"></div>
            ${receiptConfig.bottom_text ? `<div class="center" style="margin-top: 10px; white-space: pre-wrap;">${receiptConfig.bottom_text}</div>` : ''}
            ${receiptConfig.thank_you_text ? `<div class="center bold" style="margin-top: 10px; white-space: pre-wrap;">${receiptConfig.thank_you_text}</div>` : ''}
    `;

    if (receiptConfig.show_barcode) {
        const saleIdStr = String(receiptData.sale_id || '').replace('SALE_', '');
        const barcodeVal = saleIdStr.length >= 10 ? saleIdStr.slice(-10) : saleIdStr;
        html += `<div class="barcode">${barcodeVal}</div>`;
        html += `<div class="center" style="font-size: 0.9em; margin-top: 2px;">${barcodeVal}</div>`;
    }

    html += `
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    }
};

export default function SalesModule({ companyId, storeId, themeColor, user, onInitiateRefund }: SalesModuleProps) {
// ... [REST OF YOUR SALES MODULE CODE REMAINS UNCHANGED] ...
  // --- STATE ---
  const [rawConfig, setRawConfig] = useState<any>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // --- NEW: Heartbeat State Tracker ---
  const lastKnownCountRef = useRef<number | null>(null);

  // Pagination & Filters
  const [page, setPage] = useState(1);
  const limit = 25;
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStore, setFilterStore] = useState("ALL_STORES");
  const [filterUser, setFilterUser] = useState("ALL_USERS");
  const [filterDate, setFilterDate] = useState("");

  // Maps for ID -> Name lookup
  const [storeMap, setStoreMap] = useState<Record<string, string>>({});
  const [storeProvMap, setStoreProvMap] = useState<Record<string, string>>({}); // <--- NEW: Tracks provinces
  const [userMap, setUserMap] = useState<Record<string, string>>({});



  // Detail Modal State
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [salePayments, setSalePayments] = useState<SalePayment[]>([]);
  const [linkedRefunds, setLinkedRefunds] = useState<Sale[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- INITIALIZATION ---
  const isInitialMount = useRef(true);

  useEffect(() => {
    fetchLookups();
  }, [companyId]);

  useEffect(() => {
    // Reset to page 1 if filters change
    setPage(1);
    fetchSales(1);
  }, [companyId, filterStore, filterUser, filterDate, searchQuery]);

  useEffect(() => {
    // THE FIX: Prevent double-fetching on the very first load,
    // but ALLOW fetching when the user navigates back to page 1!
    if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
    }
    fetchSales(page);
  }, [page]);

  // --- DATA FETCHING ---
  const fetchLookups = async () => {
    if (!companyId) return;
    try {
      // --- NEW: FETCH CONFIG FOR RECEIPTS ---
      const { data: compData } = await supabase.from('companies').select('name, operating_name, config_json, province').eq('id', companyId).single();
      if (compData) {
        let config: any = {};
        if (compData.config_json) config = typeof compData.config_json === 'string' ? JSON.parse(compData.config_json) : compData.config_json;
        config.companyName = compData.operating_name || compData.name || "Our Store";
        config.province = compData.province || "ON"; // <--- Master province fallback
        setRawConfig(config);
      }

      // Fetch Stores (Uses is_active, not is_deleted)
      const { data: stores, error: storeError } = await supabase
        .from("stores")
        .select("id, name, province") // <--- THE FIX: Grab province
        .eq("company_id", companyId);
        
      if (storeError) console.error("Store fetch error:", storeError);

      const sMap: Record<string, string> = {};
      const pMap: Record<string, string> = {}; 
      stores?.forEach((s) => {
          sMap[s.id] = s.name;
          if (s.province) pMap[s.id] = s.province;
      });
      setStoreMap(sMap);
      setStoreProvMap(pMap);

      // Auto-set the store filter to the user's current store if not global
      if (storeId && storeId !== "ALL_STORES" && sMap[storeId]) {
        setFilterStore(storeId);
      }

      // Fetch Users (Uses is_active, not is_deleted)
      const { data: users, error: userError } = await supabase
        .from("users")
        .select("id, username")
        .eq("company_id", companyId);

      if (userError) console.error("User fetch error:", userError);

      const uMap: Record<string, string> = {};
      users?.forEach((u) => (uMap[u.id] = u.username));
      setUserMap(uMap);
      
    } catch (err) {
      console.error("Error fetching lookups", err);
    }
  };

  // --- PRINT HANDLER ---
  const handlePrintReceipt = () => {
    if (!selectedSale) return;
    
    // Reverse engineer the subtotal and parse the ingredient snapshots
    let calcSubtotal = 0;
    
    // 1. Parse the JSON snapshots so the receipt generator can read the sub-items
    const formattedItems = saleItems.map(item => {
        let parsedIngredients = [];
        if (item.ingredients_snapshot) {
            try {
                const snap = JSON.parse(item.ingredients_snapshot);
                parsedIngredients = snap.ingredients || [];
            } catch (e) {}
        }
        return {
            ...item,
            ingredients: parsedIngredients
        };
    });

    // 2. Calculate Subtotal using the formatted items
    formattedItems.forEach(item => {
        let lineVal = item.price * item.qty;
        if (item.disc_type === "%") {
            lineVal -= lineVal * (item.disc_val / 100);
        } else if (item.disc_type === "$") {
            if (lineVal < 0) lineVal += Math.abs(item.disc_val);
            else lineVal -= item.disc_val;
        }
        calcSubtotal += lineVal; // <-- THE FIX: Removed Math.max(0, ...)
    });

    // Format the SQLite datetime string to match Python's output
    const saleDate = new Date(selectedSale.date.replace(" ", "T"));
    const formattedDate = saleDate.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });

    // --- NEW: RECONSTRUCT TAX BREAKDOWN LABELS ---
    const storeProv = (storeProvMap[selectedSale.store_id] || rawConfig?.province || "ON").toUpperCase();
    
    let fedLabel = "GST";
    let provLabel = "PST";
    
    if (["ON", "NB", "NL", "NS", "PE"].includes(storeProv)) {
        fedLabel = "HST";
        provLabel = "";
    } else if (storeProv === "MB") {
        provLabel = "RST";
    } else if (storeProv === "QC") {
        provLabel = "QST";
    } else if (["AB", "NT", "NU", "YT"].includes(storeProv)) {
        provLabel = "";
    }

    const tax_breakdown: Record<string, number> = {};
    if (selectedSale.status_card_number && selectedSale.status_card_number !== "None") {
        // Exempt
    } else {
        const fedVal = selectedSale.tax_val || 0;
        const provVal = selectedSale.prov_tax_val || 0;
        
        if (Math.abs(fedVal) > 0.005) tax_breakdown[fedLabel] = fedVal;
        if (Math.abs(provVal) > 0.005 && provLabel) tax_breakdown[provLabel] = provVal;
        if (Math.abs(provVal) > 0.005 && !provLabel) tax_breakdown["Prov Tax"] = provVal; // Failsafe
    }
    // ---------------------------------------------

    const receiptData = {
        companyName: rawConfig?.companyName || "Our Store",
        sale_id: selectedSale.id,
        date: formattedDate,
        cashier: userMap[selectedSale.user_id] || selectedSale.user_id || "System",
        customer: selectedSale.customer || "Guest",
        items: formattedItems,
        subtotal: calcSubtotal.toFixed(2),
        tax: (parseFloat(String(selectedSale.tax_val || 0)) + parseFloat(String(selectedSale.prov_tax_val || 0))).toFixed(2),
        total: selectedSale.total.toFixed(2),
        payments: salePayments,
        change: 0,
        promo_discount: { type: selectedSale.promo_disc_type, val: selectedSale.promo_disc_val },
        manual_discount: { type: selectedSale.manual_disc_type, val: selectedSale.manual_disc_val },
        promo_code: selectedSale.promo_code,
        tax_breakdown: tax_breakdown, // <--- INJECTED HERE
        gc_balances: [] 
    };

    printWebReceipt(receiptData, rawConfig);
  };
  // ==========================================
  // --- NEW: THE 3-SECOND CLOUD HEARTBEAT ---
  // ==========================================
  useEffect(() => {
    if (!companyId) return;

    const pingCloudStatus = async () => {
      try {
        let query = supabase
          .from("sales")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .neq("is_deleted", true);

        if (filterStore !== "ALL_STORES") {
          query = query.eq("store_id", filterStore);
        }

        const { count, error } = await query;
        if (error) throw error;

        if (lastKnownCountRef.current === null) {
          lastKnownCountRef.current = count;
          return;
        }

        if (count !== lastKnownCountRef.current) {
          lastKnownCountRef.current = count;
          fetchSales(page, false); 
        }
      } catch (err) {
        // Silently fail if network drops
      }
    };

    const intervalId = setInterval(pingCloudStatus, 3000);
    return () => clearInterval(intervalId);
  }, [companyId, filterStore, filterUser, filterDate, searchQuery, page]);
  // ==========================================

  const fetchSales = async (targetPage: number, showLoadingScreen: boolean = true) => {
    if (!companyId) return;
    if (showLoadingScreen) setIsLoading(true);

    try {
      // CORE RULE: Active Filtering - Always hide is_deleted rows
      let query = supabase
        .from("sales")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .neq("is_deleted", true);

      // Apply Dropdown Filters
      if (filterStore !== "ALL_STORES") query = query.eq("store_id", filterStore);
      if (filterUser !== "ALL_USERS") query = query.eq("user_id", filterUser);
      if (filterDate) query = query.like("date", `${filterDate}%`);

      // Apply Text Search (ID or Customer)
      if (searchQuery.trim()) {
        const wild = `%${searchQuery.trim()}%`;
        query = query.or(`id.ilike.${wild},customer.ilike.${wild}`);
      }

      // Pagination setup
      const from = (targetPage - 1) * limit;
      const to = from + limit - 1;

      const { data, count, error } = await query
        .order("date", { ascending: false })
        // THE FIX: Add a secondary tie-breaker sort so items with the exact same 
        // timestamp don't get randomly shuffled across pages!
        .order("id", { ascending: true }) 
        .range(from, to);

      if (error) throw error;

      setSales(data || []);
      setTotalCount(count || 0);
      
      lastKnownCountRef.current = count;
      
    } catch (err) {
      console.error("Error fetching sales", err);
    } finally {
      if (showLoadingScreen) setIsLoading(false);
    }
  };

  const openSaleDetails = async (sale: Sale) => {
    setSelectedSale(sale);
    setSaleItems([]);
    setSalePayments([]);
    setLinkedRefunds([]);

    try {
      // 1. Fetch Items (Active Filtering)
      const { data: items } = await supabase
        .from("sale_items")
        .select("*")
        .eq("sale_id", sale.id)
        .neq("is_deleted", true);
      if (items) setSaleItems(items);

      // 2. Fetch Payments (Active Filtering)
      const { data: payments } = await supabase
        .from("sale_payments")
        .select("*")
        .eq("sale_id", sale.id)
        .neq("is_deleted", true);
      if (payments) setSalePayments(payments);

      // 3. Check for Linked Refunds (Child records pointing to this sale)
      const { data: refunds } = await supabase
        .from("sales")
        .select("*")
        .eq("is_refund_of", sale.id)
        .neq("is_deleted", true);
      if (refunds) setLinkedRefunds(refunds);
    } catch (err) {
      console.error("Error fetching sale details", err);
    }
  };

  // --- ACTIONS ---
  const handleDeleteSale = async () => {
    if (!selectedSale) return;

    if (linkedRefunds.length > 0) {
      alert("Cannot delete this sale. You must delete its linked refunds first.");
      return;
    }

    // --- BLOCK DELETION IF GIFT CARD HAS BEEN USED ---
    for (const item of saleItems) {
        if (item.sku === 'SYS_GIFT_CARD' || item.sku?.toLowerCase().includes('gift_card')) {
            try {
                if (item.ingredients_snapshot) {
                    const snap = JSON.parse(item.ingredients_snapshot);
                    const rawCNum = snap.card_number;
                    if (rawCNum) {
                        const cNum = String(rawCNum).trim();
                        const { data: gc } = await supabase.from('gift_cards').select('is_used').eq('company_id', companyId).eq('card_number', cNum).maybeSingle();
                        if (gc && (gc.is_used === 1 || gc.is_used === true || String(gc.is_used) === "1")) {
                            alert(`Cannot delete sale: Gift Card (*${cNum.slice(-4)}) has already been used.`);
                            return;
                        }
                    }
                }
            } catch (e) {
                console.error("Error checking GC status", e);
            }
        }
    }

    if (!window.confirm(`Are you sure you want to delete Sale ${formatId(selectedSale.id)}? Inventory and records will be reversed.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      // Use Python's exact datetime format: YYYY-MM-DD HH:MM:SS
      const now = new Date();
      const timestampStr = now.getFullYear() + "-" + 
                           String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                           String(now.getDate()).padStart(2, '0') + " " + 
                           String(now.getHours()).padStart(2, '0') + ":" + 
                           String(now.getMinutes()).padStart(2, '0') + ":" + 
                           String(now.getSeconds()).padStart(2, '0');

      // --- REVERSE GIFT CARD LOADS ---
      for (const item of saleItems) {
          if (item.sku === 'SYS_GIFT_CARD' || item.sku?.toLowerCase().includes('gift_card')) {
              try {
                  if (item.ingredients_snapshot) {
                      const snap = JSON.parse(item.ingredients_snapshot);
                      const rawCNum = snap.card_number;
                      if (rawCNum) {
                          const cNum = String(rawCNum).trim();
                          const loadAmt = (item.price || 0) * (item.qty || 1);
                          
                          const { data: gc } = await supabase.from('gift_cards').select('current_balance, initial_balance').eq('company_id', companyId).eq('card_number', cNum).maybeSingle();
                          
                          if (gc) {
                              const currBal = parseFloat(gc.current_balance !== null ? gc.current_balance : "0");
                              const initBal = parseFloat(gc.initial_balance !== null ? gc.initial_balance : "0");
                              const newBal = currBal - loadAmt;
                              
                              if (newBal <= 0.001 && initBal <= (loadAmt + 0.001)) {
                                  // Fully delete the card if it was only funded by this transaction and now empty
                                  await supabase.from('gift_cards').delete().eq('company_id', companyId).eq('card_number', cNum);
                              } else {
                                  // Otherwise just reduce the balance
                                  await supabase.from('gift_cards').update({ current_balance: newBal, updated_at: timestampStr }).eq('company_id', companyId).eq('card_number', cNum);
                              }
                          }
                      }
                  }
              } catch (e) {
                  console.error("GC Load Reversal Error", e);
              }
          }
      }

      // --- REVERSE GIFT CARD PAYMENTS ---
      for (const p of salePayments) {
          const methodStr = p.method ? String(p.method).trim().toLowerCase() : "";
          
          if (methodStr === "gift card" && p.payment_ref) {
              const cNum = String(p.payment_ref).trim();
              const payAmt = parseFloat(String(p.amount) || "0");
              
              // 1. Reverse balance
              const { data: gc } = await supabase.from('gift_cards').select('current_balance').eq('company_id', companyId).eq('card_number', cNum).maybeSingle();
              if (gc) {
                  const currBal = parseFloat(gc.current_balance !== null ? gc.current_balance : "0");
                  await supabase.from('gift_cards').update({
                      current_balance: currBal + payAmt,
                      updated_at: timestampStr
                  }).eq('company_id', companyId).eq('card_number', cNum);
              }

              // 2. Safely verify if this was the last active transaction
              const { data: otherPayments } = await supabase
                  .from('sale_payments')
                  .select('sale_id')
                  .ilike('method', 'gift card')
                  .eq('payment_ref', cNum)
                  .neq('is_deleted', true)
                  .neq('sale_id', selectedSale.id); // exclude the one we are currently deleting

              if (otherPayments && otherPayments.length > 0) {
                  const otherSaleIds = otherPayments.map(op => op.sale_id);
                  const { count } = await supabase
                      .from('sales')
                      .select('id', { count: 'exact', head: true })
                      .eq('company_id', companyId)
                      .neq('is_deleted', true)
                      .in('id', otherSaleIds);
                  
                  if (count === 0) {
                      await supabase.from('gift_cards').update({ is_used: 0, updated_at: timestampStr }).eq('company_id', companyId).eq('card_number', cNum);
                  }
              } else {
                  await supabase.from('gift_cards').update({ is_used: 0, updated_at: timestampStr }).eq('company_id', companyId).eq('card_number', cNum);
              }
          }
      }

      // 1. THE LEDGER MATH: Restock valid inventory (The Supabase DB trigger handles updating the product quantities now)
      const inventoryRecords: any[] = [];

      saleItems.forEach((item) => {
        const isTip = item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
        const isGiftCard = item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');

        if (item.is_damaged || isTip || isGiftCard) return;

        const qtyToRestore = item.qty;

        if (qtyToRestore !== 0) {
          let parsedIngredients = [];
          if (item.ingredients_snapshot) {
            try {
              const snap = JSON.parse(item.ingredients_snapshot);
              parsedIngredients = snap.ingredients || [];
            } catch (e) {}
          }

          if (parsedIngredients.length > 0) {
            parsedIngredients.forEach((ing: any) => {
              if (ing.is_damaged) return; 

              const ingSku = ing.sku || ing.child_sku;
              const ingQtyToRestore = qtyToRestore * parseFloat(ing.current_qty || 0);

              if (ingQtyToRestore !== 0) {
                inventoryRecords.push({
                  // THE FIX: Deterministic ID based on Sale ID and SKU
                  id: `RES_${selectedSale.id}_${ingSku}`,
                  company_id: companyId,
                  store_id: selectedSale.store_id || null,
                  product_id: null,
                  sku: ingSku,
                  qty_change: ingQtyToRestore,
                  action_type: "Delete Sale",
                  timestamp: timestampStr,
                  created_at: timestampStr
                });
              }
            });
          } else {
            inventoryRecords.push({
              // THE FIX: Deterministic ID based on Sale ID and SKU
              id: `RES_${selectedSale.id}_${item.sku || item.product_id}`,
              company_id: companyId,
              store_id: selectedSale.store_id || null,
              product_id: item.product_id || null,
              sku: item.sku || null,
              qty_change: qtyToRestore,
              action_type: "Delete Sale",
              timestamp: timestampStr,
              created_at: timestampStr
            });
          }
        }
      });

      if (inventoryRecords.length > 0) {
        const { error: invError } = await supabase.from("inventory_ledger").insert(inventoryRecords);
        if (invError) throw new Error(`Inventory Ledger: ${invError.message}`);
      }

      // 2. SOFT DELETES ONLY: Update the `date` to NOW so Python's time-filter catches the deletion!
      await supabase.from("sale_items").update({ is_deleted: true }).eq("sale_id", selectedSale.id);
      await supabase.from("sale_payments").update({ is_deleted: true }).eq("sale_id", selectedSale.id);
      await supabase.from("tips_ledger").update({ is_deleted: true, date: timestampStr }).eq("sale_id", selectedSale.id);
      
      const { error: saleError } = await supabase.from("sales").update({ is_deleted: true, date: timestampStr }).eq("id", selectedSale.id);
      if (saleError) throw new Error(`Sales Table: ${saleError.message}`);

      setSelectedSale(null);
      fetchSales(page);
    } catch (err: any) {
      console.error("Error deleting sale", err);
      alert(`Failed to delete sale: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRefund = () => {
    if (!selectedSale) return;
    
    // Package the parent sale with all child items and payments
    const fullSaleData = {
      ...selectedSale,
      items: saleItems,
      payments: salePayments
    };

    if (onInitiateRefund) {
      onInitiateRefund(fullSaleData);
    } else {
      alert("Refund routing is not connected to the parent dashboard.");
    }
  };
  // --- HELPERS ---
  const formatId = (id: string) => `#${id.replace("SALE_", "").slice(-6)}`;
  
  // Calculate Item Total mathematically identically to Python app
  const calculateItemTotal = (item: SaleItem) => {
    let lineRaw = item.price * item.qty;
    if (item.disc_type === "%") lineRaw -= lineRaw * (item.disc_val / 100);
    else if (item.disc_type === "$") lineRaw -= item.disc_val;
    return lineRaw;
  };

  // --- UI RENDER ---
  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="flex h-full w-full bg-[#181818] relative flex-col">
      {/* --- HEADER & CONTROLS --- */}
      <div className="bg-[#1e1e1e] p-6 border-b border-gray-800 shrink-0">
        <h1 className="text-3xl font-bold text-white mb-6">Sales History</h1>

        <div className="flex flex-col gap-4">
          {/* Search Bar */}
          <div className="flex">
            <input
              type="text"
              placeholder="Search (Sale #, Customer Name)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ "--focus-color": themeColor } as React.CSSProperties}
              className="flex-1 bg-[#141414] border border-gray-700 p-3 rounded-lg text-[15px] text-white outline-none focus:[border-color:var(--focus-color)] transition-colors"
            />
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-[12px] font-bold text-gray-500 uppercase">Store:</label>
              <select
                value={filterStore}
                onChange={(e) => setFilterStore(e.target.value)}
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none w-40"
              >
                <option value="ALL_STORES">All Stores</option>
                {Object.entries(storeMap)
                  .sort(([, a], [, b]) => a.localeCompare(b))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[12px] font-bold text-gray-500 uppercase">User:</label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none w-40"
              >
                <option value="ALL_USERS">All Users</option>
                {Object.entries(userMap)
                  .sort(([, a], [, b]) => a.localeCompare(b))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[12px] font-bold text-gray-500 uppercase">Date:</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none [color-scheme:dark]"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate("")}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- SCROLLABLE LIST VIEW --- */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="bg-[#1e1e1e] rounded-xl border border-gray-800 overflow-hidden shadow-lg">
          {/* Table Header */}
          <div className="flex bg-[#252525] p-4 border-b border-gray-800 text-[12px] font-bold text-gray-400 uppercase tracking-wider">
            <div className="w-[120px]">Sale #</div>
            <div className="w-[180px]">Date</div>
            <div className="w-[120px]">User</div>
            <div className="w-[150px]">Store</div>
            <div className="flex-1">Customer</div>
            <div className="w-[100px] text-right">Total</div>
            <div className="w-[120px] text-center ml-4">Action</div>
          </div>

          {/* Table Body */}
          <div className="flex flex-col">
            {isLoading ? (
              <p className="text-center text-gray-500 py-10">Loading records...</p>
            ) : sales.length === 0 ? (
              <p className="text-center text-gray-500 py-10">No records found.</p>
            ) : (
              sales.map((sale) => (
                <div
                  key={sale.id}
                  onDoubleClick={() => openSaleDetails(sale)}
                  className="flex items-center p-4 border-b border-gray-800 hover:bg-[#222222] transition-colors group cursor-pointer"
                >
                  <div className="w-[120px] font-bold text-gray-300 group-hover:text-white">{formatId(sale.id)}</div>
                  <div className="w-[180px] text-[14px] text-gray-300">{sale.date}</div>
                  <div className="w-[120px] text-[14px] text-gray-300 truncate pr-4">{userMap[sale.user_id] || (sale.user_id === user?.id ? user?.username : sale.user_id) || "System"}</div>
                  <div className="w-[150px] text-[14px] text-gray-300 truncate pr-4">{storeMap[sale.store_id] || sale.store_id || "Main Store"}</div>
                  <div className="flex-1 text-[14px] text-gray-200 font-medium truncate pr-4">{sale.customer || "Guest"}</div>
                  <div
                    className="w-[100px] text-right font-bold text-[15px]"
                    style={{ color: sale.total < 0 ? "#C92C2C" : themeColor }}
                  >
                    ${sale.total.toFixed(2)}
                  </div>
                  <div className="w-[120px] flex justify-center ml-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); openSaleDetails(sale); }}
                      style={{ backgroundColor: themeColor }}
                      className="px-4 py-1.5 rounded text-white font-bold text-[12px] hover:brightness-110 active:scale-95 transition-all shadow-sm"
                    >
                      View / Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* --- FOOTER PAGINATION --- */}
      <div className="bg-[#1e1e1e] p-4 border-t border-gray-800 flex items-center shrink-0 px-8">
        <button
          onClick={() => setPage(page - 1)}
          disabled={page === 1 || isLoading}
          style={{ backgroundColor: page === 1 || isLoading ? '#2a2a2a' : themeColor, borderColor: page === 1 || isLoading ? '#4b5563' : themeColor }}
          className="w-[100px] py-2 text-white font-bold text-sm rounded transition-colors border disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
        >
          &lt; Previous
        </button>
        <div className="font-bold text-white px-6 text-[15px]">
          Page {page}
        </div>
        <button
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages || isLoading}
          style={{ backgroundColor: page >= totalPages || isLoading ? '#2a2a2a' : themeColor, borderColor: page >= totalPages || isLoading ? '#4b5563' : themeColor }}
          className="w-[100px] py-2 text-white font-bold text-sm rounded transition-colors border disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
        >
          Next &gt;
        </button>
        <div className="ml-auto text-sm text-gray-500">
          Showing {sales.length} rows
        </div>
      </div>

      {/* ========================================================= */}
      {/* --- SALE DETAIL MODAL OVERLAY --- */}
      {/* ========================================================= */}
      {selectedSale && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="bg-[#1a1a1a] rounded-xl border border-gray-600 shadow-2xl w-full max-w-6xl h-full max-h-[800px] flex overflow-hidden">
            
            {/* LEFT: Item Sidebar */}
            <div className="w-[350px] bg-[#1e1e1e] border-r border-gray-800 flex flex-col h-full shrink-0">
              <div className="p-6 border-b border-gray-800">
                <h2 style={{ color: themeColor }} className="text-[20px] font-bold tracking-wide">Purchased Items</h2>
                <p className="text-gray-500 text-[13px] mt-1">
                  Total Qty: {saleItems.filter(i => !i.sku.includes('SYS_')).reduce((sum, i) => sum + i.qty, 0)}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide bg-[#181818]">
                {saleItems.map((item) => {
                  const lineTotal = calculateItemTotal(item);
                  const isRefundRecord = selectedSale.total < 0;
                  const displayColor = isRefundRecord ? "#C92C2C" : "white";

                  // --- NEW: Parse Ingredients Snapshot ---
                  let parsedIngredients = [];
                  if (item.ingredients_snapshot) {
                    try {
                      const snap = JSON.parse(item.ingredients_snapshot);
                      parsedIngredients = snap.ingredients || [];
                    } catch (e) {}
                  }

                  return (
                    <div key={item.id} className="bg-[#222222] p-3 rounded-lg border border-gray-800">
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-[14px]" style={{ color: displayColor }}>
                          {item.qty === 0 ? "[PARTIAL] " : `${item.qty}x `}{item.name}
                        </span>
                        <span className="font-bold text-[14px]" style={{ color: displayColor }}>
                          ${lineTotal.toFixed(2)}
                        </span>
                      </div>
                      
                      {/* Sub-status mapping (Damaged vs Restocked for refunds) */}
                      {item.qty <= 0 && isRefundRecord && (
                        <div className="mt-1">
                          {item.is_damaged === 1 ? (
                            <span className="text-[10px] font-bold text-[#C92C2C] bg-[#C92C2C]/10 px-1.5 py-0.5 rounded">[ NOT RESTOCKED ]</span>
                          ) : (
                            <span className="text-[10px] font-bold text-[#2CC985] bg-[#2CC985]/10 px-1.5 py-0.5 rounded">[ RESTOCKED ]</span>
                          )}
                        </div>
                      )}

                      {/* --- NEW: INGREDIENTS RENDERER --- */}
                      {parsedIngredients.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                          {parsedIngredients.map((ing: any, idx: number) => {
                            const mult = item.qty !== 0 ? item.qty : 1.0;
                            const totalIng = mult * (parseFloat(ing.current_qty) || 0);
                            const ingColor = totalIng < 0 ? "text-[#C92C2C]" : "text-gray-400";
                            
                            return (
                              <div key={idx} className="flex items-center gap-2 pl-2">
                                <span className={`text-[12px] ${ingColor}`}>
                                  • {totalIng} x {ing.name}
                                </span>
                                {totalIng < 0 && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ing.is_damaged ? 'text-[#C92C2C] bg-[#C92C2C]/10' : 'text-[#2CC985] bg-[#2CC985]/10'}`}>
                                    {ing.is_damaged ? '[DAMAGED]' : '[RESTOCKED]'}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Line Discount mapping */}
                      {item.disc_type && (
                         <div className="text-[#C92C2C] text-[12px] font-medium mt-1">
                            Disc: -{item.disc_type === '%' ? `${item.disc_val}%` : `$${item.disc_val.toFixed(2)}`}
                         </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE: Main Details */}
            <div className="flex-1 flex flex-col h-full bg-[#181818]">
              {/* Top Header */}
              <div className="p-6 pb-2 flex justify-between items-start">
                <div>
                  <h2 className="text-[28px] font-bold text-white">Sale {formatId(selectedSale.id)}</h2>
                  <p className="text-gray-400 text-sm mt-1">{selectedSale.date}</p>
                </div>
                <button onClick={() => setSelectedSale(null)} className="text-gray-500 hover:text-[#C92C2C] text-2xl font-bold px-2 transition-colors">✕</button>
              </div>

              {/* Grid Details */}
              <div className="px-6 py-4">
                <div className="bg-[#222222] rounded-lg p-5 border border-gray-800 flex gap-6">
                  <div className="flex-1">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Customer</p>
                    <p className="text-[15px] text-white font-medium">{selectedSale.customer || "Guest"}</p>
                  </div>
                  <div className="flex-1 border-l border-gray-700 pl-6">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Store</p>
                    <p className="text-[15px] text-white font-medium">{storeMap[selectedSale.store_id] || selectedSale.store_id || "Main Store"}</p>
                  </div>
                  <div className="flex-1 border-l border-gray-700 pl-6">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">User</p>
                    <p className="text-[15px] text-white font-medium">{userMap[selectedSale.user_id] || (selectedSale.user_id === user?.id ? user?.username : selectedSale.user_id) || "System"}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2">
                  <p className="text-[14px] text-gray-400">
                    <span className="font-bold mr-2">Paid via:</span>
                    {salePayments.length > 0 
                      ? salePayments.map(p => {
                          const methodStr = p.method ? String(p.method).trim().toLowerCase() : "";
                          if (methodStr === "gift card" && p.payment_ref) {
                            return `${p.method} (Card: ${p.payment_ref}) ($${p.amount.toFixed(2)})`;
                          }
                          return `${p.method} ($${p.amount.toFixed(2)})`;
                        }).join(', ') 
                      : selectedSale.method}
                  </p>
                  {selectedSale.promo_code && (
                    <p className="text-[14px] font-bold" style={{ color: themeColor }}>
                      Promo Code: {selectedSale.promo_code}
                    </p>
                  )}
                  {selectedSale.status_card_number && (
                    <p className="text-[14px] font-bold" style={{ color: themeColor }}>
                      Native Status Card: {selectedSale.status_card_number}
                    </p>
                  )}
                </div>
              </div>

              {/* Totals & Bottom Buttons Engine */}
              <div className="mt-auto p-6 flex flex-col items-end border-t border-gray-800 bg-[#1a1a1a]">
                 <div className="w-[300px] mb-8 space-y-2">
                   <div className="flex justify-between text-[14px] text-gray-400 font-medium">
                     <span>Tax:</span>
                     <span className="font-bold text-white">${(parseFloat(String(selectedSale.tax_val || 0)) + parseFloat(String(selectedSale.prov_tax_val || 0))).toFixed(2)}</span>
                   </div>
                 </div>

                 <h1 className="text-[48px] font-bold tracking-tight leading-none mb-8" style={{ color: selectedSale.total < 0 ? "#C92C2C" : themeColor }}>
                    Total: ${selectedSale.total.toFixed(2)}
                 </h1>

                 <div className="flex w-full gap-4">
                    <button
                      onClick={() => setSelectedSale(null)}
                      className="flex-1 py-4 border border-gray-600 rounded text-gray-400 font-bold hover:bg-gray-800 hover:text-white transition-colors uppercase tracking-wider"
                    >
                      Close
                    </button>
                    <button
                      onClick={handlePrintReceipt}
                      style={{ color: themeColor, borderColor: themeColor }}
                      className="flex-1 py-4 border rounded font-bold hover:bg-[#2a2a2a] transition-colors uppercase tracking-wider"
                    >
                      Print Receipt
                    </button>
                    <button
                      onClick={handleDeleteSale}
                      disabled={isDeleting}
                      className={`flex-1 py-4 border border-[#C92C2C] text-[#C92C2C] rounded font-bold transition-colors uppercase tracking-wider ${isDeleting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#3a1010]'}`}
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </button>

                    {/* Logic lock for Refunds */}
                    {selectedSale.total < 0 || selectedSale.is_refund_of ? (
                      <button disabled className="flex-1 py-4 bg-gray-800 text-gray-500 rounded font-bold uppercase tracking-wider cursor-not-allowed">
                        REFUND LOCKED
                      </button>
                    ) : (
                      <button
                        onClick={handleRefund}
                        className="flex-1 py-4 bg-[#C92C2C] hover:bg-[#8a1c1c] text-white rounded font-bold uppercase tracking-wider transition-colors shadow-lg"
                      >
                        REFUND
                      </button>
                    )}
                 </div>
              </div>
            </div>

            {/* RIGHT: Linked Refunds Sidebar (Conditionally Rendered) */}
            {linkedRefunds.length > 0 && (
              <div className="w-[300px] bg-[#1a1a1a] border-l border-gray-800 flex flex-col h-full shrink-0">
                <div className="p-6 border-b border-gray-800">
                  <h2 style={{ color: themeColor }} className="text-[18px] font-bold tracking-wide leading-tight mb-2">Linked Refunds / Exchanges</h2>
                  <p className="text-gray-500 text-[12px] leading-snug">To delete this sale, you must delete the child refunds below first.</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                  {linkedRefunds.map(ref => (
                    <div key={ref.id} className="bg-[#252525] p-4 rounded-lg border border-gray-700">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-white">{formatId(ref.id)}</span>
                        <span className="font-bold text-[#C92C2C] text-[15px]">${ref.total.toFixed(2)}</span>
                      </div>
                      <p className="text-gray-500 text-[12px] mb-3">{ref.date}</p>
                      <button
                        onClick={() => openSaleDetails(ref)} // Deep link into the child
                        className="w-full py-2 bg-[#C92C2C] hover:bg-[#8a1c1c] text-white rounded font-bold text-[12px] uppercase transition-colors"
                      >
                        VIEW / DELETE
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}