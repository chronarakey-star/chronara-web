"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../../utils/supabase";

// --- INTERFACES ---
interface SellModuleProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  user: any;
  setActiveModule: (module: string) => void;
  refundData?: any;
  clearRefundData?: () => void;
}

interface CartItem {
  line_id: string;
  id: string;
  sku: string;
  name: string;
  price: number;
  cost: number; // <--- NEW: Track item cost for COGS
  qty: number;
  disc_type: "%" | "$" | null;
  disc_val: number;
  tax_code: string;
  prov_tax_code: string;
  item_commission?: number; 
  is_tip?: boolean;
  is_gift_card?: boolean;
  card_number?: string;
  ingredients?: any[];
}

// --- TIMEZONE HELPER ---
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

const getItemSurcharge = (item: CartItem) => {
    if (!item.ingredients) return 0;
    return item.ingredients.reduce((sum, ing) => {
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

    // --- THE FIX: Clean currency formatter to ensure negative signs are placed before the $ ---
    const fmt = (val: number | string) => {
        const num = parseFloat(String(val)) || 0;
        return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`;
    };
    
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

    // --- TIMEZONE RECEIPT FIX ---
    html += `
            <div class="center">${receiptData.date}</div>
            <div class="center">${receiptData.time}</div>
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
        const dbUnitPrice = parseFloat(item.price || 0); 
        let surchargeTotal = 0;
        let ingListHtml = '';

        if (item.ingredients) {
            item.ingredients.forEach((ing: any) => {
                const diff = parseFloat(ing.current_qty || 0) - parseFloat(ing.base_qty || 0);
                const cost = parseFloat(ing.extra_cost || 0);
                
                if (diff < -0.001) {
                    const absDiff = Math.abs(diff);
                    const qtyStr = Number.isInteger(absDiff) ? absDiff.toString() : absDiff.toFixed(2);
                    ingListHtml += `<div class="sub-row"><span>(Less) ${qtyStr}x ${ing.name}</span><span></span></div>`;
                } else if (diff > 0.001) {
                    const qtyStr = Number.isInteger(diff) ? diff.toString() : diff.toFixed(2);
                    if (cost > 0) {
                        const lineCost = diff * cost * qty;
                        surchargeTotal += lineCost;
                        ingListHtml += `<div class="sub-row"><span>(Add) ${qtyStr}x ${ing.name}</span><span>${fmt(lineCost)}</span></div>`;
                    } else {
                        ingListHtml += `<div class="sub-row"><span>(Add) ${qtyStr}x ${ing.name}</span><span></span></div>`;
                    }
                }
            });
        }

        const combinedLineTotal = dbUnitPrice * qty;
        const baseLineTotal = combinedLineTotal - surchargeTotal;
        const baseUnitPrice = qty !== 0 ? baseLineTotal / qty : dbUnitPrice;

        html += `<div class="item-row bold"><span>${item.name}</span><span>${fmt(baseLineTotal)}</span></div>`;
        
        // THE FIX: Bulletproof name-check fallback for system items
        const isTip = item.is_tip || item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
        const isGiftCard = item.is_gift_card || item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');

        if (!isTip && !isGiftCard) {
            const qtyStr = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
            html += `<div class="sub-row"><span>${qtyStr} @ ${fmt(baseUnitPrice)}/ea</span></div>`;
            
            let lineRaw = combinedLineTotal;
            if (item.disc_type === '%') {
                lineRaw -= lineRaw * (parseFloat(item.disc_val || 0) / 100);
            } else if (item.disc_type === '$') {
                if (lineRaw < 0) lineRaw += Math.abs(parseFloat(item.disc_val || 0));
                else lineRaw -= parseFloat(item.disc_val || 0);
            }
            discountableSub += Math.abs(lineRaw); 
        }

        if (item.disc_type) {
            const discVal = parseFloat(item.disc_val || 0);
            let amt = item.disc_type === '%' ? Math.abs(combinedLineTotal * (discVal / 100.0)) : Math.abs(discVal);
            let sign = combinedLineTotal < 0 ? '+' : '-';
            html += `<div class="sub-row"><span>Discount (${discVal}${item.disc_type === '%' ? '%' : ''})</span><span>${sign}${fmt(amt)}</span></div>`;
        }

        html += ingListHtml;
    });

    html += `
            <div class="solid-divider"></div>
            <div class="flex"><span>Subtotal</span><span>${fmt(receiptData.subtotal)}</span></div>
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
            html += `<div class="flex"><span>${label}</span><span>${fmt(amt as string)}</span></div>`;
        });
    } else {
        const taxLabel = receiptData.status_card && receiptData.status_card !== 'None' ? "Tax (Native Exempt)" : "Tax";
        html += `<div class="flex"><span>${taxLabel}</span><span>${fmt(receiptData.tax)}</span></div>`;
    }

    html += `
            <div class="solid-divider" style="margin-top:10px;"></div>
            <div class="flex bold" style="font-size: 1.2em;"><span>TOTAL</span><span>${fmt(receiptData.total)}</span></div>
            <div style="margin-bottom:10px;"></div>
    `;

    (receiptData.payments || []).forEach((p: any) => {
        html += `<div class="flex"><span>Paid via ${p.method}</span><span>${fmt(p.amount)}</span></div>`;
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

export default function SellModule({ companyId, storeId, themeColor, user, setActiveModule, refundData, clearRefundData }: SellModuleProps) {

  // --- STATE ---
  const [rawConfig, setRawConfig] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Refund States
  const [isRefundMode, setIsRefundMode] = useState(false);
  const [originalSaleItems, setOriginalSaleItems] = useState<any[]>([]);
  const [originalSaleTotal, setOriginalSaleTotal] = useState(0);
  const [refundShrinkageIds, setRefundShrinkageIds] = useState<Set<string>>(new Set());
  const [refundIngredientShrinkageIds, setRefundIngredientShrinkageIds] = useState<Set<string>>(new Set());

  // Settings State (Now wired to fetch from DB)
  const [acceptTips, setAcceptTips] = useState(true); 
  const [acceptGiftCards, setAcceptGiftCards] = useState(true);
  const [autoDamagedRefunds, setAutoDamagedRefunds] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(["Cash", "Debit", "Visa", "Mastercard"]);
  const [commGlobalEnabled, setCommGlobalEnabled] = useState(false); // <--- NEW
  const [commGlobalRate, setCommGlobalRate] = useState(0); // <--- NEW
  const [commItemEnabled, setCommItemEnabled] = useState(false); // <--- NEW

  // Customer State
  const [customers, setCustomers] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);

  // Tax State
  const [storeProvince, setStoreProvince] = useState<string>("ON"); // <--- NEW
  const [taxRates, setTaxRates] = useState<Record<string, number>>({ hst: 0.13, gst: 0.05, pst: 0, rst: 0, qst: 0, exempt: 0, custom: 0 });
  const [isNativeExempt, setIsNativeExempt] = useState(false);
  const [statusCardNumber, setStatusCardNumber] = useState("");
  const [manualTax, setManualTax] = useState<number | null>(null);

  // Discount State
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoDiscount, setPromoDiscount] = useState({ type: null as string | null, val: 0 });
  const [currentPromoRules, setCurrentPromoRules] = useState<any>(null);
  const [promoStatus, setPromoStatus] = useState<"default" | "valid" | "invalid">("default");
  const [manualDiscount, setManualDiscount] = useState({ type: null as string | null, val: 0 });
  const [showDiscountModal, setShowDiscountModal] = useState<{ active: boolean, type: 'manual' | 'item', lineId?: string }>({ active: false, type: 'manual' });
  const [discountInputVal, setDiscountInputVal] = useState("");
  const [discountInputType, setDiscountInputType] = useState<"%" | "$">("%");

  // Modal States
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showParkModal, setShowParkModal] = useState(false);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [parkedSales, setParkedSales] = useState<any[]>([]);

  // --- CUSTOM DIALOG STATE (Replaces default alerts/prompts) ---
  const [appDialog, setAppDialog] = useState<{
    show: boolean;
    type: 'alert' | 'prompt';
    title: string;
    message: string;
    inputValue: string;
    resolve: ((value: string | null) => void) | null;
  }>({ show: false, type: 'alert', title: '', message: '', inputValue: '', resolve: null });

  const customAlert = (title: string, message: string) => {
    return new Promise<void>((resolve) => {
      setAppDialog({ show: true, type: 'alert', title, message, inputValue: '', resolve: () => resolve() });
    });
  };

  const customPrompt = (title: string, message: string) => {
    return new Promise<string | null>((resolve) => {
      setAppDialog({ show: true, type: 'prompt', title, message, inputValue: '', resolve });
    });
  };

  const handleDialogClose = (isCancel: boolean = false) => {
    if (appDialog.resolve) {
      appDialog.resolve(isCancel ? null : (appDialog.type === 'prompt' ? appDialog.inputValue : null));
    }
    setAppDialog(prev => ({ ...prev, show: false, resolve: null }));
  };

  // Daily Summary State
  const [showDailySummary, setShowDailySummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ totalSales: number, openingBalance: number, userBreakdown: Record<string, number> } | null>(null);
  const [isFetchingSummary, setIsFetchingSummary] = useState(false);
  
  
  
  // Customer Form State
  const [custForm, setCustForm] = useState({
    first: "", last: "", phone: "", email: "", 
    dobM: "MM", dobD: "", dobY: "", 
    street: "", city: "", prov: "ON", postal: "", notes: ""
  });

  // Payment Modal State
  const [showPayment, setShowPayment] = useState(false);
  const [paymentQueue, setPaymentQueue] = useState<any[]>([]);
  const [splitAmount, setSplitAmount] = useState<string>("");
  const [successData, setSuccessData] = useState<{ active: boolean, changeDue: number, total: number, saleId: string, receiptData?: any } | null>(null);

  // Refs for click-outside
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // --- NEW: Store Status State ---
  const [isStoreOpen, setIsStoreOpen] = useState<boolean | null>(null);
  const isStoreOpenRef = useRef<boolean | null>(null); // Tracks state for heartbeat
  const lastActivityRef = useRef<number>(0); // Tracks activity log for silent refreshes

  // Keep ref in sync
  useEffect(() => {
    isStoreOpenRef.current = isStoreOpen;
  }, [isStoreOpen]);

  // --- INITIALIZATION ---
  useEffect(() => {
    fetchCompanySettings();
    fetchProducts();
    fetchCustomers();
    checkStoreStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, storeId, selectedCategories]);

  const checkStoreStatus = async () => {
    if (!companyId) return;
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
        setIsStoreOpen(data[0].type === "Open");
      } else {
        setIsStoreOpen(false); // Default to closed if no records exist
      }
    } catch (err) {
      console.error("Failed to check store status", err);
      setIsStoreOpen(false);
    }
  };

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ==========================================
  // --- NEW: THE 3-SECOND CLOUD HEARTBEAT ---
  // ==========================================
  useEffect(() => {
    if (!companyId) return;

    const pingCloudStatus = async () => {
      try {
        // 1. Check Store Status (Lock / Unlock)
        let sessionQuery = supabase
          .from('cash_sessions')
          .select('type')
          .eq('company_id', companyId)
          .in('type', ['Open', 'Close'])
          .neq('is_deleted', true)
          .order('timestamp', { ascending: false })
          .limit(1);
          
        if (storeId && storeId !== "ALL_STORES") sessionQuery = sessionQuery.eq('store_id', storeId);
        else sessionQuery = sessionQuery.is('store_id', null);

        const { data: sessionData } = await sessionQuery;
        if (sessionData && sessionData.length > 0) {
          const cloudIsOpen = sessionData[0].type === "Open";
          if (cloudIsOpen !== isStoreOpenRef.current) {
            setIsStoreOpen(cloudIsOpen);
          }
        }

        // 2. Check Global Activity Log for Data Changes (Products, Customers)
        const { data: logData } = await supabase
          .from("activity_log")
          .select("timestamp")
          .eq("company_id", companyId)
          .order("timestamp", { ascending: false })
          .limit(1);

        if (logData && logData.length > 0) {
          const latestActivity = logData[0].timestamp;
          if (lastActivityRef.current === 0) {
            lastActivityRef.current = latestActivity; // Set baseline on first run
          } else if (latestActivity > lastActivityRef.current) {
            console.log("Activity detected. Silently refreshing products and customers...");
            lastActivityRef.current = latestActivity;
            fetchProducts();
            fetchCustomers();
          }
        }
      } catch (err) {
        // Silently fail if network drops
      }
    };

    const intervalId = setInterval(pingCloudStatus, 3000);
    return () => clearInterval(intervalId);
  }, [companyId, storeId]);
  // ==========================================

  // --- REFUND SESSION INITIALIZATION ---
  useEffect(() => {
    if (!refundData) return;
    
    const loadRefundSession = async () => {
      setIsRefundMode(true);
      
      // 1. Fetch ONLY the IDs of previous refunds that branch from this sale
      const { data: prevRefunds } = await supabase.from('sales').select('id').eq('is_refund_of', refundData.id).neq('is_deleted', true);

      // 2. Aggregate previously refunded item IDs AND Ingredients
      let refundedIds: Record<string, number> = {};
      let refundedIngs: Record<string, number> = {}; 

      if (prevRefunds && prevRefunds.length > 0) {
        const prevIds = prevRefunds.map(r => r.id);
        const { data: prevItems } = await supabase.from('sale_items').select('*').in('sale_id', prevIds).neq('is_deleted', true);
        
        prevItems?.forEach(pi => {
          let is_pure_ing = false;

          if (pi.ingredients_snapshot) {
              try {
                  const snap = JSON.parse(pi.ingredients_snapshot);
                  if (snap.is_pure_ing_refund) is_pure_ing = true;
              } catch (e) {}
          }

          let r_qty_raw = parseFloat(pi.qty || 0);

          if (r_qty_raw > 0.001 && !is_pure_ing) {
              return;
          }

          let r_qty = Math.abs(r_qty_raw);
          const r_price = Math.abs(pi.price || 0);
          const pid = pi.product_id || pi.sku;

          if (pi.ingredients_snapshot) {
              try {
                  const snap = JSON.parse(pi.ingredients_snapshot);
                  snap.ingredients?.forEach((ing: any) => {
                      const c_sku = ing.sku || ing.child_sku;
                      if (c_sku) {
                          const i_qty = Math.abs(r_qty * (parseFloat(ing.current_qty) || 0));
                          if (i_qty > 0) {
                              const key = `${pid}||${c_sku}`;
                              refundedIngs[key] = (refundedIngs[key] || 0) + i_qty;
                          }
                      }
                  });
              } catch (e) {}
          }

          if (is_pure_ing || (r_price < 0.001 && pi.ingredients_snapshot)) {
              r_qty = 0;
          }

          if (pid) refundedIds[pid] = (refundedIds[pid] || 0) + r_qty;
        });
      }

      // 3. Fetch product configurations directly from the DB (WITH COST)
      const validProductIds = refundData.items.map((i: any) => i.product_id).filter(Boolean);
      let refundDbProducts: any[] = [];
      if (validProductIds.length > 0) {
          // --- THE FIX: Select `unit_cost` from products ---
          const { data: pData } = await supabase.from('products').select('id, sku, tax_code, prov_tax_code, item_commission, unit_cost').in('id', validProductIds);
          if (pData) refundDbProducts = pData;
      }

      // 4. Build the cart delta
      const initialCart: CartItem[] = [];
      const originalItems: any[] = [];
      
      const newRefundShrinkages = new Set<string>(); // <--- NEW
      const newIngredientShrinkages = new Set<string>(); // <--- NEW
      
      refundData.items.forEach((item: any) => {
        const pid = item.product_id || item.sku;
        const refundedSoFar = refundedIds[pid] || 0;
        const deduction = Math.min(item.qty, refundedSoFar);
        const remainingQty = item.qty - deduction;
        
        if (pid) refundedIds[pid] = Math.max(0, refundedIds[pid] - deduction);

        if (remainingQty > 0) {
          let ingredients = [];
          let basePrice = item.price || 0;
          let loadedCardNum = "";
          const newLineId = crypto.randomUUID(); // <--- NEW: Pre-generate ID
          
          const isTip = item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
          const isGiftCard = item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');
          
          // --- NEW: AUTO DAMAGE LOGIC ---
          let isLockedGc = false;
          try {
             if (item.ingredients_snapshot) {
                 const snap = JSON.parse(item.ingredients_snapshot);
                 if (snap.is_locked_gc || snap.is_used) isLockedGc = true;
             }
          } catch(e) {}
          
          if (autoDamagedRefunds && !isLockedGc && !isGiftCard && !isTip) {
              newRefundShrinkages.add(newLineId);
          }
          
          try {
              if (item.ingredients_snapshot) {
                 const snap = JSON.parse(item.ingredients_snapshot);
                 if (snap.base_price !== undefined) {
                     basePrice = parseFloat(snap.base_price);
                 }
                 if (snap.card_number !== undefined) {
                     loadedCardNum = snap.card_number;
                 }

                 const origParentQty = item.qty;
                 ingredients = (snap.ingredients || []).map((ing: any) => {
                     const c_sku = ing.sku || ing.child_sku;
                     const key = `${pid}||${c_sku}`;
                     const origIngQty = parseFloat(ing.current_qty) || 0;
                     const totalOrigIng = origIngQty * origParentQty;
                     const ingRefunded = refundedIngs[key] || 0;

                     let totalRemainingIng = totalOrigIng - ingRefunded;
                     if (totalRemainingIng < 0) totalRemainingIng = 0;

                     if (autoDamagedRefunds && !isLockedGc && !isGiftCard && !isTip) {
                         newIngredientShrinkages.add(`${newLineId}:${c_sku}`);
                     }

                     return {
                         ...ing,
                         current_qty: totalRemainingIng / remainingQty
                     };
                 });
              }
          } catch(e) {}

          const matchedProd = refundDbProducts.find(p => p.id === item.product_id) || products.find(p => p.id === (item.product_id || "") || p.sku === (item.sku || ""));
          const cartItem: CartItem = {
              line_id: newLineId,
              id: item.product_id || "",
              sku: item.sku || "",
              name: item.name || "",
              price: basePrice,
              // --- THE FIX: Check for unit_cost ---
              cost: matchedProd ? parseFloat(matchedProd.unit_cost || 0) : 0.0, 
              qty: remainingQty,
              disc_type: item.disc_type as any,
              disc_val: item.disc_val || 0,
              tax_code: matchedProd?.tax_code || "HST",
              prov_tax_code: matchedProd?.prov_tax_code || "Exempt",
              item_commission: matchedProd ? parseFloat(matchedProd.item_commission || 0) : 0, 
              ingredients: ingredients,
              is_tip: isTip,
              is_gift_card: isGiftCard,
              card_number: loadedCardNum
          };
          initialCart.push(cartItem);
          originalItems.push(JSON.parse(JSON.stringify(cartItem))); 
        }
      });

      if (initialCart.length === 0) {
        alert("This order has already been fully refunded.");
        if (clearRefundData) clearRefundData();
        setIsRefundMode(false);
        return;
      }

      setOriginalSaleItems(originalItems);
      setCart(initialCart);
      
      // --- NEW: Apply the Auto-Damage sets ---
      setRefundShrinkageIds(newRefundShrinkages);
      setRefundIngredientShrinkageIds(newIngredientShrinkages);
      
      setNeedsInitialTotal(true); 
      
      if (refundData.customer && refundData.customer !== "Guest") {
        const parts = refundData.customer.split(' ');
        setCustomer({ first_name: parts[0], last_name: parts.slice(1).join(' ') });
        setCustomerSearch(refundData.customer);
      }
      
      if (refundData.promo_code) {
         setPromoCodeInput(refundData.promo_code);
         setPromoDiscount({ type: refundData.promo_disc_type, val: refundData.promo_disc_val });
         setPromoStatus("valid");
      }
      if (refundData.manual_disc_type) {
         setManualDiscount({ type: refundData.manual_disc_type, val: refundData.manual_disc_val });
      }
      if (refundData.status_card_number && refundData.status_card_number !== "None") {
         setIsNativeExempt(true);
         setStatusCardNumber(refundData.status_card_number);
      }
    };
    loadRefundSession();
  }, [refundData, autoDamagedRefunds]);

  // Click outside listener for Customer Dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Fetch global settings from DB
  const fetchCompanySettings = async () => {
    if (!companyId) return;
    try {
      const { data } = await supabase.from('companies').select('name, operating_name, config_json, province').eq('id', companyId).single();
      if (data) {
        let config: any = {};
        if (data.config_json) {
           config = typeof data.config_json === 'string' ? JSON.parse(data.config_json) : data.config_json;
        }
        
        // Append company names for receipt rendering
        config.companyName = data.operating_name || data.name || "Our Store";
        setRawConfig(config);
        
        // Fetch Province for accurate taxes
        let sProv = data.province || "ON";
        if (storeId && storeId !== "ALL_STORES") {
            const { data: sData } = await supabase.from('stores').select('province').eq('id', storeId).maybeSingle();
            if (sData && sData.province) sProv = sData.province;
        }
        const finalProv = sProv.toUpperCase();
        setStoreProvince(finalProv);
        
        // --- THE DYNAMIC TAX FETCH ---
        const currentYear = new Date().getFullYear();
        const { data: taxData } = await supabase.from('tax_settings').select('config_json').eq('year', currentYear).maybeSingle();
        
        let provTaxData: any = {};
        if (taxData && taxData.config_json) {
            const fullTaxConfig = typeof taxData.config_json === 'string' ? JSON.parse(taxData.config_json) : taxData.config_json;
            provTaxData = fullTaxConfig[finalProv] || {};
        }

        // ... (inside fetchCompanySettings)
        
        // Dynamically convert whole numbers (e.g. 13) to decimals (0.13)
        setTaxRates({
            gst: (parseFloat(provTaxData.gst) || 0) / 100.0,
            hst: (parseFloat(provTaxData.hst) || 0) / 100.0,
            pst: (parseFloat(provTaxData.pst) || 0) / 100.0,
            rst: (parseFloat(provTaxData.rst) || 0) / 100.0,
            qst: (parseFloat(provTaxData.qst) || 0) / 100.0,
            exempt: 0.0,
            custom: 0.0
        });
        // -----------------------------
        
        // THE FIX: Match the Python POS default behavior (False/Off by default)
        setAcceptTips(config.accept_tips ?? false);
        setAcceptGiftCards(config.accept_gift_cards ?? false);
        setAutoDamagedRefunds(config[`${companyId}_auto_damaged_refunds`] ?? false); // <--- NEW
        
        // --- NEW: Commission Config ---
        setCommGlobalEnabled(config.comm_global_enabled || false);
        setCommGlobalRate(parseFloat(config.comm_global_rate || 0));
        setCommItemEnabled(config.comm_item_enabled || false);

        // Load dynamic payment methods synced from Python POS
        if (config.payment_methods && Array.isArray(config.payment_methods)) {
          setPaymentMethods(config.payment_methods);
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  // --- BULLETPROOF TIP INJECTOR ---
  useEffect(() => {
    if (isRefundMode) return; // Lock tips in refund mode

    setCart(prevCart => {
      const hasTip = prevCart.some(i => i.is_tip || i.sku === 'SYS_TIP');
      
      if (!acceptTips) {
        return hasTip ? prevCart.filter(i => !i.is_tip && i.sku !== 'SYS_TIP') : prevCart;
      }
      
      if (!hasTip) {
        return [...prevCart, {
          line_id: `SYS_TIP_${crypto.randomUUID().substring(0, 8)}`,
          id: 'SYS_TIP',
          sku: 'SYS_TIP',
          name: 'Tips',
          price: 0,
          cost: 0, // <--- THE FIX
          qty: 1,
          disc_type: null,
          disc_val: 0,
          tax_code: 'Exempt',
          prov_tax_code: 'Exempt',
          is_tip: true
        }];
      }
      return prevCart;
    });
  }, [acceptTips, cart.length, isRefundMode]); 

  const fetchProducts = async (query = searchQuery) => {
    if (!companyId) return;

    try {
      let q = supabase.from('products').select('*').eq('company_id', companyId).neq('is_deleted', true);
      
      if (storeId && storeId !== "ALL_STORES") q = q.eq('store_id', storeId);
      if (selectedCategories.length > 0) q = q.in('category', selectedCategories);
      if (query) q = q.or(`name.ilike.%${query}%,sku.ilike.%${query}%`);
      
      const { data } = await q.limit(50);
      if (data) {
        setProducts(data);
        if (categories.length === 0 && !query) {
          const uniqueCats = Array.from(new Set(data.map(p => p.category).filter(c => c && c.trim() !== "")));
          setCategories(uniqueCats.sort());
        }
      }
    } catch (err) {
      console.error("Failed to fetch products", err);
    }
  };

  const fetchCustomers = async () => {
    if (!companyId) return;
    try {
      // THE FIX: Do not pull deleted customers into the POS dropdown
      const { data } = await supabase.from('customers').select('*').eq('company_id', companyId).neq('is_deleted', true);
      if (data) setCustomers(data);
    } catch (err) {
      console.error("Failed to fetch customers", err);
    }
  };

  // --- DAILY SUMMARY HANDLER ---
  const fetchAndShowDailySummary = async () => {
    setIsFetchingSummary(true);
    try {
      let sid = storeId === "ALL_STORES" ? null : storeId;
      const localTz = getStoreTimezone(storeProvince, storeId === "ALL_STORES");

      // 1. Get Today's Local Date String (YYYY-MM-DD) via projection
      const now = new Date();
      const localTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

      // 2. Fetch Recent Sales (Pull the last 48 hours to safely catch UTC offsets)
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoUTC = twoDaysAgo.toISOString();

      let salesQuery = supabase.from('sales')
        .select('id, total, user_id, date')
        .eq('company_id', companyId)
        .gte('date', twoDaysAgoUTC) // Greater than 48 hours ago
        .neq('is_deleted', true);
        
      if (sid) salesQuery = salesQuery.eq('store_id', sid);
      else salesQuery = salesQuery.is('store_id', null);

      const { data: rawSalesData, error: salesError } = await salesQuery;
      if (salesError) throw salesError;

      // FILTER IN MEMORY BY PROJECTING UTC TO LOCAL TIME
      const salesData = (rawSalesData || []).filter(s => {
          if (!s.date) return false;
          const sLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.date));
          return sLocalStr === localTodayStr;
      });

      // 3. Fetch Tips (Same logic)
      let tipsQuery = supabase.from('tips_ledger')
        .select('sale_id, amount, date')
        .eq('company_id', companyId)
        .gte('date', twoDaysAgoUTC)
        .neq('is_deleted', true);
        
      if (sid) tipsQuery = tipsQuery.eq('store_id', sid);
      else tipsQuery = tipsQuery.is('store_id', null);

      const { data: rawTipsData } = await tipsQuery;
      const tipsBySale: Record<string, number> = {};
      if (rawTipsData) {
        rawTipsData.forEach(t => {
          if (!t.date) return;
          const tLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t.date));
          if (tLocalStr === localTodayStr) {
             tipsBySale[t.sale_id] = (tipsBySale[t.sale_id] || 0) + parseFloat(t.amount || 0);
          }
        });
      }

      // 4. Fetch Employee Names for User Mapping
      const { data: empData } = await supabase.from('employees')
        .select('user_id, first_name, last_name')
        .eq('company_id', companyId);
        
      const userMap: Record<string, string> = {};
      if (empData) {
        empData.forEach(e => {
          if (e.user_id) userMap[e.user_id] = `${e.first_name} ${e.last_name}`.trim();
        });
      }
      if (user?.id) userMap[user.id] = user.username || `${user.first_name} ${user.last_name}`;

      // 5. Calculate Net Totals & Breakdown
      let totalSales = 0;
      const userBreakdown: Record<string, number> = {};

      if (salesData) {
        salesData.forEach(s => {
          const tipAmt = tipsBySale[s.id] || 0;
          const adjustedTotal = parseFloat(s.total || 0) - tipAmt;
          totalSales += adjustedTotal;

          const uName = userMap[s.user_id] || 'Unknown User';
          userBreakdown[uName] = (userBreakdown[uName] || 0) + adjustedTotal;
        });
      }

      // 6. Fetch Opening Balance from Cash Sessions
      let openQuery = supabase.from('cash_sessions')
        .select('total, timestamp')
        .eq('company_id', companyId)
        .eq('type', 'Open')
        .gte('timestamp', twoDaysAgoUTC)
        .order('timestamp', { ascending: false });
        
      if (sid) openQuery = openQuery.eq('store_id', sid);

      const { data: openData } = await openQuery;
      let openBal = 0;
      if (openData) {
         const todaysOpen = openData.find(o => {
             if (!o.timestamp) return false;
             const oLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(o.timestamp));
             return oLocalStr === localTodayStr;
         });
         if (todaysOpen) openBal = parseFloat(todaysOpen.total || 0);
      }

      // 7. Inject Data & Open Modal
      setSummaryData({ totalSales, openingBalance: openBal, userBreakdown });
      setShowDailySummary(true);

    } catch (err) {
      console.error("Error fetching daily summary:", err);
      alert("Failed to load daily summary.");
    } finally {
      setIsFetchingSummary(false);
    }
  };

  // --- MATH & CALCULATIONS ---
  const totals = useMemo(() => {
    let subtotal = 0;
    let discountableSubtotal = 0;
    let baseTaxFed = 0;
    let baseTaxProv = 0;

    // --- THE FIX: Calculate original cart discountable subtotal using raw refundData ---
    let origDiscountableSubtotal = 0;
    if (isRefundMode && refundData && refundData.items) {
        refundData.items.forEach((item: any) => {
            // The price from the database already includes ingredient surcharges!
            let lineRaw = parseFloat(item.price || 0) * parseFloat(item.qty || 0);
            
            if (item.disc_type === "%") lineRaw -= (lineRaw * (parseFloat(item.disc_val || 0) / 100));
            else if (item.disc_type === "$") lineRaw -= parseFloat(item.disc_val || 0);
            
            const isTip = item.is_tip || item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
            const isGiftCard = item.is_gift_card || item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');
            
            if (!isTip && !isGiftCard && !String(item.sku || "").startsWith('SYS_')) {
                origDiscountableSubtotal += Math.max(0, lineRaw);
            }
        });
        
        let pAmt = 0;
        const pType = refundData?.promo_disc_type;
        const pVal = parseFloat(refundData?.promo_disc_val || 0);
        if (pType === "%") pAmt = origDiscountableSubtotal * (pVal / 100);
        else if (pType === "$") pAmt = pVal;
        
        let subAfterP = Math.max(0, origDiscountableSubtotal - pAmt);
        
        let mAmt = 0;
        const mType = refundData?.manual_disc_type;
        const mVal = parseFloat(refundData?.manual_disc_val || 0);
        if (mType === "%") mAmt = subAfterP * (mVal / 100);
        else if (mType === "$") mAmt = Math.min(mVal, subAfterP);
        
        origDiscountableSubtotal = Math.max(0, origDiscountableSubtotal - pAmt - mAmt);
    }
    // -----------------------------------------------------------------------------------

    cart.forEach(item => {
      const surcharge = getItemSurcharge(item);
      let lineRaw = (item.price + surcharge) * item.qty;

      // Line Item Discounts
      if (item.disc_type === "%") lineRaw -= (lineRaw * (item.disc_val / 100));
      else if (item.disc_type === "$") lineRaw -= item.disc_val;

      const lineVal = Math.max(0, lineRaw);
      subtotal += lineVal;

      if (!item.is_tip && !item.is_gift_card && !item.sku?.includes('SYS_')) {
        discountableSubtotal += lineVal;

        let fedCode = (item.tax_code || "HST").toUpperCase();
        let provCode = (item.prov_tax_code || "Exempt").toUpperCase();

        // Smart Province Tax Mapping
        if (fedCode === "HST" && ["AB", "BC", "MB", "QC", "SK", "NT", "NU", "YT"].includes(storeProvince)) {
            fedCode = "GST";
        } else if (fedCode === "GST" && ["ON", "NB", "NL", "NS", "PE"].includes(storeProvince)) {
            fedCode = "HST";
        }

        const fedRate = fedCode === "CUSTOM" ? 0 : (taxRates[fedCode.toLowerCase()] || 0);
        const provRate = provCode === "CUSTOM" ? 0 : (taxRates[provCode.toLowerCase()] || 0);

        baseTaxFed += (lineVal * fedRate);
        baseTaxProv += (lineVal * provRate);
      }
    });

    // Global Discounts
    let promoAmt = 0;
    if (promoDiscount.type === "%") promoAmt = discountableSubtotal * (promoDiscount.val / 100);
    else if (promoDiscount.type === "$") promoAmt = promoDiscount.val;

    let subAfterPromo = Math.max(0, discountableSubtotal - promoAmt);

    let manualAmt = 0;
    if (manualDiscount.type === "%") manualAmt = subAfterPromo * (manualDiscount.val / 100);
    else if (manualDiscount.type === "$") manualAmt = Math.min(manualDiscount.val, subAfterPromo);

    const totalDiscount = promoAmt + manualAmt;
    const finalSubtotal = Math.max(0, subtotal - totalDiscount);

    let finalTax = 0;
    if (isNativeExempt) {
      finalTax = 0;
    } else if (manualTax !== null) {
      finalTax = manualTax;
    } else if (isRefundMode && origDiscountableSubtotal > 0.001) {
      // THE FIX: Use exact proportional historical tax for refunds!
      const currentDiscountableFinal = Math.max(0, discountableSubtotal - totalDiscount);
      const ratio = currentDiscountableFinal / origDiscountableSubtotal;
      const historicalTax = (parseFloat(refundData?.tax_val || 0) + parseFloat(refundData?.prov_tax_val || 0));
      finalTax = historicalTax * ratio;
    } else {
      const ratio = discountableSubtotal > 0 ? (subAfterPromo - manualAmt) / discountableSubtotal : 1;
      finalTax = (baseTaxFed + baseTaxProv) * ratio;
    }

    const total = finalSubtotal + finalTax;

    return { subtotal, promoAmt, manualAmt, totalDiscount, finalSubtotal, finalTax, total, origDiscountableSubtotal };
  }, [cart, promoDiscount, manualDiscount, isNativeExempt, manualTax, storeProvince, taxRates, isRefundMode, originalSaleItems, refundData]);

  // --- NEW: Accurate Baseline State ---
  const [needsInitialTotal, setNeedsInitialTotal] = useState(false);

  useEffect(() => {
      if (needsInitialTotal && isRefundMode && cart.length > 0) {
          setOriginalSaleTotal(totals.total);
          setNeedsInitialTotal(false);
      }
  }, [totals.total, needsInitialTotal, isRefundMode, cart.length]);
  // ------------------------------------

  // --- CORE SYSTEM ACTIONS ---
  const voidCart = () => {
    setCart([]);
    setCustomer(null);
    setCustomerSearch("");
    setManualDiscount({ type: null, val: 0 });
    setPromoDiscount({ type: null, val: 0 });
    setPromoCodeInput("");
    setCurrentPromoRules(null);
    setPromoStatus("default");
    setIsNativeExempt(false);
    setManualTax(null);
    
    setIsRefundMode(false);
    setOriginalSaleItems([]);
    setOriginalSaleTotal(0);
    setNeedsInitialTotal(false); // <--- ADDED
    setRefundShrinkageIds(new Set());
    setRefundIngredientShrinkageIds(new Set());
    if (clearRefundData) clearRefundData();
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const toggleShrinkageStatus = (lineId: string) => {
    setRefundShrinkageIds(prev => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  // --- NEW: Add this right below the function above ---
  const toggleIngredientShrinkage = (line_id: string, sku: string) => {
      setRefundIngredientShrinkageIds(prev => {
          const next = new Set(prev);
          const key = `${line_id}:${sku}`;
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
      });
  };

  const addToCart = async (product: any) => {
    console.log("🛒 ADDING PRODUCT:", product); // DEBUG LOG

    // Optimistically update or clone if it already exists to keep UI snappy
    const existingInCart = cart.find(i => i.id === product.id);
    if (existingInCart) {
      if (existingInCart.ingredients && existingInCart.ingredients.length > 0) {
        const newCartItem = {
          ...existingInCart,
          line_id: crypto.randomUUID(),
          qty: 1,
          ingredients: existingInCart.ingredients.map(ing => ({...ing, current_qty: ing.base_qty}))
        };
        setCart(prev => [...prev, newCartItem]);
        return;
      } else {
        setCart(prev => prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
        return;
      }
    }

    let ingredients: any[] = [];
    
    if (product.sku) {
        try {
          const { data: ingData, error: ingError } = await supabase
            .from('product_ingredients')
            .select('*')
            .eq('company_id', companyId)
            .eq('parent_sku', product.sku);

          if (ingError) {
              console.error("❌ SUPABASE INGREDIENT ERROR:", ingError);
              alert(`Database Error fetching ingredients: ${ingError.message}\n\n(Check if 'product_ingredients' table exists in Supabase and RLS is disabled)`);
          }

          console.log("📦 RAW INGREDIENT DATA FROM SUPABASE:", ingData); // DEBUG LOG

          if (ingData && ingData.length > 0) {
            const childSkus = ingData.map((i: any) => i.child_sku);
            const { data: prodData, error: prodError } = await supabase
              .from('products')
              .select('sku, name')
              .eq('company_id', companyId)
              .in('sku', childSkus);
              
            if (prodError) console.error("❌ SUPABASE PRODUCT LOOKUP ERROR:", prodError);

            ingredients = ingData.map((i: any) => {
               const p = prodData?.find((pd: any) => pd.sku === i.child_sku);
               return {
                  sku: i.child_sku,
                  name: p?.name || i.child_sku,
                  base_qty: parseFloat(i.qty_needed) || 0,
                  current_qty: parseFloat(i.qty_needed) || 0,
                  extra_cost: parseFloat(i.extra_cost) || 0
               };
            });
          } else {
             console.warn(`⚠️ Supabase returned 0 ingredients for SKU: ${product.sku}. If this is a packaged item, your Python sync_worker isn't pushing ingredients to the cloud!`);
          }
        } catch (err) {
          console.error("Failed to fetch ingredients", err);
        }
    } else {
        console.warn("⚠️ Product has no SKU, cannot fetch ingredients!");
    }

    setCart(prev => {
      const existingNow = prev.find(i => i.id === product.id);
      if (existingNow) {
          if (ingredients.length > 0) {
              return [...prev, {
                line_id: crypto.randomUUID(),
                id: product.id,
                sku: product.sku,
                name: product.name,
                price: parseFloat(product.price) || 0,
                // --- THE FIX: Look for unit_cost ---
                cost: parseFloat(product.unit_cost) || 0.0, 
                qty: 1,
                disc_type: null,
                disc_val: 0,
                tax_code: product.tax_code || 'HST',
                prov_tax_code: product.prov_tax_code || 'Exempt',
                item_commission: parseFloat(product.item_commission || 0), 
                ingredients: ingredients
              }];
          } else {
              return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
          }
      }
      return [...prev, {
        line_id: crypto.randomUUID(),
        id: product.id,
        sku: product.sku,
        name: product.name,
        price: parseFloat(product.price) || 0,
        // --- THE FIX: Look for unit_cost ---
        cost: parseFloat(product.unit_cost) || 0.0, 
        qty: 1,
        disc_type: null,
        disc_val: 0,
        tax_code: product.tax_code || 'HST',
        prov_tax_code: product.prov_tax_code || 'Exempt',
        item_commission: parseFloat(product.item_commission || 0), 
        ingredients: ingredients
      }];
    });
  };

  const updateIngredientQty = (line_id: string, sku: string, delta: number) => {
      setCart(prevCart => prevCart.map(item => {
          if (item.line_id !== line_id) return item;
          if (!item.ingredients) return item;

          const newIngredients = item.ingredients.map(ing => {
              if (ing.sku !== sku) return ing;
              const newQty = Math.max(0, ing.current_qty + delta);
              return { ...ing, current_qty: newQty };
          });

          return { ...item, ingredients: newIngredients };
      }));
  };

  const addGiftCardItem = () => {
    setCart(prev => [...prev, {
      line_id: crypto.randomUUID(),
      id: 'SYS_GIFT_CARD',
      sku: 'SYS_GIFT_CARD',
      name: 'Gift Card Load',
      price: 0,
      cost: 0, // <--- THE FIX
      qty: 1,
      disc_type: null,
      disc_val: 0,
      tax_code: 'Exempt',
      prov_tax_code: 'Exempt',
      is_gift_card: true,
      card_number: ""
    }]);
  };

  const updateQty = (line_id: string, valStr: string) => {
    const newQty = parseFloat(valStr);
    if (isNaN(newQty)) {
      setCart(cart.map(i => i.line_id === line_id ? { ...i, qty: 0 } : i));
      return;
    }
    if (newQty < 0) return;

    // PREVENT INCREASING QTY ABOVE ORIGINAL SALE AMOUNT DURING REFUND
    if (isRefundMode) {
      const origItem = originalSaleItems.find(o => o.line_id === line_id);
      if (origItem && newQty > origItem.qty) {
        alert(`Cannot refund more than the original purchased amount (${origItem.qty}).`);
        return;
      }
    }

    setCart(cart.map(i => i.line_id === line_id ? { ...i, qty: newQty } : i));
  };

  const updateItemPrice = (line_id: string, valStr: string) => {
    const newPrice = parseFloat(valStr);
    if (isNaN(newPrice)) {
      setCart(cart.map(i => i.line_id === line_id ? { ...i, price: 0 } : i));
      return;
    }
    if (newPrice < 0) return;
    setCart(cart.map(i => i.line_id === line_id ? { ...i, price: newPrice } : i));
  };

  const updateGiftCardNumber = (line_id: string, num: string) => {
    setCart(cart.map(i => i.line_id === line_id ? { ...i, card_number: num } : i));
  };

  const removeFromCart = (line_id: string) => {
    setCart(cart.filter(i => i.line_id !== line_id));
  };

  // --- DISCOUNT HANDLERS ---
  
  // 1. Auto-Fetch Promo Rules as User Types
  useEffect(() => {
    const code = promoCodeInput.trim();
    if (!code || isRefundMode) {
      if (!isRefundMode) {
        setCurrentPromoRules(null);
        setPromoStatus("default");
      }
      return;
    }
    
    const fetchPromo = async () => {
      try {
        const { data, error } = await supabase
          .from('promotions')
          .select('*')
          .eq('company_id', companyId)
          .ilike('code', code)
          .limit(1)
          .single();

        if (data) {
          setCurrentPromoRules(data);
        } else {
          setCurrentPromoRules({ _invalid: true }); // Flag for missing code
        }
      } catch (err) {
        setCurrentPromoRules({ _invalid: true });
      }
    };
    
    const timeoutId = setTimeout(fetchPromo, 400); // 400ms debounce prevents spamming the DB
    return () => clearTimeout(timeoutId);
  }, [promoCodeInput, companyId, isRefundMode]);

  // 2. Auto-validate rules against cart in real-time
  useEffect(() => {
    if (!promoCodeInput.trim() || isRefundMode) {
       if (!isRefundMode) {
         setPromoDiscount({ type: null, val: 0 });
         setPromoStatus("default");
       }
       return;
    }

    if (!currentPromoRules) return; // Still fetching from DB

    if (currentPromoRules._invalid) {
       setPromoDiscount({ type: null, val: 0 });
       setPromoStatus("invalid");
       return;
    }

    let isValid = true;
    const p = currentPromoRules;
    
    // Calculate discountable subtotal
    let dSub = 0;
    cart.forEach(i => {
      if (!i.is_tip && !i.is_gift_card) {
        let lineRaw = i.price * i.qty;
        if (i.disc_type === "%") lineRaw -= lineRaw * (i.disc_val / 100);
        else if (i.disc_type === "$") lineRaw -= i.disc_val;
        dSub += Math.max(0, lineRaw);
      }
    });

    if (dSub < (parseFloat(p.min_spend) || 0)) isValid = false;

    let reqSku = p.required_sku;
    let minQ = parseInt(p.min_qty) || 0;
    let qualQty = 0;

    if (reqSku && reqSku.trim() && reqSku.toUpperCase() !== "NONE") {
      let target = reqSku.trim().toUpperCase();
      let found = false;
      cart.forEach(i => {
        if ((i.sku && i.sku.toUpperCase() === target) || (i.name && i.name.toUpperCase() === target)) {
          found = true;
          qualQty += i.qty;
        }
      });
      if (!found) isValid = false;
    } else {
      qualQty = cart.reduce((sum, i) => (!i.is_tip && !i.is_gift_card ? sum + i.qty : sum), 0);
    }

    if (minQ > 0 && qualQty < minQ) isValid = false;

    const today = new Date();
    const todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayDay = days[today.getDay()];

    if (p.start_date && p.start_date.toUpperCase() !== "NONE" && todayLocal < p.start_date) isValid = false;
    if (p.end_date && p.end_date.toUpperCase() !== "NONE" && todayLocal > p.end_date) isValid = false;

    if (p.active_days && p.active_days !== "[]" && p.active_days.toUpperCase() !== "NONE") {
      if (!p.active_days.includes(todayDay)) isValid = false;
    }

    if (p.store_id && p.store_id !== "All Stores" && p.store_id !== storeId && storeId !== "ALL_STORES") {
       isValid = false; 
    }

    if (isValid) {
      setPromoDiscount({ type: p.disc_type, val: parseFloat(p.disc_val) });
      setPromoStatus("valid");
    } else {
      setPromoDiscount({ type: null, val: 0 });
      setPromoStatus("invalid");
    }
  }, [promoCodeInput, currentPromoRules, cart, storeId, isRefundMode]);

  const openDiscountModal = (type: 'manual' | 'item', lineId?: string) => {
    if (isRefundMode) return;
    setShowDiscountModal({ active: true, type, lineId });
    setDiscountInputType("%");
    setDiscountInputVal("");
  };

  const applyDiscount = () => {
    let val = parseFloat(discountInputVal);
    if (isNaN(val) || val < 0) val = 0;

    if (discountInputType === "%" && val > 100) val = 100;

    if (showDiscountModal.type === 'manual') {
      setManualDiscount({ type: discountInputType, val });
    } else if (showDiscountModal.type === 'item' && showDiscountModal.lineId) {
      setCart(cart.map(i => i.line_id === showDiscountModal.lineId ? { ...i, disc_type: discountInputType, disc_val: val } : i));
      setManualDiscount({ type: null, val: 0 }); 
    }
    
    setShowDiscountModal({ active: false, type: 'manual' });
  };

  // --- CUSTOMER HANDLERS ---
  const openNewCustomerModal = () => {
    setEditingCustomerId(null);
    setCustForm({ first: "", last: "", phone: "", email: "", dobM: "MM", dobD: "", dobY: "", street: "", city: "", prov: "ON", postal: "", notes: "" });
    setShowCustomerModal(true);
  };

  const openEditCustomerModal = () => {
    if (!customer) return;
    setEditingCustomerId(customer.id);
    
    let dobM = "MM", dobD = "", dobY = "";
    if (customer.birthday) {
      const parts = customer.birthday.split('-');
      if (parts.length === 3) {
        dobY = parts[0]; dobM = parts[1]; dobD = parts[2];
      }
    }

    let parsedStreet = "";
    let parsedCity = "";
    let parsedProv = "ON";
    let parsedPostal = "";

    if (customer.address) {
      const parts = customer.address.split(",").map((p: string) => p.trim());
      if (parts.length === 4) {
        parsedStreet = parts[0]; parsedCity = parts[1]; parsedProv = parts[2]; parsedPostal = parts[3];
      } else if (parts.length === 3) {
        parsedStreet = parts[0]; parsedCity = parts[1]; parsedProv = parts[2];
      } else if (parts.length === 2) {
        parsedStreet = parts[0]; parsedCity = parts[1];
      } else if (parts.length === 1) {
        parsedStreet = parts[0];
      }
    }
    
    setCustForm({
      first: customer.first_name || "",
      last: customer.last_name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      dobM, dobD, dobY,
      street: parsedStreet,
      city: parsedCity,
      prov: parsedProv,
      postal: parsedPostal,
      notes: customer.notes || ""
    });
    
    setShowCustomerModal(true);
  };

  const saveCustomer = async () => {
    if (!custForm.first && !custForm.last) return;

    let dobStr = null;
    if (custForm.dobM !== "MM" && custForm.dobD) {
      const safeY = custForm.dobY.length === 4 ? custForm.dobY : "0000";
      const safeD = custForm.dobD.padStart(2, "0");
      dobStr = `${safeY}-${custForm.dobM}-${safeD}`;
    }

    const custId = editingCustomerId || `cust_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

    const fullAddress = [custForm.street, custForm.city, custForm.prov, custForm.postal]
      .filter(part => part && part.trim() !== "")
      .join(", ");

    const custData = {
      id: custId,
      company_id: companyId,
      first_name: custForm.first,
      last_name: custForm.last,
      phone: custForm.phone,
      email: custForm.email,
      birthday: dobStr,
      address: fullAddress,
      notes: custForm.notes
    };

    try {
      const { error } = await supabase.from('customers').upsert([custData]);
      if (error) throw error;
      
      setCustomer(custData);
      setCustomerSearch(`${custData.first_name} ${custData.last_name}`.trim());
      setShowCustomerModal(false);
      setEditingCustomerId(null);
      setCustForm({ first: "", last: "", phone: "", email: "", dobM: "MM", dobD: "", dobY: "", street: "", city: "", prov: "ON", postal: "", notes: "" });
      
      fetchCustomers();
    } catch (err) {
      console.error("Error saving customer", err);
      alert("Failed to save customer data to the database.");
    }
  };

  // --- PARK & RECALL HANDLERS ---
  const handleParkClick = () => {
    if (isRefundMode) {
      alert("Cannot park a refund session.");
      return;
    }
    const hasStandardItems = cart.some(i => !i.is_tip);
    const hasValidTip = cart.some(i => i.is_tip && i.price > 0);

    if (!hasStandardItems && !hasValidTip) {
      alert("Cart is empty. Nothing to park.");
      return;
    }
    setShowParkModal(true);
  };

  const confirmPark = async () => {
    // --- STRICT UTC RULE ---
    const nowStr = new Date().toISOString(); 

    const meta = {
      manual_discount: manualDiscount,
      promo_discount: promoDiscount,
      global_discount: { type: null, val: 0 },
      current_promo_rules: currentPromoRules,
      is_native_exempt: isNativeExempt,
      status_card_val: statusCardNumber,
      manual_tax_active: manualTax !== null,
      manual_tax_val: manualTax !== null ? manualTax.toString() : "0.00",
      promo_code_text: promoCodeInput,
      total_val: totals.total
    };

    const parkData = {
      id: `PARK_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
      company_id: companyId,
      store_id: storeId === "ALL_STORES" ? null : storeId,
      user_id: user?.id,
      customer_json: customer ? JSON.stringify(customer) : null,
      cart_json: JSON.stringify(cart),
      meta_json: JSON.stringify(meta),
      timestamp: nowStr
    };

    try {
      const { error } = await supabase.from('parked_sales').insert([parkData]);
      if (error) throw error;
      voidCart();
      setShowParkModal(false);
    } catch (err) {
      console.error("Error parking sale", err);
      alert("Failed to park sale.");
    }
  };

  const handleRecallClick = async () => {
    try {
      // THE FIX: Added .neq('is_deleted', true) so we don't pull ghost sales!
      let q = supabase.from('parked_sales')
        .select('*')
        .eq('company_id', companyId)
        .neq('is_deleted', true); 
        
      if (storeId && storeId !== "ALL_STORES") q = q.or(`store_id.eq.${storeId},store_id.is.null`);
      
      const { data, error } = await q.order('timestamp', { ascending: false });
      if (error) throw error;
      
      setParkedSales(data || []);
      setShowRecallModal(true);
    } catch (err) {
      console.error("Error fetching parked sales", err);
    }
  };

  const restoreParkedSale = async (sale: any) => {
    voidCart(); 
    
    if (sale.cart_json) {
       const parsedCart = JSON.parse(sale.cart_json).map((item: any) => ({
         ...item,
         price: parseFloat(item.price) || 0,
         qty: parseFloat(item.qty) || 0
       }));
       setCart(parsedCart);
    }
    
    if (sale.customer_json) {
      const c = JSON.parse(sale.customer_json);
      setCustomer(c);
      setCustomerSearch(`${c.first_name} ${c.last_name}`);
    }
    
    if (sale.meta_json) {
      const meta = JSON.parse(sale.meta_json);
      setManualDiscount(meta.manual_discount || { type: null, val: 0 });
      setPromoDiscount(meta.promo_discount || { type: null, val: 0 });
      setPromoCodeInput(meta.promo_code_text || "");
      setCurrentPromoRules(meta.current_promo_rules || null);
      setPromoStatus(meta.promo_code_text ? (meta.current_promo_rules ? "valid" : "invalid") : "default");
      setIsNativeExempt(meta.is_native_exempt || false);
      
      if (meta.manual_tax_active) {
        setManualTax(parseFloat(meta.manual_tax_val) || 0);
      } else {
        setManualTax(null);
      }
    }

    setShowRecallModal(false);

    try {
      // SOFT DELETE: Marks it as deleted so Python POS will pull the flag and wipe it locally
      await supabase.from('parked_sales').update({ is_deleted: true }).eq('id', sale.id);
    } catch (e) {
      console.error("Error deleting parked sale after recall", e);
    }
  };

  // --- PAYMENT HANDLERS ---
  const saveTransactionToDatabase = async (finalPaymentQueue: any[], changeDue: number = 0) => {
    try {
      // =======================================================
      // --- PRE-SAVE CLOUD VERIFICATION (RACE CONDITION FIX) ---
      // =======================================================
      let sessionQuery = supabase
        .from('cash_sessions')
        .select('type')
        .eq('company_id', companyId)
        .in('type', ['Open', 'Close'])
        .neq('is_deleted', true)
        .order('timestamp', { ascending: false })
        .limit(1);

      if (storeId && storeId !== "ALL_STORES") sessionQuery = sessionQuery.eq('store_id', storeId);
      else sessionQuery = sessionQuery.is('store_id', null);

      const { data: preSaveData } = await sessionQuery;
      if (preSaveData && preSaveData.length > 0) {
        if (preSaveData[0].type === "Close") {
          alert("Transaction Aborted: The register was just closed on another device.");
          setIsStoreOpen(false);
          setShowPayment(false);
          return false;
        }
      }
      // =======================================================

      // --- 1. STRICT UTC STORAGE FORMATTING ---
      const now = new Date();
      const timestampStr = now.toISOString(); // strict UTC ISO string
      const dateStr = timestampStr.split('T')[0]; // Extract YYYY-MM-DD from the UTC string
      
      // Determine local timezone for receipt display projection
      const localTz = getStoreTimezone(storeProvince, storeId === "ALL_STORES");

      const saleId = `SALE_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
      const finalStoreId = storeId === "ALL_STORES" ? null : storeId;

      // Determine main payment method string
      let mainMethod = "";
      if (finalPaymentQueue.length === 1) {
        mainMethod = finalPaymentQueue[0].method;
      } else {
        const uniqueMethods = Array.from(new Set(finalPaymentQueue.map(p => p.method)));
        mainMethod = `Split (${uniqueMethods.join(', ')})`;
      }

      // Delta Logic for Refund
      let itemsToSave: any[] = [];
      
      if (isRefundMode) {
          const origMap: Record<string, any[]> = {};
          originalSaleItems.forEach(item => {
              const key = item.line_id; // <--- THE FIX: Groups perfectly by unique instance
              if (!origMap[key]) origMap[key] = [];
              origMap[key].push(item);
          });

          const cartMap: Record<string, any[]> = {};
          cart.forEach(item => {
              const key = item.line_id; // <--- THE FIX: Groups perfectly by unique instance
              if (!cartMap[key]) cartMap[key] = [];
              cartMap[key].push(item);
          });

          const allKeys = new Set([...Object.keys(origMap), ...Object.keys(cartMap)]);

          allKeys.forEach(key => {
             const origList = origMap[key] || [];
             const cartList = cartMap[key] || [];
             
             const origQty = origList.reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
             const cartQty = cartList.reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
             const parentDelta = cartQty - origQty; 
             
             const refItem = cartList.length > 0 ? cartList[0] : origList[0];
             
             let hasIngredientChange = false;
             let finalIngredients: any[] = [];
             
             const getIngTotals = (itemList: any[]) => {
                 const totals: Record<string, number> = {};
                 itemList.forEach(i => {
                     const pQty = parseFloat(i.qty) || 0;
                     (i.ingredients || []).forEach((ing: any) => {
                         const sku = ing.sku || ing.child_sku;
                         if (sku) {
                             totals[sku] = (totals[sku] || 0) + (pQty * (parseFloat(ing.current_qty) || 0));
                         }
                     });
                 });
                 return totals;
             };

             const origIngTotals = getIngTotals(origList);
             const cartIngTotals = getIngTotals(cartList);
             const allIngSkus = new Set([...Object.keys(origIngTotals), ...Object.keys(cartIngTotals)]);
             
             const isPartialIngChange = Math.abs(parentDelta) < 0.001;

             allIngSkus.forEach(sku => {
                 const oQty = origIngTotals[sku] || 0;
                 const cQty = cartIngTotals[sku] || 0;
                 
                 const deltaQ = cQty - oQty; 
                 if (Math.abs(deltaQ) > 0.001) hasIngredientChange = true;
                 
                 const perUnitQ = Math.abs(parentDelta) > 0.001 ? deltaQ / parentDelta : deltaQ;
                 
                 let refIng = null;
                 for (const lst of [cartList, origList]) {
                     for (const i of lst) {
                         const match = (i.ingredients || []).find((ig: any) => (ig.sku === sku || ig.child_sku === sku));
                         if (match) { refIng = match; break; }
                     }
                     if (refIng) break;
                 }
                 
                 if (refIng) {
                     finalIngredients.push({
                         sku: sku,
                         name: refIng.name || 'Unknown',
                         current_qty: perUnitQ,
                         base_qty: isPartialIngChange ? 0 : (refIng.base_qty || 0),
                         extra_cost: refIng.extra_cost || 0,
                         is_damaged: refundIngredientShrinkageIds.has(`${refItem.line_id}:${sku}`) 
                     });
                 }
             });
             
             if (Math.abs(parentDelta) < 0.001 && !hasIngredientChange) return;
             
             let deltaItem = JSON.parse(JSON.stringify(refItem));
             if (Math.abs(parentDelta) < 0.001) {
                 deltaItem.qty = 1.0; 
                 deltaItem.price = 0.0;
                 deltaItem.is_pure_ing_refund = true;
             } else {
                 deltaItem.qty = parentDelta;
                 deltaItem.is_pure_ing_refund = false;
             }
             deltaItem.ingredients = finalIngredients;
             deltaItem.is_damaged = refundShrinkageIds.has(refItem.line_id) ? 1 : 0;
             // Maintain the cost on the delta object correctly
             deltaItem.cost = refItem.cost || 0.0; 
             
             itemsToSave.push(deltaItem);
          });
      } else {
          itemsToSave = cart.map(i => ({...i, is_damaged: 0, is_pure_ing_refund: false}));
      }

      // --- FORMAT GIFT CARD NAMES FOR DB AND RECEIPT ---
      itemsToSave.forEach(item => {
          if ((item.is_gift_card || item.sku === 'SYS_GIFT_CARD') && item.card_number) {
              item.name = `Gift Card Load (*${item.card_number.slice(-4)})`;
          }
      });

      const finalSaleTotal = isRefundMode ? (totals.total - originalSaleTotal) : totals.total;

      // --- CALCULATE TRUE DELTA SUBTOTAL AND TAX FOR REFUNDS ---
      let finalSubtotalToSave = totals.subtotal;
      let finalTaxToSave = totals.finalTax;

      // 1.5 Calculate precise tax breakdown for the receipt
      let db_tax_val = 0.0;
      let db_prov_tax_val = 0.0;
      const tax_breakdown: Record<string, number> = {};
      
      if (!isNativeExempt) {
          let tempSub = 0.0;
          itemsToSave.forEach(item => {
              const surcharge = getItemSurcharge(item);
              let lineVal = (item.price + surcharge) * item.qty;
              if (item.disc_type === "%") lineVal -= lineVal * (parseFloat(item.disc_val || 0) / 100);
              else if (item.disc_type === "$") {
                  if (lineVal < 0) lineVal += Math.abs(parseFloat(item.disc_val || 0));
                  else lineVal -= Math.abs(parseFloat(item.disc_val || 0));
              }
              tempSub += lineVal;
          });

          // Calculate global discount ratio
          let ratio = 1.0;
          if (Math.abs(tempSub) > 0.001) {
              let p_amt = 0;
              const p_val = promoDiscount.val || 0;
              if (promoDiscount.type === "%") p_amt = tempSub * (p_val / 100);
              else if (promoDiscount.type === "$") p_amt = tempSub > 0 ? p_val : -Math.abs(p_val);
              
              const sub_after = tempSub - p_amt;
              
              let m_amt = 0;
              const m_val = manualDiscount.val || 0;
              if (manualDiscount.type === "%") m_amt = sub_after * (m_val / 100);
              else if (manualDiscount.type === "$") m_amt = sub_after > 0 ? m_val : -Math.abs(m_val);
              
              ratio = (sub_after - m_amt) / tempSub;
          }

          if (isRefundMode && totals.origDiscountableSubtotal > 0.001) {
              const currentDiscountableFinal = tempSub * ratio;
              const historicalRatio = currentDiscountableFinal / totals.origDiscountableSubtotal;
              
              db_tax_val = parseFloat(refundData?.tax_val || 0) * historicalRatio;
              db_prov_tax_val = parseFloat(refundData?.prov_tax_val || 0) * historicalRatio;
              
              // Map labels based on province
              let fedLabel = "GST";
              let provLabel = "PST";
              if (["ON", "NB", "NL", "NS", "PE"].includes(storeProvince)) { fedLabel = "HST"; provLabel = ""; }
              else if (storeProvince === "MB") { provLabel = "RST"; }
              else if (storeProvince === "QC") { provLabel = "QST"; }
              else if (["AB", "NT", "NU", "YT"].includes(storeProvince)) { provLabel = ""; }

              if (Math.abs(db_tax_val) > 0.005) tax_breakdown[fedLabel] = db_tax_val;
              if (Math.abs(db_prov_tax_val) > 0.005 && provLabel) tax_breakdown[provLabel] = db_prov_tax_val;
              
          } else {
              // Calculate per-item taxes using LIVE rates
              itemsToSave.forEach(item => {
                  const surcharge = getItemSurcharge(item);
                  let lineVal = (item.price + surcharge) * item.qty;
                  
                  if (item.disc_type === "%") lineVal -= lineVal * (parseFloat(item.disc_val || 0) / 100);
                  else if (item.disc_type === "$") {
                      if (lineVal < 0) lineVal += Math.abs(parseFloat(item.disc_val || 0));
                      else lineVal -= Math.abs(parseFloat(item.disc_val || 0));
                  }
                  
                  lineVal *= ratio;
                  
                  let fedCode = (item.tax_code || "HST").toUpperCase();
                  let provCode = (item.prov_tax_code || "Exempt").toUpperCase();
                  
                  // Smart Province Tax Mapping
                  if (fedCode === "HST" && ["AB", "BC", "MB", "QC", "SK", "NT", "NU", "YT"].includes(storeProvince)) {
                      fedCode = "GST";
                  } else if (fedCode === "GST" && ["ON", "NB", "NL", "NS", "PE"].includes(storeProvince)) {
                      fedCode = "HST";
                  }

                  let fedRate = 0.0;
                  let provRate = 0.0;
                  
                  if (fedCode === "CUSTOM" || provCode === "CUSTOM") {
                      fedRate = 0.0; 
                  } else {
                      fedRate = taxRates[fedCode.toLowerCase()] || 0.0;
                      provRate = taxRates[provCode.toLowerCase()] || 0.0;
                  }

                  const isTip = item.is_tip || item.sku === 'SYS_TIP' || item.name?.toLowerCase().includes('tip');
                  const isGiftCard = item.is_gift_card || item.sku === 'SYS_GIFT_CARD' || item.name?.toLowerCase().includes('gift card');
                  
                  if (isTip || isGiftCard || item.sku?.includes('SYS_')) {
                      fedRate = 0.0;
                      provRate = 0.0;
                      fedCode = "Exempt";
                      provCode = "Exempt";
                  }
                  
                  const fedTaxAmt = lineVal * fedRate;
                  const provTaxAmt = lineVal * provRate;
                  
                  db_tax_val += fedTaxAmt;
                  db_prov_tax_val += provTaxAmt;
                  
                  if (Math.abs(fedTaxAmt) > 0.005) {
                      tax_breakdown[fedCode] = (tax_breakdown[fedCode] || 0.0) + fedTaxAmt;
                  }
                  if (Math.abs(provTaxAmt) > 0.005) {
                      tax_breakdown[provCode] = (tax_breakdown[provCode] || 0.0) + provTaxAmt;
                  }
              });
          }
      }

      if (isRefundMode) {
          let deltaSub = 0;
          itemsToSave.forEach(item => {
              const surcharge = getItemSurcharge(item);
              let lineRaw = (item.price + surcharge) * item.qty;
              if (item.disc_type === "%") lineRaw -= lineRaw * (parseFloat(item.disc_val || 0) / 100);
              else if (item.disc_type === "$") {
                  if (lineRaw < 0) lineRaw += Math.abs(parseFloat(item.disc_val || 0));
                  else lineRaw -= Math.abs(parseFloat(item.disc_val || 0));
              }
              deltaSub += lineRaw;
          });
          finalSubtotalToSave = deltaSub;
          finalTaxToSave = isNativeExempt ? 0 : db_tax_val + db_prov_tax_val;
      }

      // 2. Prepare Core Sales Record
      const saleRecord = {
        id: saleId,
        date: timestampStr, 
        total: finalSaleTotal,
        method: mainMethod,
        user_id: user?.id || null, 
        store_id: finalStoreId,
        company_id: companyId,
        customer: customer ? `${customer.first_name} ${customer.last_name}`.trim() : "Guest",
        is_refund_of: isRefundMode ? refundData.id : null,
        manual_disc_type: manualDiscount.type || null,
        manual_disc_val: manualDiscount.val || 0,
        status_card_number: isNativeExempt ? (statusCardNumber || "X") : null,
        promo_code: promoCodeInput || "",
        promo_disc_type: promoDiscount.type || null,
        promo_disc_val: promoDiscount.val || 0,
        tax_val: db_tax_val,
        prov_tax_val: db_prov_tax_val
      };

      // --- FAST, COLLISION-FREE ID GENERATOR ---
      // Uses milliseconds since Jan 1, 2024, shifted to fit safely in a 32-bit integer 
      // without requiring a slow network request to check the database sequence.
      let syncBaseId = Math.floor((Date.now() - 1704067200000) / 10) * 100;

      // 3. Prepare Sale Items
      const saleItemsRecords = itemsToSave.map(item => {
          const surcharge = getItemSurcharge(item);
          
          return {
              id: syncBaseId++, // <--- THE FIX
              sale_id: saleId,
              product_id: (item.sku === 'SYS_TIP' || item.sku === 'SYS_GIFT_CARD' || item.is_tip || item.is_gift_card) ? null : (item.id || null),
              sku: item.sku || "",
              name: item.name,
              qty: item.qty,
              price: item.price + surcharge,
              cost: item.cost || 0.0, 
              disc_type: item.disc_type || null,
              disc_val: item.disc_val || 0,
              ingredients_snapshot: (item.ingredients && item.ingredients.length > 0) || item.card_number ? JSON.stringify({ 
                  base_price: item.price, 
                  ingredients: item.ingredients || [],
                  is_pure_ing_refund: item.is_pure_ing_refund || false,
                  card_number: item.card_number || null
              }) : null,
              is_damaged: item.is_damaged ? 1 : 0
          };
      });

      // 4. Prepare Sale Payments
      const salePaymentsRecords = finalPaymentQueue.map(p => ({
        id: syncBaseId++, // <--- THE FIX
        sale_id: saleId,
        method: p.method,
        amount: p.amount,
        payment_ref: p.card_number || ""
      }));

      // --- EXECUTE CORE INSERTS ---
      const { error: saleError } = await supabase.from('sales').insert([saleRecord]);
      if (saleError) throw new Error(`Sales Table: ${saleError.message}`);

      const { error: itemsError } = await supabase.from('sale_items').insert(saleItemsRecords);
      if (itemsError) throw new Error(`Sale Items Table: ${itemsError.message}`);

      const { error: paymentsError } = await supabase.from('sale_payments').insert(salePaymentsRecords);
      if (paymentsError) throw new Error(`Payments Table: ${paymentsError.message}`);

      // 5. Handle Tips Ledger
      const tipItemsToSave = itemsToSave.filter(i => i.is_tip || i.sku === 'SYS_TIP' || i.name?.toLowerCase().includes('tip'));
      
      if (tipItemsToSave.length > 0) {
        const totalTip = tipItemsToSave.reduce((sum, item) => sum + (item.price * item.qty), 0);
        
        if (Math.abs(totalTip) > 0.001) {
          const targetUserId = isRefundMode && refundData?.user_id ? refundData.user_id : (user?.id || null);
          const { error: tipError } = await supabase.from('tips_ledger').insert([{
            id: `TIP_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
            company_id: companyId,
            store_id: finalStoreId,
            user_id: targetUserId,
            sale_id: saleId,
            date: timestampStr,
            amount: totalTip,
            is_paid: 0
          }]);
          if (tipError) throw new Error(`Tips Ledger: ${tipError.message}`);
        }
      }

      // --- 5.5 Handle Commissions Ledger ---
      // 1. Calculate raw subtotal to determine the global discount ratio
      let rawCommSubtotal = 0.0;
      itemsToSave.forEach(i => {
          if (i.is_tip || i.sku === 'SYS_TIP' || i.is_gift_card || i.sku === 'SYS_GIFT_CARD') return;
          const surcharge = getItemSurcharge(i);
          let lineVal = (i.price + surcharge) * i.qty;
          if (i.disc_type === "%") lineVal -= lineVal * (parseFloat(i.disc_val || 0) / 100);
          else if (i.disc_type === "$") {
              if (lineVal < 0) lineVal += Math.abs(parseFloat(i.disc_val || 0));
              else lineVal -= Math.abs(parseFloat(i.disc_val || 0));
          }
          rawCommSubtotal += lineVal;
      });

      // 2. Determine the exact ratio of the final bill after global discounts
      let commRatio = 1.0;
      if (Math.abs(rawCommSubtotal) > 0.001) {
          let p_amt = 0;
          const p_val = promoDiscount.val || 0;
          if (promoDiscount.type === "%") p_amt = rawCommSubtotal * (p_val / 100);
          else if (promoDiscount.type === "$") p_amt = rawCommSubtotal > 0 ? p_val : -Math.abs(p_val);

          const sub_after = rawCommSubtotal - p_amt;

          let m_amt = 0;
          const m_val = manualDiscount.val || 0;
          if (manualDiscount.type === "%") m_amt = sub_after * (m_val / 100);
          else if (manualDiscount.type === "$") m_amt = sub_after > 0 ? m_val : -Math.abs(m_val);

          commRatio = (sub_after - m_amt) / rawCommSubtotal;
      }

      // 3. Calculate exact commission payload per item and SPLIT by positive/negative
      let refundCommissionTotal = 0.0;
      let newSaleCommissionTotal = 0.0;

      itemsToSave.forEach(i => {
          if (i.is_tip || i.sku === 'SYS_TIP' || i.is_gift_card || i.sku === 'SYS_GIFT_CARD') return;
          
          const surcharge = getItemSurcharge(i);
          let lineVal = (i.price + surcharge) * i.qty; 
          
          if (i.disc_type === "%") lineVal -= lineVal * (parseFloat(i.disc_val || 0) / 100);
          else if (i.disc_type === "$") {
              if (lineVal < 0) lineVal += Math.abs(parseFloat(i.disc_val || 0));
              else lineVal -= Math.abs(parseFloat(i.disc_val || 0));
          }
          
          const finalLineVal = lineVal * commRatio;
          let currentItemCommission = 0.0;
          
          // Apply Item-Specific Commission
          if (commItemEnabled) {
              const itemRate = parseFloat(i.item_commission || 0);
              if (itemRate > 0) {
                  currentItemCommission += finalLineVal * (itemRate / 100.0);
              }
          }

          // Apply Global Commission
          if (commGlobalEnabled && commGlobalRate > 0) {
              currentItemCommission += finalLineVal * (commGlobalRate / 100.0);
          }

          // Route the commission based on whether it's a return or a sale
          if (currentItemCommission < -0.001) {
              refundCommissionTotal += currentItemCommission;
          } else if (currentItemCommission > 0.001) {
              newSaleCommissionTotal += currentItemCommission;
          }
      });
      
      // 4. Build the Ledger Insert Array
      const commRecordsToInsert = [];

      if (Math.abs(refundCommissionTotal) > 0.001) {
          const targetUserId = isRefundMode && refundData?.user_id ? refundData.user_id : (user?.id || null);
          commRecordsToInsert.push({
              id: `COMM_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
              company_id: companyId,
              store_id: finalStoreId,
              user_id: targetUserId, 
              sale_id: saleId,
              date: timestampStr,
              amount: refundCommissionTotal, 
              is_paid: 0
          });
      }

      if (Math.abs(newSaleCommissionTotal) > 0.001) {
          commRecordsToInsert.push({
              id: `COMM_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
              company_id: companyId,
              store_id: finalStoreId,
              user_id: user?.id || null,
              sale_id: saleId,
              date: timestampStr,
              amount: newSaleCommissionTotal, 
              is_paid: 0
          });
      }

      if (commRecordsToInsert.length > 0) {
          const { error: commError } = await supabase.from('commissions_ledger').insert(commRecordsToInsert);
          if (commError) throw new Error(`Commissions Ledger: ${commError.message}`);
      }
      // ------------------------------------------

      // 6. Handle Gift Card Loads 
      const unique_gc_lines: string[] = []; 
      
      for (const item of itemsToSave) {
        if (item.is_gift_card || item.sku === 'SYS_GIFT_CARD') {
            let cNum = item.card_number;
            if (!cNum && item.ingredients_snapshot) {
                try {
                    const snap = JSON.parse(item.ingredients_snapshot);
                    cNum = snap.card_number;
                } catch(e) {}
            }
            
            const loadAmt = item.price * item.qty; 
            
            if (cNum && Math.abs(loadAmt) > 0.001) {
              const { data: existingGc } = await supabase.from('gift_cards')
                .select('current_balance, initial_balance') 
                .eq('company_id', companyId)
                .eq('card_number', cNum)
                .maybeSingle();

              let newBalance = loadAmt;

              if (existingGc) {
                 const currBal = parseFloat(existingGc.current_balance || "0");
                 const initBal = parseFloat(existingGc.initial_balance || "0");
                 newBalance = currBal + loadAmt;
                 
                 if (newBalance <= 0.001 && initBal <= (Math.abs(loadAmt) + 0.001)) {
                     await supabase.from('gift_cards').delete().eq('company_id', companyId).eq('card_number', cNum);
                 } else {
                     await supabase.from('gift_cards')
                      .update({ 
                        current_balance: newBalance,
                        updated_at: timestampStr
                      })
                      .eq('company_id', companyId)
                      .eq('card_number', cNum);
                 }
              } else if (!isRefundMode) {
                await supabase.from('gift_cards').insert([{
                  id: `GC_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
                  company_id: companyId,
                  store_id: finalStoreId,
                  card_number: cNum,
                  initial_balance: loadAmt,
                  current_balance: loadAmt,
                  status: 'Active',
                  created_at: timestampStr,
                  updated_at: timestampStr
                }]);
              }
              
              if (newBalance > 0.001) {
                 unique_gc_lines.push(`Card ${cNum.slice(-4)} Balance: $${newBalance.toFixed(2)}`);
              }
            }
        }
      }

      // 7. Handle Gift Card Payments (Deductions)
      for (const p of finalPaymentQueue) {
        if (p.method === 'Gift Card' && p.card_number) {
          const { data: existingGc } = await supabase.from('gift_cards')
            .select('current_balance')
            .eq('company_id', companyId)
            .eq('card_number', p.card_number)
            .maybeSingle(); 
          
          if (existingGc) {
             const newBalance = parseFloat(existingGc.current_balance) - p.amount;
             await supabase.from('gift_cards')
              .update({ 
                current_balance: newBalance,
                is_used: 1, 
                updated_at: timestampStr
              })
              .eq('company_id', companyId)
              .eq('card_number', p.card_number);
             
             unique_gc_lines.push(`Card ${p.card_number.slice(-4)} Balance: $${newBalance.toFixed(2)}`);
          }
        }
      }

      // 8. Inventory Ledger Update 
      const inventoryRecords: any[] = [];

      for (const item of itemsToSave) {
        if (item.is_tip || item.is_gift_card || item.sku === 'SYS_TIP' || item.sku === 'SYS_GIFT_CARD') continue;
        
        let parentQtyChange = -item.qty; 

        if (item.ingredients && item.ingredients.length > 0) {
          for (const ing of item.ingredients) {
            const ingSku = ing.sku || ing.child_sku;
            let ingQtyChange = parentQtyChange * parseFloat(ing.current_qty || 0);

            if (ingQtyChange > 0 && ing.is_damaged) {
                ingQtyChange = 0;
            }

            if (ingQtyChange !== 0) {
              inventoryRecords.push({
                id: `LEDG_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
                company_id: companyId,
                store_id: finalStoreId,
                product_id: null, 
                sku: ingSku,
                qty_change: ingQtyChange, 
                action_type: "Sale/Refund",
                timestamp: timestampStr,
                created_at: timestampStr
              });
            }
          }
        } else {
          if (parentQtyChange > 0 && item.is_damaged === 1) {
            parentQtyChange = 0;
          }

          if (parentQtyChange !== 0) {
            inventoryRecords.push({
              id: `LEDG_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
              company_id: companyId,
              store_id: finalStoreId,
              product_id: item.id || null,
              sku: item.sku || null,
              qty_change: parentQtyChange, 
              action_type: "Sale/Refund",
              timestamp: timestampStr,
              created_at: timestampStr
            });
          }
        }
      }

      if (inventoryRecords.length > 0) {
        const { error: invError } = await supabase.from('inventory_ledger').insert(inventoryRecords);
        if (invError) throw new Error(`Inventory Ledger: ${invError.message}`);
      }

      // 9. Activity Log
      const userDisplay = user?.username || user?.first_name || "Unknown";
      const shortId = saleId.replace("SALE_", "").substring(0, 6);
      const actionTxt = isRefundMode ? "Refund Processed" : "Sale Completed";
      const logDesc = `${actionTxt}: #${shortId} for $${Math.abs(finalSaleTotal).toFixed(2)} (${mainMethod})`;
      
      const { error: actError } = await supabase.from('activity_log').insert([{
        id: syncBaseId++, // <--- THE FIX
        date: dateStr,
        timestamp: Math.floor(now.getTime() / 1000), 
        company_id: companyId,
        store_id: finalStoreId,
        user_id: user?.id || null,
        user_name: userDisplay,
        action: actionTxt,
        description: logDesc
      }]);
      if (actError) throw new Error(`Activity Log: ${actError.message}`);

      // --- 10. LOCAL TIMEZONE PROJECTION FOR RECEIPT ---
      const localDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const localTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: localTz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);

      const receiptData = {
          companyName: rawConfig?.companyName || "Our Store",
          sale_id: saleId,
          date: localDateStr,
          time: localTimeStr, // Newly injected local time string
          cashier: user?.username || user?.first_name || "Staff",
          customer: customer ? `${customer.first_name} ${customer.last_name}` : "Guest",
          items: itemsToSave.map(i => ({ ...i, price: i.price + getItemSurcharge(i) })),
          subtotal: finalSubtotalToSave.toFixed(2),
          tax: (db_tax_val + db_prov_tax_val).toFixed(2),
          total: finalSaleTotal.toFixed(2),
          payments: finalPaymentQueue,
          change: changeDue,
          promo_discount: promoDiscount,
          manual_discount: manualDiscount,
          promo_code: promoCodeInput,
          tax_breakdown: tax_breakdown,
          gc_balances: Array.from(new Set(unique_gc_lines))
      };
      
      // 11. Capture totals, reset UI, and trigger Success Modal
      voidCart();
      setShowPayment(false);
      setPaymentQueue([]);
      setSplitAmount("");

      setSuccessData({
        active: true,
        changeDue: changeDue,
        total: finalSaleTotal,
        saleId: saleId,
        receiptData: receiptData
      } as any);
      
      return true;

    } catch (err: any) {
      console.error("Critical error saving sale:", err);
      alert(`Failed to save the transaction.\nError: ${err.message || JSON.stringify(err)}`);
      return false; 
    }
  };

  const processPayment = async (method: string) => {
    let cardNum: string | null | undefined = undefined;
    let availableGcBalance: number | null = null;
    
    if (method === "Gift Card") {
      cardNum = await customPrompt("Gift Card Payment", "Swipe or Enter Gift Card Number:");
      
      if (!cardNum || !cardNum.trim()) return; 
      cardNum = cardNum.trim();

      try {
          const { data: gc, error } = await supabase
              .from('gift_cards')
              .select('current_balance, status')
              .eq('company_id', companyId)
              .eq('card_number', cardNum)
              .maybeSingle();

          if (error) throw error;

          if (!gc) {
              await customAlert("Card Not Found", `Gift Card '${cardNum}' could not be found in the system.`);
              return;
          }

          if (gc.status === 'Inactive' || gc.status === 'Void') {
              await customAlert("Invalid Status", `Gift Card '${cardNum}' is currently marked as ${gc.status}.`);
              return;
          }

          availableGcBalance = parseFloat(gc.current_balance || "0");
          
          if (availableGcBalance <= 0 && !isRefundMode) {
              await customAlert("Empty Balance", `Gift Card '${cardNum}' has a $0.00 balance.`);
              return;
          }
      } catch (err) {
          console.error("Error verifying gift card:", err);
          await customAlert("Network Error", "Failed to verify gift card with the server. Please check your connection.");
          return;
      }
    }

    const currentTotalVal = isRefundMode ? totals.total - originalSaleTotal : totals.total;
    const currentRemaining = currentTotalVal - paymentQueue.reduce((a, b) => a + b.amount, 0);
    
    if (Math.abs(currentRemaining) <= 0.001) return;

    let amountToPay = parseFloat(splitAmount);
    if (isNaN(amountToPay)) amountToPay = currentRemaining;

    const payAmountSigned = currentRemaining >= 0 ? Math.abs(amountToPay) : -Math.abs(amountToPay);

    let actualCharge = payAmountSigned;
    let changeDue = 0;

    if (Math.abs(payAmountSigned) > Math.abs(currentRemaining) + 0.001) {
      if (method === "Cash") {
        changeDue = Math.abs(payAmountSigned) - Math.abs(currentRemaining);
        actualCharge = currentRemaining;
      } else {
        actualCharge = currentRemaining;
      }
    }

    if (method === "Gift Card" && availableGcBalance !== null && !isRefundMode) {
        if (actualCharge > availableGcBalance) {
            actualCharge = availableGcBalance;
            await customAlert("Partial Payment Applied", `Gift Card only has $${availableGcBalance.toFixed(2)} available. Applying partial payment to the bill.`);
        }
    }

    const newQueue = [...paymentQueue, { method, amount: actualCharge, card_number: cardNum }];
    setPaymentQueue(newQueue);

    const newRemaining = currentTotalVal - newQueue.reduce((a, b) => a + b.amount, 0);
    
    if (Math.abs(newRemaining) <= 0.01) {
      const success = await saveTransactionToDatabase(newQueue, changeDue);
      if (!success) {
         setPaymentQueue(paymentQueue);
      }
    } else {
      setSplitAmount(Math.abs(newRemaining).toFixed(2));
    }
  };

  // --- UI RENDER ---
  if (isStoreOpen === false) {
    return (
      <div className="flex h-full w-full bg-[#181818] items-center justify-center">
        <div className="bg-[#222222] border border-gray-800 shadow-xl rounded-2xl w-[650px] h-[400px] flex flex-col items-center justify-center p-8">
          
          <svg xmlns="http://www.w3.org/2000/svg" className="h-[75px] w-[75px] text-gray-300 mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>

          <h2 className="text-[34px] font-bold text-gray-400 mb-3 tracking-wide">Register is Currently Closed</h2>
          <p className="text-gray-500 text-[17px] mb-10 font-medium">Please open the till to begin processing sales.</p>
          
          <button
            onClick={() => setActiveModule("Open/Close")}
            style={{ backgroundColor: themeColor }}
            className="px-10 py-3.5 rounded text-white font-bold text-[16px] tracking-widest uppercase transition-transform active:scale-95 shadow-md hover:brightness-110"
          >
            OPEN TILL NOW
          </button>

        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#181818] relative">
      
      {/* LEFT: Products & Search */}
      <div className="flex-[1.8] flex flex-col p-8 pl-10 pr-6 gap-2">
        
        {/* Header Row: Title & Buttons */}
        <div className="flex justify-between items-end mb-2">
          <div className="flex items-center gap-4">
            <h1 className="text-[26px] font-bold tracking-wide">Item Search</h1>
            
            {/* GIFT CARD INJECT BUTTON */}
            {acceptGiftCards && (
              <button 
                onClick={addGiftCardItem}
                style={{ color: themeColor, borderColor: themeColor }}
                className="px-3 py-1 text-xs font-bold border rounded hover:bg-[#2a2a2a] transition-colors"
              >
                + Activate Gift Card
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setActiveModule("Dashboard")}
              className="px-5 py-1.5 border border-gray-600 rounded text-[13px] font-bold text-gray-300 hover:bg-[#2a2a2a] transition-colors"
            >
              Dashboard
            </button>
            <button 
              onClick={fetchAndShowDailySummary}
              disabled={isFetchingSummary}
              className={`px-5 py-1.5 border border-gray-600 rounded text-[13px] font-bold text-gray-300 transition-colors ${isFetchingSummary ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#2a2a2a]'}`}
            >
              {isFetchingSummary ? "Loading..." : "Daily Summary"}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <input 
          type="text" 
          placeholder="Enter a product or service" 
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            fetchProducts(e.target.value);
          }}
          style={{ "--focus-color": themeColor } as React.CSSProperties}
          className="w-full bg-[#1e1e1e] border border-gray-700 p-4 rounded-xl text-lg outline-none focus:[border-color:var(--focus-color)] transition-colors"
        />

        {/* Category Filter Bar */}
        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2 pb-3">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                style={{ 
                  backgroundColor: selectedCategories.includes(cat) ? themeColor : 'transparent',
                  borderColor: selectedCategories.includes(cat) ? themeColor : '#4b5563',
                  color: selectedCategories.includes(cat) ? 'white' : '#d1d5db'
                }}
                className="px-6 py-2 rounded border whitespace-nowrap font-bold text-sm transition-colors hover:brightness-110"
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        
        {/* Product List View */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2 mt-2 scrollbar-hide pr-2">
          {products.map(p => (
            <div 
              key={p.id}
              className="bg-[#222222] px-5 py-3.5 rounded-xl border border-transparent transition-colors flex justify-between items-center group hover:border-gray-700 cursor-pointer"
              onClick={() => addToCart(p)}
            >
              <span className="font-bold text-[17px] text-gray-100 group-hover:text-white truncate pr-4">{p.name}</span>
              
              <div className="flex items-center gap-6 shrink-0">
                <span className="font-bold text-[17px] text-gray-200 w-20 text-right">${parseFloat(p.price).toFixed(2)}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                  style={{ backgroundColor: themeColor }}
                  className="px-5 py-2 rounded text-white font-bold text-[13px] hover:brightness-110 transition-transform active:scale-95"
                >
                  ADD
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
             <p className="text-gray-500 text-center mt-10">No items found.</p>
          )}
        </div>
      </div>

      {/* RIGHT: Cart & Checkout */}
      <div className="flex-[1.2] bg-[#1e1e1e] flex flex-col shadow-2xl z-10 border-l border-gray-800">
        
        {/* Cart Header */}
        <div className="p-6 pb-4 flex justify-between items-center">
          <h2 className="text-[26px] font-bold tracking-wide">Current Bill</h2>
          <div className="flex items-center gap-2">
            {!isRefundMode && (
              <>
                <button onClick={handleRecallClick} style={{ color: themeColor, borderColor: themeColor }} className="px-3 py-1 text-xs font-bold border rounded hover:bg-[#2a2a2a] transition-colors uppercase">RECALL</button>
                <button onClick={handleParkClick} style={{ color: themeColor, borderColor: themeColor }} className="px-3 py-1 text-xs font-bold border rounded hover:bg-[#2a2a2a] transition-colors uppercase">PARK</button>
              </>
            )}
            <button onClick={voidCart} className="px-3 py-1 text-xs font-bold text-[#C92C2C] border border-[#C92C2C] rounded hover:bg-[#2a2a2a] transition-colors uppercase ml-2">
              {isRefundMode ? 'CANCEL REFUND' : 'VOID'}
            </button>
            <span className="text-gray-400 text-sm ml-3 font-medium tracking-wider">
              {currentTime.toLocaleTimeString([], { 
                 timeZone: getStoreTimezone(storeProvince, storeId === "ALL_STORES"), 
                 hour: '2-digit', 
                 minute:'2-digit' 
              })}
            </span>
          </div>
        </div>

        {/* Customer Select (With Autocomplete) */}
        <div className="px-6 pb-5 border-b border-gray-800">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">Customer:</label>
          <div className="flex gap-2 h-[38px]" ref={customerDropdownRef}>
            <div className="relative flex-1 h-full">
              <input 
                type="text" 
                placeholder="Enter Customer" 
                value={customerSearch}
                disabled={isRefundMode}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerDropdown(true);
                  if (e.target.value === "") setCustomer(null);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                className="w-full bg-[#141414] border border-gray-700 rounded px-3 text-sm outline-none focus:border-gray-500 transition-colors h-full disabled:opacity-50" 
              />
              {/* Autocomplete Dropdown */}
              {showCustomerDropdown && customerSearch && !isRefundMode && (
                <div className="absolute top-full left-0 w-full mt-1 bg-[#2b2b2b] border border-gray-700 rounded shadow-2xl max-h-48 overflow-y-auto z-50">
                  {customers.filter(c => 
                    `${c.first_name} ${c.last_name} ${c.phone}`.toLowerCase().includes(customerSearch.toLowerCase())
                  ).map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomer(c);
                        setCustomerSearch(`${c.first_name} ${c.last_name}`.trim());
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-[#3B8ED0] text-sm text-gray-200 hover:text-white transition-colors border-b border-gray-700 last:border-0"
                    >
                      <div className="font-bold">{c.first_name} {c.last_name}</div>
                      {c.phone && <div className="text-xs opacity-70">{c.phone}</div>}
                    </button>
                  ))}
                  {customers.filter(c => `${c.first_name} ${c.last_name} ${c.phone}`.toLowerCase().includes(customerSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500 italic">No matching customers</div>
                  )}
                </div>
              )}
            </div>
            
            <button 
              onClick={openNewCustomerModal}
              disabled={isRefundMode}
              style={{ backgroundColor: isRefundMode ? 'gray' : themeColor }} 
              className="w-10 rounded text-white font-bold text-lg flex items-center justify-center shadow-sm hover:brightness-110 transition-colors disabled:hover:brightness-100"
            >
              +
            </button>
            <button 
              onClick={openEditCustomerModal}
              disabled={!customer}
              className={`w-10 rounded border flex items-center justify-center transition-colors ${customer ? 'border-gray-500 text-gray-200 hover:bg-[#2a2a2a]' : 'border-gray-700 text-gray-600 cursor-not-allowed'}`}
            >
              ✎
            </button>
          </div>
        </div>

        {/* Cart Items Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#252525]">
          {cart.length === 0 && <p className="text-gray-500 text-center mt-20 italic">Cart is empty</p>}
          {cart.map(item => (
            <div key={item.line_id} className="flex flex-col border-b border-gray-700 pb-3">
              
              {/* DYNAMIC SYSTEM ITEM RENDERING (TIPS & GIFT CARDS) */}
              {(item.is_tip || item.is_gift_card) ? (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[14px] text-gray-100">{item.name}</span>
                    
                    <div className="flex items-center gap-2">
                      {item.is_gift_card && (
                        <input 
                          type="text"
                          placeholder="Enter Card Number"
                          value={item.card_number || ""}
                          disabled={isRefundMode}
                          onChange={(e) => updateGiftCardNumber(item.line_id, e.target.value)}
                          className="w-[160px] bg-[#141414] border border-gray-600 rounded px-2 py-1 text-[13px] outline-none focus:border-gray-400 transition-colors text-white disabled:opacity-50"
                        />
                      )}
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-gray-300 text-[14px]">$</span>
                        <input 
                          type="number" 
                          value={item.price === 0 ? "" : item.price} 
                          placeholder="0.00"
                          disabled={isRefundMode}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateItemPrice(item.line_id, e.target.value)}
                          className="w-[70px] bg-[#141414] border border-gray-600 text-right rounded py-1 px-2 text-[14px] font-bold outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-white disabled:opacity-50"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-gray-400 text-[12px] italic">{item.is_tip ? "Manual Tip Entry" : "Enter Load Amount"}</span>
                    
                    {/* THE FIX: Show remove button for Tips during Refund Mode! */}
                    {(isRefundMode || item.is_gift_card) && (
                      <button onClick={() => removeFromCart(item.line_id)} className="text-[#C92C2C] text-[12px] hover:text-red-400 transition-colors font-bold">Remove</button>
                    )}
                    
                  </div>
                </div>
              ) : (

                /* STANDARD PRODUCT RENDERING */
                <div className="flex flex-col">
                  <div className="flex justify-between font-bold text-[14px]">
                    <span style={{ color: isRefundMode && refundShrinkageIds.has(item.line_id) ? '#C92C2C' : '#f3f4f6' }}>
                      {item.name} {isRefundMode && refundShrinkageIds.has(item.line_id) ? '[DAMAGED]' : ''}
                    </span>
                    <span style={{ color: isRefundMode && refundShrinkageIds.has(item.line_id) ? '#C92C2C' : '#f3f4f6' }}>
                      ${(
                          ((item.price + getItemSurcharge(item)) * item.qty) - 
                          (item.disc_type === '$' ? item.disc_val : ((item.price + getItemSurcharge(item)) * item.qty * (item.disc_val/100)))
                       ).toFixed(2)}
                    </span>
                  </div>
                  
                  {/* Item Level Discount Badge */}
                  {item.disc_type && (
                    <div className="text-[#C92C2C] font-bold text-[13px] mb-0.5">
                      (-{item.disc_type === '%' ? `${item.disc_val}%` : `$${item.disc_val.toFixed(2)}`})
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-1.5">
                    <div className="flex items-center gap-2">
                      {item.ingredients && item.ingredients.length > 0 ? (
                        /* THE FIX: Show static number for packaged items */
                        <span className="w-[45px] text-center text-[14px] font-bold text-white">
                          {item.qty}
                        </span>
                      ) : (
                        /* Standard items get the editable input box */
                        <input 
                          type="number" 
                          value={item.qty.toString()} 
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateQty(item.line_id, e.target.value)}
                          className="w-[45px] bg-[#141414] border border-gray-600 text-center rounded py-0.5 text-[13px] font-medium outline-none focus:border-gray-400 [color-scheme:dark] text-white"
                        />
                      )}
                      <span className="text-gray-400 text-[13px]">@ ${(item.price + getItemSurcharge(item)).toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      {!isRefundMode && (
                        <button 
                          onClick={() => openDiscountModal('item', item.line_id)}
                          className="text-gray-300 hover:text-white text-[11px] font-bold border border-gray-700 px-2 py-0.5 rounded bg-[#2a2a2a] transition-colors"
                        >
                          Discount
                        </button>
                      )}
                      {/* FIX: Hide parent RESTOCK button if item has ingredients */}
                      {isRefundMode && (!item.ingredients || item.ingredients.length === 0) && (
                        <button 
                          onClick={() => toggleShrinkageStatus(item.line_id)}
                          className={`text-[10px] font-bold px-3 py-1 rounded transition-colors ${refundShrinkageIds.has(item.line_id) ? 'bg-[#C92C2C] text-white' : 'bg-[#2CC985] text-white'}`}
                        >
                          {refundShrinkageIds.has(item.line_id) ? 'DAMAGED' : 'RESTOCK'}
                        </button>
                      )}
                      <button onClick={() => removeFromCart(item.line_id)} className="text-[#C92C2C] text-[12px] hover:text-red-400 font-bold transition-colors">Remove</button>
                    </div>
                  </div>

                  {/* INGREDIENTS RENDERER */}
                  {item.ingredients && item.ingredients.length > 0 && (
                      <div className="bg-[#1a1a1a] rounded mt-2 px-3 py-1.5 border border-gray-700 flex flex-col gap-1">
                          {item.ingredients.map((ing: any, idx: number) => {
                              const mult = item.qty !== 0 ? item.qty : 1.0;
                              const totalIng = mult * (parseFloat(ing.current_qty) || 0);
                              const ingColor = totalIng < 0 ? "text-[#C92C2C]" : "text-gray-300";
                              
                              return (
                                  <div key={idx} className="flex justify-between items-center py-1 border-b border-gray-800 last:border-0">
                                      <div className="flex items-center gap-3">
                                          {/* FIX: Interactive +/- buttons during refund mode */}
                                          <div className="flex items-center bg-[#2a2a2a] border border-gray-600 rounded">
                                              <button
                                                  onClick={() => updateIngredientQty(item.line_id, ing.sku || ing.child_sku, -1)}
                                                  className="px-2 py-0.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors rounded-l"
                                              >-</button>
                                              <span className="w-6 text-center text-[12px] font-bold text-white">{ing.current_qty}</span>
                                              <button
                                                  onClick={() => updateIngredientQty(item.line_id, ing.sku || ing.child_sku, 1)}
                                                  className="px-2 py-0.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors rounded-r"
                                              >+</button>
                                          </div>
                                          <span className={`text-[13px] ${ingColor}`}>{ing.name}</span>
                                      </div>
                                      
                                      <div className="flex items-center gap-3">
                                          {ing.current_qty > ing.base_qty && ing.extra_cost > 0 && (
                                              <span className="text-[12px] font-bold" style={{ color: themeColor }}>
                                                  (+${((ing.current_qty - ing.base_qty) * ing.extra_cost).toFixed(2)})
                                              </span>
                                          )}
                                          {ing.current_qty < ing.base_qty && (
                                              <span className="text-[12px] text-gray-500 italic">(Less)</span>
                                          )}
                                          
                                          {/* THE FIX: Reference the global Set to maintain state even when the item is fully removed */}
                                          {isRefundMode && (() => {
                                              const dmgKey = `${item.line_id}:${ing.sku || ing.child_sku}`;
                                              const isIngDamaged = refundIngredientShrinkageIds.has(dmgKey);
                                              return (
                                                  <button 
                                                      onClick={() => toggleIngredientShrinkage(item.line_id, ing.sku || ing.child_sku)}
                                                      className={`text-[9px] font-bold px-2 py-1 rounded transition-colors ${isIngDamaged ? 'bg-[#C92C2C] text-white' : 'bg-[#2CC985] text-white'}`}
                                                  >
                                                      {isIngDamaged ? 'DAMAGED' : 'RESTOCK'}
                                                  </button>
                                              );
                                          })()}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  )}

                </div>
              )}

            </div>
          ))}
        </div>

        {/* Totals Engine */}
        <div className="p-5 bg-[#1a1a1a] rounded-b-xl border-t border-gray-800 space-y-2">
          
          <div className="flex justify-between text-gray-400 font-medium text-[14px]">
            <span>Subtotal</span>
            <span className="font-bold">${totals.subtotal.toFixed(2)}</span>
          </div>

          {/* Discount Controls */}
          <div className="flex justify-between items-center py-0.5">
             <div className="flex gap-2 h-6">
                <button 
                  onClick={() => openDiscountModal('manual')}
                  disabled={isRefundMode}
                  className="text-[11px] font-bold border border-gray-600 px-2.5 rounded hover:bg-[#2a2a2a] text-gray-400 transition-colors disabled:opacity-50"
                >
                  Discount Bill
                </button>
                <div className={`flex border rounded overflow-hidden transition-colors ${promoStatus === 'valid' ? 'border-[#2CC985]' : promoStatus === 'invalid' ? 'border-[#C92C2C]' : 'border-gray-600'} ${isRefundMode ? 'opacity-50' : ''}`}>
                  <input 
                    type="text" 
                    placeholder="Promo Code" 
                    value={promoCodeInput}
                    disabled={isRefundMode}
                    onChange={(e) => setPromoCodeInput(e.target.value)}
                    className="w-20 bg-[#141414] px-2 text-[11px] outline-none text-white font-medium uppercase disabled:opacity-50"
                  />
                  <div 
                    style={{ backgroundColor: promoStatus === 'valid' ? '#2CC985' : promoStatus === 'invalid' ? '#C92C2C' : themeColor }} 
                    className="px-2.5 flex items-center justify-center text-[11px] font-bold text-white transition-colors"
                  >
                    {promoStatus === 'valid' ? 'ACTIVE' : 'APPLY'}
                  </div>
                </div>
             </div>
             {(totals.promoAmt > 0 || totals.manualAmt > 0) && (
               <span className="text-[#C92C2C] font-bold text-[12px]">
                 {totals.promoAmt > 0 && `Promo: -$${totals.promoAmt.toFixed(2)} `}
                 {totals.manualAmt > 0 && `Manual: -$${totals.manualAmt.toFixed(2)}`}
               </span>
             )}
          </div>
          {totals.totalDiscount > 0 && (
             <div className="flex justify-between text-gray-400 font-medium pb-1.5 border-b border-gray-800 text-[14px]">
               <span>Adjusted Subtotal</span>
               <span className="font-bold text-white">${totals.finalSubtotal.toFixed(2)}</span>
             </div>
          )}

          <div className="flex justify-between items-center text-gray-400 font-medium pt-1 text-[14px]">
            <div className="flex gap-2 items-center">
              <span>Tax</span>
              <button 
                onClick={() => setIsNativeExempt(!isNativeExempt)}
                disabled={isRefundMode}
                style={{ 
                  backgroundColor: isNativeExempt ? themeColor : 'transparent',
                  borderColor: isNativeExempt ? themeColor : '#4b5563',
                  color: isNativeExempt ? 'white' : '#9ca3af'
                }}
                className="text-[10px] uppercase px-1.5 py-0.5 rounded border transition-colors font-bold tracking-wider disabled:opacity-50"
              >
                Native
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold border border-gray-700 bg-[#141414] px-2 py-0.5 rounded">${totals.finalTax.toFixed(2)}</span>
            </div>
          </div>

          {/* REFUND ORIGINAL PAYMENT ROW */}
          {isRefundMode && (
             <div className="flex justify-between text-gray-400 font-medium pt-1 text-[14px]">
               <span>Less: Original Pmt</span>
               <span className="font-bold" style={{ color: themeColor }}>-${originalSaleTotal.toFixed(2)}</span>
             </div>
          )}

          {/* CHECKOUT ROW */}
          <div className="flex items-center gap-4 mt-1 pt-3 border-t border-gray-800">
            {(() => {
              const deltaTotal = isRefundMode ? totals.total - originalSaleTotal : totals.total;
              const hasValidItems = cart.some(i => !i.is_tip) || cart.some(i => i.is_tip && i.price > 0);
              
              // Normal sales require items. Refunds require EITHER a price difference OR items (for $0 exchanges)
              const canCheckout = isRefundMode ? (Math.abs(deltaTotal) >= 0.01 || hasValidItems) : hasValidItems;

              return (
                <>
                  <button 
                      onClick={async () => {
                        const missingGC = cart.some(i => i.is_gift_card && !i.card_number?.trim());
                        if (missingGC) {
                           await customAlert("Missing Information", "Please enter a Card Number for all Gift Card loads before checking out.");
                           return;
                        }
                        
                        if (Math.abs(deltaTotal) < 0.01) {
                            if (isRefundMode) {
                                const cartQtys = cart.map(i => `${i.line_id}:${i.qty}`).join('|');
                                const origQtys = originalSaleItems.map(i => `${i.line_id}:${i.qty}`).join('|');
                                if (cartQtys === origQtys) {
                                    await customAlert("No Changes Detected", "To process a refund, please reduce the quantity of the items you wish to return, or click 'Remove'.");
                                    return;
                                }
                            }
                            
                            const zeroMethod = isRefundMode ? "Exchange" : "Cash";
                            await saveTransactionToDatabase([{ method: zeroMethod, amount: 0 }], 0);
                        } else {
                            setSplitAmount(Math.abs(deltaTotal).toFixed(2));
                            setShowPayment(true);
                        }
                      }}
                      disabled={!canCheckout}
                      style={{ 
                        backgroundColor: !canCheckout ? '#1f2937' : (isRefundMode && deltaTotal < -0.01 ? '#C92C2C' : themeColor), 
                        color: !canCheckout ? '#4b5563' : 'white' 
                      }}
                      className="flex-[1] py-4 rounded-lg text-[20px] font-bold transition-all shadow-lg active:scale-95 disabled:active:scale-100 uppercase tracking-widest"
                  >
                    {isRefundMode ? (deltaTotal < -0.01 ? "REFUND" : "PROCESS") : "CHECKOUT"}
                  </button>
                  <div className="flex-[1] flex flex-col justify-end items-end">
                    <span className="text-[42px] font-bold text-white tracking-tight leading-none" style={{ color: isRefundMode && deltaTotal < -0.01 ? '#C92C2C' : 'white' }}>
                      {deltaTotal < 0 ? `-$${Math.abs(deltaTotal).toFixed(2)}` : `$${deltaTotal.toFixed(2)}`}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>

        </div>
      </div>

      {/* --- PARK CONFIRM MODAL OVERLAY --- */}
      {showParkModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[340px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-6 flex flex-col">
                <div className="flex justify-between w-full mb-4 items-center">
                  <h2 className="text-xl font-bold text-white">Park Sale</h2>
                  <button onClick={() => setShowParkModal(false)} className="text-gray-500 hover:text-[#C92C2C] font-bold text-lg">✕</button>
                </div>
                <p className="text-[15px] text-gray-300 mb-8">Do you want to park this sale?<br/>Current screen will be cleared.</p>
                <div className="flex justify-between w-full">
                  <button 
                    onClick={() => setShowParkModal(false)}
                    className="w-[120px] py-3 text-gray-400 border border-gray-600 rounded hover:bg-gray-800 transition-colors font-medium text-sm"
                  >
                    NO
                  </button>
                  <button 
                    onClick={confirmPark}
                    style={{ backgroundColor: themeColor }}
                    className="w-[120px] py-3 rounded text-white font-bold text-[15px] hover:brightness-110 transition-transform active:scale-95 shadow-md"
                  >
                    YES
                  </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* --- RECALL MODAL OVERLAY --- */}
      {showRecallModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[450px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-6 flex flex-col h-[500px]">
                <div className="flex justify-between w-full mb-4 items-center shrink-0">
                  <h2 className="text-2xl font-bold text-white">Recall Parked Sale</h2>
                  <button onClick={() => setShowRecallModal(false)} className="text-gray-500 hover:text-[#C92C2C] font-bold text-xl">✕</button>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {parkedSales.length === 0 ? (
                    <p className="text-gray-500 text-center mt-20">No parked sales.</p>
                  ) : (
                    parkedSales.map(sale => {
                      const cName = sale.customer_json ? JSON.parse(sale.customer_json).first_name + " " + JSON.parse(sale.customer_json).last_name : "Guest";
                      const itemCount = sale.cart_json ? JSON.parse(sale.cart_json).length : 0;
                      const parsedTotal = sale.meta_json ? JSON.parse(sale.meta_json).total_val : 0;
                      const safeTotalVal = parseFloat(parsedTotal) || 0;
                      
                      let timeStr = "Unknown Time";
                      if (sale.timestamp) {
                        try {
                          const localTz = getStoreTimezone(storeProvince, storeId === "ALL_STORES");
                          const d = new Date(sale.timestamp); // Parses the strict UTC string
                          timeStr = d.toLocaleString('en-US', { 
                             timeZone: localTz, 
                             month: 'short', 
                             day: 'numeric', 
                             hour: '2-digit', 
                             minute: '2-digit' 
                          });
                        } catch(e) { 
                          timeStr = sale.timestamp; 
                        }
                      }

                      return (
                        <div 
                          key={sale.id}
                          onClick={() => restoreParkedSale(sale)}
                          className="bg-[#2a2a2a] p-4 rounded-lg border border-gray-700 cursor-pointer hover:border-gray-500 transition-colors"
                        >
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-gray-400 text-sm">{timeStr}</span>
                            <span className="font-bold text-white text-lg">{cName}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400 text-sm">{itemCount} Items</span>
                            <span style={{ color: themeColor }} className="font-bold text-lg">${safeTotalVal.toFixed(2)}</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
             </div>
          </div>
        </div>
      )}

      {/* --- DISCOUNT MODAL OVERLAY --- */}
      {showDiscountModal.active && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[340px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-6 flex flex-col items-center">
                
                <div className="flex justify-between w-full mb-6 items-center">
                  <h2 className="text-xl font-bold text-white">Apply Discount</h2>
                  <button onClick={() => setShowDiscountModal({ active: false, type: 'manual' })} className="text-gray-500 hover:text-[#C92C2C] font-bold text-lg">✕</button>
                </div>

                <div className="flex bg-[#252525] rounded mb-6 w-[180px]">
                  <button 
                    onClick={() => setDiscountInputType("%")}
                    className={`flex-1 py-2 font-bold text-lg rounded transition-colors ${discountInputType === "%" ? 'bg-[#3B8ED0] text-white' : 'text-gray-400'}`}
                  >
                    %
                  </button>
                  <button 
                    onClick={() => setDiscountInputType("$")}
                    className={`flex-1 py-2 font-bold text-lg rounded transition-colors ${discountInputType === "$" ? 'bg-[#3B8ED0] text-white' : 'text-gray-400'}`}
                  >
                    $
                  </button>
                </div>

                <input 
                  type="number"
                  placeholder="0.00"
                  value={discountInputVal}
                  onChange={(e) => setDiscountInputVal(e.target.value)}
                  style={{ "--focus-color": themeColor } as React.CSSProperties}
                  className="w-[220px] bg-[#141414] border border-gray-600 text-3xl font-bold text-center py-4 rounded mb-8 outline-none focus:[border-color:var(--focus-color)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />

                <button 
                  onClick={applyDiscount}
                  style={{ backgroundColor: themeColor }}
                  className="w-[220px] py-4 font-bold text-[15px] text-white rounded transition-transform active:scale-95 uppercase tracking-wider"
                >
                  Apply Discount
                </button>

             </div>
          </div>
        </div>
      )}

      {/* --- CUSTOMER CREATION/EDIT MODAL OVERLAY --- */}
      {showCustomerModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[550px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-6 flex flex-col">
                
                <div className="flex justify-between w-full mb-6 items-center">
                  <h2 className="text-xl font-bold text-white">{editingCustomerId ? "Edit Customer" : "New Customer"}</h2>
                  <button onClick={() => setShowCustomerModal(false)} className="text-gray-500 hover:text-[#C92C2C] font-bold text-lg">✕</button>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">First Name</label>
                      <input type="text" value={custForm.first} onChange={e => setCustForm({...custForm, first: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Last Name</label>
                      <input type="text" value={custForm.last} onChange={e => setCustForm({...custForm, last: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Phone</label>
                      <input type="text" value={custForm.phone} onChange={e => setCustForm({...custForm, phone: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Email</label>
                      <input type="text" value={custForm.email} onChange={e => setCustForm({...custForm, email: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Birthday (Optional)</label>
                    <div className="flex gap-2">
                      <select value={custForm.dobM} onChange={e => setCustForm({...custForm, dobM: e.target.value})} className="w-20 bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none">
                        <option>MM</option><option>01</option><option>02</option><option>03</option><option>04</option><option>05</option><option>06</option><option>07</option><option>08</option><option>09</option><option>10</option><option>11</option><option>12</option>
                      </select>
                      <input type="text" placeholder="DD" value={custForm.dobD} onChange={e => setCustForm({...custForm, dobD: e.target.value})} className="w-16 bg-[#222222] border border-gray-700 rounded p-2 text-white text-center outline-none focus:border-gray-500" />
                      <input type="text" placeholder="YYYY" value={custForm.dobY} onChange={e => setCustForm({...custForm, dobY: e.target.value})} className="w-20 bg-[#222222] border border-gray-700 rounded p-2 text-white text-center outline-none focus:border-gray-500" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Street Address</label>
                    <input type="text" value={custForm.street} onChange={e => setCustForm({...custForm, street: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-[2]">
                      <label className="text-xs text-gray-400 mb-1 block">City</label>
                      <input type="text" value={custForm.city} onChange={e => setCustForm({...custForm, city: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                    <div className="flex-[1]">
                      <label className="text-xs text-gray-400 mb-1 block">Prov</label>
                      <select value={custForm.prov} onChange={e => setCustForm({...custForm, prov: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none">
                        <option>ON</option><option>BC</option><option>AB</option><option>MB</option><option>NB</option><option>NL</option><option>NS</option><option>NT</option><option>NU</option><option>PE</option><option>QC</option><option>SK</option><option>YT</option>
                      </select>
                    </div>
                    <div className="flex-[1.5]">
                      <label className="text-xs text-gray-400 mb-1 block">Postal Code</label>
                      <input type="text" value={custForm.postal} onChange={e => setCustForm({...custForm, postal: e.target.value})} className="w-full bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Internal Notes</label>
                    <textarea value={custForm.notes} onChange={e => setCustForm({...custForm, notes: e.target.value})} className="w-full h-20 resize-none bg-[#222222] border border-gray-700 rounded p-2 text-white outline-none focus:border-gray-500" />
                  </div>
                </div>

                <div className="flex justify-between mt-8">
                  <button 
                    onClick={() => setShowCustomerModal(false)}
                    className="w-[120px] py-3 text-gray-400 border border-gray-600 rounded hover:bg-gray-800 transition-colors font-medium text-sm"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={saveCustomer}
                    style={{ backgroundColor: themeColor }}
                    className="w-[200px] py-3 rounded text-white font-bold text-[15px] hover:brightness-110 transition-transform active:scale-95 shadow-md"
                  >
                    {editingCustomerId ? "UPDATE CUSTOMER" : "SAVE CUSTOMER"}
                  </button>
                </div>

             </div>
          </div>
        </div>
      )}

      {/* --- PAYMENT MODAL --- */}
      {showPayment && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1e1e1e] p-8 rounded-xl w-full max-w-md border border-gray-700 shadow-2xl">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-bold">Checkout</h2>
              <button onClick={() => setShowPayment(false)} className="text-gray-500 hover:text-[#C92C2C] font-bold text-xl transition-colors">✕</button>
            </div>
            
            <div className="text-center mb-8">
              <p className="text-gray-400 font-medium">Total Remaining</p>
              <p style={{ color: isRefundMode && (totals.total - originalSaleTotal) < 0 ? '#C92C2C' : themeColor }} className="text-[54px] font-bold mt-1 tracking-tight">
                ${Math.abs((isRefundMode ? totals.total - originalSaleTotal : totals.total) - paymentQueue.reduce((a, b) => a + b.amount, 0)).toFixed(2)}
              </p>
              <p className="text-gray-300 mt-1 text-sm">
                Customer: {customer ? `${customer.first_name} ${customer.last_name}` : 'Guest'}
              </p>
            </div>

            <div className="border-t border-gray-700 pt-6 mb-6">
              <label className="text-sm text-gray-400 font-bold uppercase tracking-wider block mb-2">Payment Amount (Split)</label>
              <input 
                type="number" 
                value={splitAmount}
                onChange={(e) => setSplitAmount(e.target.value)}
                style={{ "--focus-color": themeColor } as React.CSSProperties}
                className="w-full bg-[#141414] border border-gray-600 text-[42px] font-bold tracking-tight text-center p-4 rounded-lg outline-none focus:[border-color:var(--focus-color)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-white"
              />
            </div>

            <div className="mb-6">
              <label className="text-sm text-gray-400 font-bold uppercase tracking-wider block mb-3">Select Payment Method</label>
              <div className="grid grid-cols-3 gap-3">
                {paymentMethods.filter(m => m.toLowerCase() !== 'cash').map(method => (
                  <button 
                    key={method}
                    onClick={() => processPayment(method)}
                    className="bg-[#3B8ED0] hover:bg-[#3071A9] text-white py-3 rounded-lg font-bold text-[14px] transition-transform shadow-md active:scale-95"
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-700 pt-6">
              <button 
                onClick={() => processPayment("Cash")}
                style={{ backgroundColor: isRefundMode && (totals.total - originalSaleTotal) < 0 ? '#C92C2C' : '#00A023' }}
                className="w-full text-white py-4 rounded-lg font-bold text-lg transition-transform shadow-lg active:scale-95 uppercase tracking-widest hover:brightness-110"
              >
                {isRefundMode && (totals.total - originalSaleTotal) < 0 ? 'REFUND CASH' : 'PROCESS CASH'}
              </button>
            </div>

          </div>
        </div>
      )}
      {/* --- DAILY SUMMARY MODAL OVERLAY --- */}
      {showDailySummary && summaryData && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[450px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-6 flex flex-col h-[600px]">
                
                <div className="flex justify-between w-full mb-6 items-center shrink-0">
                  <h2 className="text-2xl font-bold text-white">Daily Summary</h2>
                  <button onClick={() => setShowDailySummary(false)} className="text-gray-500 hover:text-[#C92C2C] font-bold text-xl transition-colors">✕</button>
                </div>

                <div className="flex flex-col items-center justify-center mb-8">
                  <p className="text-gray-400 font-medium text-sm">Total Sales (All Methods)</p>
                  <p style={{ color: themeColor }} className="text-[54px] font-bold mt-1 tracking-tight">
                    ${summaryData.totalSales.toFixed(2)}
                  </p>
                  <p className="text-gray-400 mt-3 text-sm font-medium">
                    Opening Balance (Cash): <span className="text-gray-200">${summaryData.openingBalance.toFixed(2)}</span>
                  </p>
                </div>

                <div className="border-t border-gray-700 pt-6 flex-1 overflow-hidden flex flex-col">
                  <h3 className="text-[13px] font-bold text-gray-300 uppercase tracking-wider mb-4 px-2">Sales by User</h3>
                  
                  <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-hide">
                    {Object.keys(summaryData.userBreakdown).length === 0 ? (
                      <p className="text-gray-500 text-center italic mt-4">No sales records found for today.</p>
                    ) : (
                      Object.entries(summaryData.userBreakdown)
                        .sort(([, a], [, b]) => b - a)
                        .map(([userName, amount]) => (
                          <div key={userName} className="flex justify-between items-center bg-[#252525] p-4 rounded-lg border border-transparent hover:border-gray-700 transition-colors">
                            <span className="font-bold text-gray-200 text-[15px]">{userName}</span>
                            <span className="font-bold text-white text-[16px]">${amount.toFixed(2)}</span>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 shrink-0">
                  <button 
                    onClick={() => setShowDailySummary(false)}
                    style={{ backgroundColor: themeColor }}
                    className="w-full py-4 rounded-lg text-white font-bold text-lg transition-transform active:scale-95 shadow-lg tracking-widest uppercase"
                  >
                    CLOSE
                  </button>
                </div>

             </div>
          </div>
        </div>
      )}

      {/* --- SUCCESS MODAL OVERLAY --- */}
      {successData?.active && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1a1a] p-1 rounded-xl w-[400px] border border-gray-600 shadow-2xl">
             <div className="bg-[#1a1a1a] rounded-lg p-8 flex flex-col items-center">
                
                <div style={{ color: successData.changeDue === 0 && successData.total < 0 ? '#C92C2C' : themeColor }} className="text-[80px] leading-none mb-2 font-bold">
                  ✔
                </div>
                <h2 className="text-2xl font-bold text-white mb-6">Transaction Completed</h2>

                {/* Show Change Due if Cash was overpaid */}
                {successData.changeDue > 0 && (
                   <div className="text-center mb-6">
                     <p className="text-gray-400 font-medium">Change Due</p>
                     <p className="text-[42px] font-bold text-white leading-tight">${successData.changeDue.toFixed(2)}</p>
                   </div>
                )}

                {/* Show Refund Processed amount if the total was negative */}
                {successData.changeDue === 0 && successData.total < 0 && (
                   <div className="text-center mb-6">
                     <p className="text-gray-400 font-medium">Refund Processed</p>
                     <p className="text-[42px] font-bold text-white leading-tight">${Math.abs(successData.total).toFixed(2)}</p>
                   </div>
                )}

                <button 
                  onClick={() => setSuccessData(null)}
                  style={{ backgroundColor: themeColor }}
                  className="w-full py-4 rounded font-bold text-[16px] text-white transition-transform active:scale-95 tracking-wider uppercase mb-3 shadow-lg"
                >
                  COMPLETE
                </button>
                
                <button 
                  onClick={() => {
                      printWebReceipt((successData as any).receiptData, rawConfig);
                  }}
                  style={{ borderColor: themeColor, color: themeColor }}
                  className="w-full py-4 rounded font-bold text-[14px] bg-transparent border-2 transition-transform active:scale-95 tracking-wider uppercase hover:bg-[#2a2a2a]"
                >
                  PRINT RECEIPT
                </button>

             </div>
          </div>
        </div>
      )}

      {/* --- GLOBAL CUSTOM DIALOG (Alerts & Prompts) --- */}
      {appDialog.show && (
        <div className="absolute inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div 
            className="bg-[#1a1a1a] rounded-xl shadow-2xl border border-gray-700 w-full max-w-md overflow-hidden flex flex-col transform transition-all scale-100 opacity-100"
          >
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-2">{appDialog.title}</h2>
              <p className="text-gray-300 text-[15px] leading-relaxed mb-6">
                {appDialog.message}
              </p>
              
              {appDialog.type === 'prompt' && (
                <input 
                  type="text"
                  autoFocus
                  value={appDialog.inputValue}
                  onChange={(e) => setAppDialog({ ...appDialog, inputValue: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleDialogClose(false); }}
                  style={{ "--focus-color": themeColor } as React.CSSProperties}
                  className="w-full bg-[#141414] border border-gray-600 rounded p-3 text-white text-[15px] outline-none focus:[border-color:var(--focus-color)] transition-colors mb-2"
                />
              )}
            </div>
            
            <div className="flex border-t border-gray-800 bg-[#222222]">
              {appDialog.type === 'prompt' && (
                <button 
                  onClick={() => handleDialogClose(true)}
                  className="flex-1 py-4 text-gray-400 font-bold hover:bg-[#2a2a2a] hover:text-white transition-colors uppercase tracking-wider text-[13px]"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={() => handleDialogClose(false)}
                style={{ color: themeColor }}
                className="flex-1 py-4 font-bold hover:bg-[#2a2a2a] transition-colors uppercase tracking-wider text-[13px] border-l border-gray-800"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}