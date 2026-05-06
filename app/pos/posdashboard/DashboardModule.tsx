"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../utils/supabase";

interface DashboardProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  user: any;
}

// ============================================================================
// NATIVE CHART COMPONENTS
// ============================================================================

const StatCard = ({ title, value, subtitle, icon, themeColor }: any) => (
  <div className="bg-[#1e1e1e] border border-gray-800 rounded-xl p-5 flex items-center gap-4 shadow-md flex-1">
    <div className="text-[32px]">{icon}</div>
    <div className="flex flex-col">
      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{title}</span>
      <span style={{ color: themeColor }} className="text-[26px] font-black leading-tight tracking-tight">{value}</span>
      {subtitle && <span className="text-[11px] text-gray-400 mt-0.5">{subtitle}</span>}
    </div>
  </div>
);

const NativeHorizontalBar = ({ title, dataDict, themeColor }: any) => {
  const maxVal = Math.max(...Object.values(dataDict as Record<string, number>), 1);
  const sorted = Object.entries(dataDict as Record<string, number>).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 h-[280px] flex flex-col shadow-lg">
      <h3 className="text-gray-400 font-bold text-[14px] uppercase tracking-wider mb-4">{title}</h3>
      <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
        {sorted.length === 0 ? (
          <p className="text-gray-600 text-center italic mt-10">No items sold.</p>
        ) : (
          sorted.map(([key, val]) => (
            <div key={key} className="flex flex-col">
              <div className="flex justify-between items-center mb-1">
                <span className="text-white font-bold text-[13px] truncate pr-2">{key}</span>
                <span className="text-gray-400 font-bold text-[13px]">${val.toFixed(2)}</span>
              </div>
              <div className="w-full bg-[#2a2a2a] h-2 rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full" 
                  style={{ width: `${Math.max((val / maxVal) * 100, 2)}%`, backgroundColor: themeColor }} 
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const NativeLineChart = ({ title, dataDict, themeColor }: any) => {
  const entries = Object.entries(dataDict as Record<string, number>);
  const maxVal = Math.max(...entries.map(e => e[1]), 1);
  const values = entries.map(e => e[1]);
  const labels = entries.map(e => e[0]);

  // Generate SVG path for a smooth look (simplified straight lines for speed)
  const points = values.map((val, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * 100;
    const y = 100 - (val / maxVal) * 100;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 h-[280px] flex flex-col shadow-lg">
      <h3 className="text-gray-400 font-bold text-[14px] uppercase tracking-wider mb-4">{title}</h3>
      <div className="flex-1 relative flex items-end">
        {/* Y-Axis Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between text-gray-600 text-[10px] pointer-events-none">
          {[1, 0.66, 0.33, 0].map(multiplier => (
            <div key={multiplier} className="w-full border-b border-gray-800/50 relative">
              <span className="absolute -top-2 bg-[#1a1a1a] pr-2">${(maxVal * multiplier).toFixed(0)}</span>
            </div>
          ))}
        </div>
        {/* Line SVG */}
        <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
          <polyline points={points} fill="none" stroke={themeColor} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((val, i) => {
             if (val === 0) return null;
             const x = (i / Math.max(values.length - 1, 1)) * 100;
             const y = 100 - (val / maxVal) * 100;
             return <circle key={i} cx={x} cy={y} r="1" fill={themeColor} vectorEffect="non-scaling-stroke" />
          })}
        </svg>
      </div>
      {/* X-Axis Labels */}
      <div className="flex justify-between mt-3 text-gray-500 text-[10px] font-bold">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
};

const NativeBarChart = ({ title, dataDict, themeColor, height = "280px" }: any) => {
  const entries = Object.entries(dataDict as Record<string, number>);
  const maxVal = Math.max(...entries.map(e => e[1]), 1);

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 flex flex-col shadow-lg" style={{ height }}>
      <h3 className="text-gray-400 font-bold text-[14px] uppercase tracking-wider mb-4">{title}</h3>
      <div className="flex-1 flex items-end gap-1 sm:gap-2 pt-4 border-b border-gray-800">
        {entries.map(([label, val]) => (
          <div key={label} className="flex-1 flex flex-col items-center justify-end h-full">
            {val > 0 && (
              <span className="text-white text-[13px] font-bold mb-1 text-center w-full truncate">
                {val >= 10 ? `$${Math.round(val)}` : `$${val.toFixed(1)}`}
              </span>
            )}
            <div 
              className="w-full rounded-t-sm transition-all duration-500 ease-out min-h-[4px]"
              style={{ height: `${Math.max((val / maxVal) * 100, 1)}%`, backgroundColor: val > 0 ? themeColor : '#252525' }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-gray-500 text-[11px] font-bold overflow-hidden">
         {entries.map(([label], i) => {
            // Decimate labels if too many to prevent crowding
            if (entries.length > 7 && i % Math.ceil(entries.length / 7) !== 0 && i !== entries.length - 1) return <span key={i} className="flex-1"></span>;
            return <span key={i} className="flex-1 text-center truncate">{label.substring(0, 5)}</span>
         })}
      </div>
    </div>
  );
};

const NativeDonutChart = ({ title, dataDict }: any) => {
  const colors = ["#00A023", "#3B8ED0", "#E67E22", "#9B59B6", "#F1C40F", "#E74C3C", "#1ABC9C", "#34495E", "#D35400", "#7F8C8D"];
  const sorted = Object.entries(dataDict as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, val]) => sum + val, 0);

  // Generate Conic Gradient String
  let cumulative = 0;
  const gradientStops = sorted.map(([key, val], i) => {
    const pct = (val / Math.max(total, 1)) * 100;
    const start = cumulative;
    const end = cumulative + pct;
    cumulative += pct;
    return `${colors[i % colors.length]} ${start}% ${end}%`;
  }).join(", ");

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 h-[280px] flex flex-col shadow-lg">
      <h3 className="text-gray-400 font-bold text-[14px] uppercase tracking-wider mb-2">{title}</h3>
      {total === 0 ? (
        <p className="text-gray-600 text-center italic m-auto">No data available.</p>
      ) : (
        <div className="flex flex-1 items-center">
          {/* Donut Visual */}
          <div className="flex-[0.8] flex justify-center items-center">
            <div 
              className="w-28 h-28 rounded-full flex items-center justify-center relative"
              style={{ background: `conic-gradient(${gradientStops})` }}
            >
              <div className="w-16 h-16 bg-[#1a1a1a] rounded-full absolute" />
            </div>
          </div>
          {/* Legend */}
          <div className="flex-[1.2] overflow-y-auto max-h-[180px] space-y-2 scrollbar-hide pr-1">
            {sorted.map(([key, val], i) => (
              <div key={key} className="flex items-center justify-between text-[11px] font-bold">
                <div className="flex items-center gap-2 truncate pr-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                  <span className="text-white truncate">{key.length > 14 ? key.substring(0, 12) + ".." : key}</span>
                </div>
                <span className="text-gray-400 shrink-0">{((val / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================


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


export default function DashboardModule({ companyId, storeId, themeColor, user }: DashboardProps) {
  const isAdmin = user?.is_admin || user?.is_owner;
  
  // Date State
  const now = new Date();
  const currentYear = now.getFullYear();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState(months[now.getMonth()]);
  const [selectedDay, setSelectedDay] = useState("All");
  
  const [daysInMonth, setDaysInMonth] = useState<string[]>(["All"]);

  // Filter State
  const [stores, setStores] = useState<Record<string, string>>({});
  const [storeProvinces, setStoreProvinces] = useState<Record<string, string>>({}); // <--- NEW
  const [companyProvince, setCompanyProvince] = useState("ON"); // <--- NEW
  const [users, setUsers] = useState<Record<string, string>>({});
  const [selectedStore, setSelectedStore] = useState(isAdmin && storeId !== "ALL_STORES" ? storeId : "All Stores");
  const [selectedUser, setSelectedUser] = useState("All Users");

  // Data State
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptTips, setAcceptTips] = useState(false);

  // 1. Initial Load (Admin Mappings & Settings)
  useEffect(() => {
    const fetchMappingsAndSettings = async () => {
      try {
        const { data: compData } = await supabase.from('companies').select('config_json, province').eq('id', companyId).single();
        if (compData) {
          setCompanyProvince(compData.province || "ON");
          if (compData.config_json) {
            const config = typeof compData.config_json === 'string' ? JSON.parse(compData.config_json) : compData.config_json;
            setAcceptTips(config.accept_tips ?? false);
          }
        }
      } catch (e) {
        console.error("Failed to fetch company settings", e);
      }

      if (!isAdmin) return;
      
      try {
        const { data: storeData } = await supabase.from('stores').select('id, name, province').eq('company_id', companyId);
        const sMap: Record<string, string> = {};
        const pMap: Record<string, string> = {};
        storeData?.forEach(s => {
            sMap[s.id] = s.name;
            pMap[s.id] = s.province || "ON";
        });
        setStores(sMap);
        setStoreProvinces(pMap);

        const { data: empData } = await supabase.from('employees').select('user_id, first_name, last_name').eq('company_id', companyId);
        const uMap: Record<string, string> = {};
        empData?.forEach(e => uMap[e.user_id] = `${e.first_name} ${e.last_name}`);
        setUsers(uMap);
      } catch (e) {
        console.error(e);
      }
    };
    fetchMappingsAndSettings();
  }, [companyId, isAdmin]);

  // 2. Update Days Dropdown when Year/Month changes
  useEffect(() => {
    const monthIndex = months.indexOf(selectedMonth) + 1;
    const daysCount = new Date(parseInt(selectedYear), monthIndex, 0).getDate();
    const dArray = ["All"];
    for (let i = 1; i <= daysCount; i++) {
      dArray.push(i.toString().padStart(2, '0'));
    }
    setDaysInMonth(dArray);
    if (selectedDay !== "All" && parseInt(selectedDay) > daysCount) {
      setSelectedDay("All");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth]);

  // 3. Fetch and Crunch Data
  useEffect(() => {
    const loadDashboardData = async () => {
      setIsLoading(true);
      try {
        const isSingleDay = selectedDay !== "All";
        const mIndex = months.indexOf(selectedMonth) + 1;
        const targetUser = isAdmin ? (selectedUser === "All Users" ? null : Object.keys(users).find(k => users[k] === selectedUser)) : user?.id;
        const targetStore = isAdmin ? (selectedStore === "All Stores" ? null : (stores[selectedStore] ? selectedStore : Object.keys(stores).find(k => stores[k] === selectedStore))) : (storeId === "ALL_STORES" ? null : storeId);

        // --- THE FIX: PADDED UTC WINDOW QUERY ---
        // Fetch the entire month +/- 5 days to absolutely guarantee we catch all timezone offsets
        const padStart = new Date(Date.UTC(parseInt(selectedYear), mIndex - 1, 1));
        padStart.setUTCDate(padStart.getUTCDate() - 5);
        const startUtcStr = padStart.toISOString();

        const padEnd = new Date(Date.UTC(parseInt(selectedYear), mIndex, 0));
        padEnd.setUTCDate(padEnd.getUTCDate() + 5);
        const endUtcStr = padEnd.toISOString();

        let salesQ = supabase.from('sales')
          .select('id, date, total')
          .eq('company_id', companyId)
          .gte('date', startUtcStr)
          .lte('date', endUtcStr)
          .neq('is_deleted', true);
          
        if (targetUser) salesQ = salesQ.eq('user_id', targetUser);
        if (targetStore) salesQ = salesQ.eq('store_id', targetStore);
        const { data: rawSales } = await salesQ;

        let tipsQ = supabase.from('tips_ledger')
          .select('sale_id, amount, date')
          .eq('company_id', companyId)
          .gte('date', startUtcStr)
          .lte('date', endUtcStr)
          .neq('is_deleted', true);
          
        if (targetUser) tipsQ = tipsQ.eq('user_id', targetUser);
        if (targetStore) tipsQ = tipsQ.eq('store_id', targetStore);
        const { data: rawTips } = await tipsQ;

        // Determine Local Timezone for Projection
        const targetProv = targetStore ? (storeProvinces[targetStore] || companyProvince) : companyProvince;
        const localTz = getStoreTimezone(targetProv, !targetStore);

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: localTz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hour12: false, weekday: 'short'
        });

        // Map Tips
        const tipsMap: Record<string, number> = {};
        let totalTips = 0;
        rawTips?.forEach(t => {
          if (!t.date) return;
          const parts = formatter.formatToParts(new Date(t.date));
          const pMap: Record<string, string> = {};
          parts.forEach(p => pMap[p.type] = p.value);
          
          if (pMap['year'] !== selectedYear || parseInt(pMap['month']) !== mIndex) return;
          if (isSingleDay && pMap['day'] !== selectedDay.padStart(2, '0')) return;

          const amt = parseFloat(t.amount || 0);
          tipsMap[t.sale_id] = (tipsMap[t.sale_id] || 0) + amt;
          totalTips += amt;
        });

        // Initialize Dictionaries
        const hourly_chart: Record<string, number> = {};
        for (let h = 0; h < 24; h++) {
          const ampm = h < 12 ? "AM" : "PM";
          let disp = h <= 12 ? h : h - 12;
          if (disp === 0) disp = 12;
          hourly_chart[`${disp}${ampm}`] = 0;
        }

        const dow_chart = { "Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0, "Fri": 0, "Sat": 0, "Sun": 0 };
        const daily_trend: Record<string, number> = {};
        let totalSalesVal = 0;
        const uniqueDays = new Set();
        const uniqueHours = new Set();
        const saleIds: string[] = [];
        const allTotals: number[] = [];

        rawSales?.forEach(s => {
           if (!s.date) return;

           // PROJECT TO LOCAL TIME
           const parts = formatter.formatToParts(new Date(s.date));
           const pMap: Record<string, string> = {};
           parts.forEach(p => pMap[p.type] = p.value);

           const projYear = pMap['year'];
           const projMonth = pMap['month'];
           const projDay = pMap['day'];
           const projHour = parseInt(pMap['hour']);
           const dowStr = pMap['weekday'];

           // APPLY STRICT FILTER IN MEMORY
           if (projYear !== selectedYear || parseInt(projMonth) !== mIndex) return;
           if (isSingleDay && projDay !== selectedDay.padStart(2, '0')) return;

           // Add to buckets
           saleIds.push(s.id);
           const val = parseFloat(s.total || 0) - (tipsMap[s.id] || 0);
           totalSalesVal += val;
           allTotals.push(val);

           const dayKey = `${projYear}-${projMonth}-${projDay}`;
           uniqueDays.add(dayKey);
           uniqueHours.add(`${dayKey} ${projHour}`);

           const ampm = projHour < 12 ? "AM" : "PM";
           let disp = projHour <= 12 ? projHour : projHour - 12;
           if (disp === 0) disp = 12;
           hourly_chart[`${disp}${ampm}`] += val;

           daily_trend[dayKey] = (daily_trend[dayKey] || 0) + val;

           if (dow_chart[dowStr as keyof typeof dow_chart] !== undefined) {
              dow_chart[dowStr as keyof typeof dow_chart] += val;
           }
        });

        // Pre-fill daily trend for whole month if viewing "All" days
        if (!isSingleDay) {
          const y = parseInt(selectedYear);
          const dCount = new Date(y, mIndex, 0).getDate();
          const nowCompare = new Date().toLocaleDateString('en-CA', { timeZone: localTz });

          for (let i = 1; i <= dCount; i++) {
            const dStr = `${y}-${mIndex.toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            if (dStr > nowCompare) break;
            if (!daily_trend[dStr]) daily_trend[dStr] = 0;
          }
        }

        // Fetch Items and Payments
        const top_products: Record<string, number> = {};
        const category_sales: Record<string, number> = {};
        const payment_methods: Record<string, number> = {};

        if (saleIds.length > 0) {
            const { data: itemData } = await supabase.from('sale_items').select('name, price, qty, sku').in('sale_id', saleIds);
            itemData?.forEach(item => {
               const qty = parseFloat(item.qty || 0);
               const val = parseFloat(item.price || 0) * (qty !== 0 ? qty : 1);
               if (item.name === "Tips" || item.sku === "SYS_TIP" || val <= 0) return;
               
               top_products[item.name] = (top_products[item.name] || 0) + val;
               category_sales["Standard"] = (category_sales["Standard"] || 0) + val;
            });

            const { data: payData } = await supabase.from('sale_payments').select('method, amount').in('sale_id', saleIds);
            payData?.forEach(p => {
               const amt = parseFloat(p.amount || 0);
               if (amt > 0) payment_methods[p.method] = (payment_methods[p.method] || 0) + amt;
            });
        }

        // Sort Top 5 Products
        const sortedProducts = Object.fromEntries(
           Object.entries(top_products).sort(([,a], [,b]) => b - a).slice(0, 5)
        );

        // Sort Daily Trend
        const sortedDailyTrend = Object.keys(daily_trend).sort().reduce(
          (obj, key) => { 
            obj[key.substring(5)] = daily_trend[key]; // Just store MM-DD for the label
            return obj;
          }, 
          {} as Record<string, number>
        );

        // Simple Median
        allTotals.sort((a,b) => a - b);
        const median = allTotals.length === 0 ? 0 : allTotals.length % 2 !== 0 ? allTotals[Math.floor(allTotals.length / 2)] : (allTotals[allTotals.length / 2 - 1] + allTotals[allTotals.length / 2]) / 2;

        // Calculate Standard Deviation (Volatility)
        let std_dev = 0;
        if (allTotals.length > 1) {
          const mean = allTotals.reduce((a, b) => a + b, 0) / allTotals.length;
          const variance = allTotals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (allTotals.length - 1);
          std_dev = Math.sqrt(variance);
        }

        setStats({
          total_sales: totalSalesVal,
          total_tips: totalTips,
          transaction_count: rawSales?.length || 0,
          avg_per_day: uniqueDays.size ? totalSalesVal / uniqueDays.size : 0,
          median_val: median,
          std_dev: std_dev,
          hourly_chart,
          dow_chart,
          daily_trend: sortedDailyTrend,
          top_products: sortedProducts,
          category_sales,
          payment_methods,
          is_single_day: isSingleDay
        });
      } catch (e) {
        console.error("Dashboard error:", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedYear, selectedMonth, selectedDay, selectedStore, selectedUser]);

  return (
    <div className="flex-1 h-full flex flex-col bg-[#141414] overflow-y-auto scrollbar-hide">
      
      {/* Header Controls */}
      <div className="bg-[#1a1a1a] border-b border-gray-800 p-6 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-[26px] font-bold text-white tracking-wide">
             {isAdmin ? "Dashboard" : "My Performance"}
          </h1>
          
          {isAdmin && (
            <div className="flex items-center gap-3">
               <select 
                 value={selectedStore} 
                 onChange={(e) => setSelectedStore(e.target.value)}
                 className="bg-[#222222] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-gray-500"
               >
                 <option>All Stores</option>
                 {Object.values(stores).map(s => <option key={s}>{s}</option>)}
               </select>

               <select 
                 value={selectedUser} 
                 onChange={(e) => setSelectedUser(e.target.value)}
                 className="bg-[#222222] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-gray-500"
               >
                 <option>All Users</option>
                 {Object.values(users).map(u => <option key={u}>{u}</option>)}
               </select>
            </div>
          )}
        </div>

        {/* Date Filters */}
        <div className="flex items-center gap-3 bg-[#222222] p-2 px-3 rounded-xl border border-gray-800">
           <span className="text-gray-500 text-sm font-bold ml-1">FILTER:</span>
           <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="bg-transparent text-white text-sm font-bold outline-none cursor-pointer">
              {[currentYear, currentYear-1, currentYear-2].map(y => <option key={y} value={y} className="bg-[#222222]">{y}</option>)}
           </select>
           <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent text-white text-sm font-bold outline-none cursor-pointer">
              {months.map(m => <option key={m} value={m} className="bg-[#222222]">{m}</option>)}
           </select>
           <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="bg-transparent text-white text-sm font-bold outline-none cursor-pointer">
              {daysInMonth.map(d => <option key={d} value={d} className="bg-[#222222]">{d}</option>)}
           </select>
        </div>
      </div>

      {isLoading || !stats ? (
         <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-gray-400 font-bold text-xl mb-4 animate-pulse">Calculating Metrics...</p>
         </div>
      ) : (
         <div className="p-6 max-w-[1600px] w-full mx-auto space-y-6">
            
            {/* ROW 1: Stat Cards */}
            <div className={`grid grid-cols-1 md:grid-cols-2 ${(acceptTips || stats.total_tips > 0) ? 'xl:grid-cols-5' : 'xl:grid-cols-4'} gap-4`}>
               <StatCard title="Period Total" value={`$${stats.total_sales.toFixed(2)}`} subtitle={`${stats.transaction_count} Transactions`} icon="📈" themeColor={themeColor} />
               <StatCard title="Avg Transaction" value={stats.transaction_count ? `$${(stats.total_sales / stats.transaction_count).toFixed(2)}` : "$0.00"} subtitle={`Median: $${stats.median_val.toFixed(2)}`} icon="💳" themeColor="#3B8ED0" />
               <StatCard title="Average Per Day" value={`$${stats.avg_per_day.toFixed(2)}`} subtitle="Active days only" icon="📅" themeColor="#E67E22" />
               <StatCard title="Volatility" value={`$${stats.std_dev.toFixed(2)}`} subtitle="Variance between checkouts" icon="⚡" themeColor="#9B59B6" />
               {(acceptTips || stats.total_tips > 0) && (
                  <StatCard title="Period Tips" value={`$${stats.total_tips.toFixed(2)}`} subtitle="Earned Gratuities" icon="✨" themeColor="#F1C40F" />
               )}
            </div>

            {/* ROW 2: Trend & Products */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="lg:col-span-2">
                  {stats.is_single_day ? (
                     <NativeLineChart title="Hourly Trend" dataDict={stats.hourly_chart} themeColor={themeColor} />
                  ) : (
                     <NativeLineChart title="Daily Sales Trend" dataDict={stats.daily_trend} themeColor={themeColor} />
                  )}
               </div>
               <div className="lg:col-span-1">
                  <NativeHorizontalBar title="Top 5 Products" dataDict={stats.top_products} themeColor="#E67E22" />
               </div>
            </div>

            {/* ROW 3: Three Split Charts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <NativeBarChart title="Sales by Day of Week" dataDict={stats.dow_chart} themeColor="#3B8ED0" height="280px" />
               <NativeDonutChart title="Sales by Category" dataDict={stats.category_sales} />
               <NativeDonutChart title="Payment Breakdown" dataDict={stats.payment_methods} />
            </div>

            {/* ROW 4: 24-Hour Bar Chart */}
            <div className="w-full">
               <NativeBarChart title="Sales by Hour of Day" dataDict={stats.hourly_chart} themeColor={themeColor} height="320px" />
            </div>

         </div>
      )}
    </div>
  );
}