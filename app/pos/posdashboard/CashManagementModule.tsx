"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../utils/supabase";

// --- INTERFACES ---
interface CashManagementProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  user: any;
  setActiveModule?: (module: string) => void; // Added so the "Open Till Now" button works
}

interface CashDrop {
  id: string;
  date: string;
  timestamp: number | string;
  type: string;
  company_id: string;
  store_id: string;
  user: string;
  total: number;
  notes: string;
}

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

export default function CashManagementModule({ companyId, storeId, themeColor, user, setActiveModule }: CashManagementProps) {
  // --- STATE ---
  const [drops, setDrops] = useState<CashDrop[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Pagination & Filters
  const [page, setPage] = useState(1);
  const limit = 25;
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("All Types");
  const [filterUser, setFilterUser] = useState("All Users");
  const [filterDate, setFilterDate] = useState("");

  // Users Map (for dropdown)
  const [userMap, setUserMap] = useState<string[]>([]);
  const [storeProvMap, setStoreProvMap] = useState<Record<string, string>>({}); // Tracks provinces
  const [defaultProv, setDefaultProv] = useState("ON");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<CashDrop | null>(null);

  // Modal Inputs
  const [dropAmount, setDropAmount] = useState("");
  const [dropReason, setDropReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // --- NEW: Heartbeat & Store Status State ---
  const lastKnownCountRef = useRef<number | null>(null);
  const [isStoreOpen, setIsStoreOpen] = useState<boolean | null>(null);
  const isStoreOpenRef = useRef<boolean | null>(null);

  useEffect(() => { isStoreOpenRef.current = isStoreOpen; }, [isStoreOpen]);

  // --- LOCAL TIME FORMATTER ---
  const getLocalDisplayTime = (utcString: string, dropStoreId: string) => {
      if (!utcString) return "Unknown";
      try {
          const prov = storeProvMap[dropStoreId] || defaultProv || "ON";
          const localTz = getStoreTimezone(prov, storeId === "ALL_STORES");
          const d = new Date(utcString);
          return d.toLocaleString('en-US', {
              timeZone: localTz,
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
          });
      } catch (e) {
          return utcString;
      }
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    fetchLookups();
    checkStoreStatus();
  }, [companyId, storeId]);

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

      if (storeId && storeId !== "ALL_STORES") query = query.eq('store_id', storeId);
      else query = query.is('store_id', null);

      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) setIsStoreOpen(data[0].type === "Open");
      else setIsStoreOpen(false);
    } catch (err) {
      console.error("Failed to check store status", err);
      setIsStoreOpen(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchDrops(1);
  }, [companyId, storeId, filterType, filterUser, filterDate]); // Re-fetch on filter change

  useEffect(() => {
    if (page > 1) fetchDrops(page);
  }, [page]);

  // Delay search typing (debounce)
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setPage(1);
      fetchDrops(1);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);


  // ==========================================
  // --- NEW: THE 3-SECOND CLOUD HEARTBEAT ---
  // ==========================================
  useEffect(() => {
    if (!companyId) return;

    const pingCloudStatus = async () => {
      try {
        // 1. Check Store Lock Status
        let sessionQuery = supabase.from('cash_sessions').select('type').eq('company_id', companyId).in('type', ['Open', 'Close']).neq('is_deleted', true).order('timestamp', { ascending: false }).limit(1);
        if (storeId && storeId !== "ALL_STORES") sessionQuery = sessionQuery.eq('store_id', storeId);
        else sessionQuery = sessionQuery.is('store_id', null);

        const { data: sessionData } = await sessionQuery;
        if (sessionData && sessionData.length > 0) {
          const cloudIsOpen = sessionData[0].type === "Open";
          if (cloudIsOpen !== isStoreOpenRef.current) setIsStoreOpen(cloudIsOpen);
        }

        // 2. Check Session Count for live list updates
        let query = supabase
          .from("cash_sessions")
          .select("*", { count: "exact", head: true }) 
          .eq("company_id", companyId)
          .neq("is_deleted", true);

        if (storeId && storeId !== "ALL_STORES") {
          query = query.eq("store_id", storeId);
        }

        const { count, error } = await query;
        if (error) throw error;

        // Initialize on first run
        if (lastKnownCountRef.current === null) {
          lastKnownCountRef.current = count;
          return;
        }

        // If the count changes, silently refresh the list!
        if (count !== lastKnownCountRef.current) {
          console.log("Cash session count changed. Syncing list...");
          lastKnownCountRef.current = count;
          
          // Re-fetch the current page silently without triggering the global isLoading curtain
          fetchDrops(page, false); 
        }
      } catch (err) {
        // Silently fail if network drops temporarily
      }
    };

    const intervalId = setInterval(pingCloudStatus, 3000);
    return () => clearInterval(intervalId);
  }, [companyId, storeId, page, filterType, filterUser, filterDate, searchQuery]);
  // ==========================================
  
  // --- DATA FETCHING ---
  const fetchLookups = async () => {
    if (!companyId) return;
    try {
      // 1. Fetch default province
      const { data: compData } = await supabase.from('companies').select('province').eq('id', companyId).maybeSingle();
      if (compData && compData.province) setDefaultProv(compData.province);

      // 2. Fetch stores for province mapping
      const { data: stores } = await supabase.from("stores").select("id, province").eq("company_id", companyId);
      const pMap: Record<string, string> = {}; 
      stores?.forEach((s) => {
          if (s.province) pMap[s.id] = s.province;
      });
      setStoreProvMap(pMap);

      // 3. Fetch users
      const { data: users } = await supabase.from("users").select("username").eq("company_id", companyId);
      if (users) {
        const uniqueUsers = Array.from(new Set(users.map(u => u.username).filter(Boolean))).sort();
        setUserMap(uniqueUsers);
      }
    } catch (err) {
      console.error("Error fetching lookups", err);
    }
  };

  const fetchDrops = async (targetPage: number, showLoadingScreen: boolean = true) => {
    if (!companyId) return;
    if (showLoadingScreen) setIsLoading(true);

    try {
      let query = supabase
        .from("cash_sessions")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .neq("is_deleted", true); // <--- HIDE DELETED ROWS ON THE WEB

      // Only filter by current store if we aren't in Admin/All Stores mode
      if (storeId && storeId !== "ALL_STORES") {
        query = query.eq("store_id", storeId);
      }

      // Type Filter
      if (filterType !== "All Types") {
        query = query.eq("type", filterType);
      } else {
        query = query.in("type", ["Add Cash", "Remove Cash"]);
      }

      // User Filter
      if (filterUser !== "All Users") {
        query = query.eq("user", filterUser);
      }

      // Date Filter
      if (filterDate) {
        // Convert the local selected date into strict UTC boundaries to catch all offset drops
        const startOfDay = new Date(`${filterDate}T00:00:00`).toISOString();
        const endOfDay = new Date(`${filterDate}T23:59:59.999`).toISOString();
        
        query = query.gte("date", startOfDay).lte("date", endOfDay);
      }
      // Search Query
      if (searchQuery.trim()) {
        const wild = `%${searchQuery.trim()}%`;
        // Checking notes and user for matches. Total is numerical so we skip ilike for it in PostgREST unless explicitly casted
        query = query.or(`notes.ilike.${wild},user.ilike.${wild}`);
      }

      // Pagination
      const from = (targetPage - 1) * limit;
      const to = from + limit - 1;

      const { data, count, error } = await query
        .order("timestamp", { ascending: false })
        .range(from, to);

      if (error) throw error;

      setDrops(data || []);
      setTotalCount(count || 0);
      
      // Keep the heartbeat reference in sync
      lastKnownCountRef.current = count;
      
    } catch (err) {
      console.error("Error fetching cash drops", err);
    } finally {
      if (showLoadingScreen) setIsLoading(false);
    }
  };

  // --- MODAL HANDLERS ---
  const openModal = (record: CashDrop | null = null) => {
    setEditRecord(record);
    if (record) {
      const amt = Math.abs(record.total).toFixed(2);
      setDropAmount(amt);
      setDropReason(record.notes || "");
    } else {
      setDropAmount("");
      setDropReason("");
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditRecord(null);
    setDropAmount("");
    setDropReason("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || val === ".") {
      setDropAmount(val);
      return;
    }
    if (/^\d*\.?\d*$/.test(val)) {
      setDropAmount(val);
    }
  };

  const processSave = async (actionType: "Add Cash" | "Remove Cash") => {
    const amountVal = parseFloat(dropAmount);
    const reasonVal = dropReason.trim();

    if (isNaN(amountVal) || amountVal <= 0) {
      alert("Amount must be greater than 0");
      return;
    }
    if (!reasonVal) {
      alert("Please enter a reason/note");
      return;
    }

    setIsSaving(true);
    const finalAmount = actionType === "Add Cash" ? amountVal : -amountVal;

    try {
      // --- STRICT UTC RULE ---
      const now = new Date();
      const dateStr = now.toISOString(); 
      const unixTs = Math.floor(now.getTime() / 1000);

      const targetStoreId = storeId === "ALL_STORES" ? null : storeId;

      if (editRecord) {
        // UPDATE (FIXED: we now update 'date' to force sync_worker to pull the edit)
        const { error } = await supabase
          .from("cash_sessions")
          .update({
            total: finalAmount,
            notes: reasonVal,
            type: actionType,
            date: dateStr, 
            timestamp: unixTs
          })
          .eq("id", editRecord.id);

        if (error) throw error;

        // Activity Log
        await logActivity(
          actionType,
          `Updated Cash: ${finalAmount.toFixed(2)} (${actionType})`,
          dateStr.split("T")[0] // Split on T for standard date formats
        );
      } else {
        // INSERT
        const newId = `drop_${crypto.randomUUID().replace(/-/g, "")}`;
        const { error } = await supabase.from("cash_sessions").insert([{
          id: newId,
          date: dateStr,
          timestamp: unixTs,
          type: actionType,
          company_id: companyId,
          store_id: targetStoreId,
          user: user?.username || "Unknown",
          total: finalAmount,
          notes: reasonVal,
          expected_cash: 0,
          variance: 0,
        }]);

        if (error) throw error;

        // Activity Log
        await logActivity(
          actionType,
          `New Cash: ${finalAmount.toFixed(2)} (${actionType})`,
          dateStr.split("T")[0]
        );
      }

      closeModal();
      fetchDrops(page); // Reload
    } catch (err: any) {
      console.error("Save Error:", err);
      alert(`Database Error: Could not save record.\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRecord = async () => {
    if (!editRecord) return;
    if (!window.confirm("Are you sure you want to delete this record?\nThe cash balance will be updated accordingly.")) return;

    setIsSaving(true);
    try {
      // --- STRICT UTC RULE ---
      const now = new Date();
      const dateStr = now.toISOString();
      const unixTs = Math.floor(now.getTime() / 1000);

      // 2. THE FIX: Soft delete AND bump the timestamp forward so Python catches it!
      const { error } = await supabase
        .from("cash_sessions")
        .update({ is_deleted: true, date: dateStr, timestamp: unixTs }) 
        .eq("id", editRecord.id);

      if (error) throw error;

      // Activity Log
      await logActivity(
        "Delete Cash Log",
        `Deleted record amount: ${editRecord.total.toFixed(2)}`,
        dateStr.split("T")[0]
      );

      closeModal();
      fetchDrops(page);
    } catch (err: any) {
      console.error("Delete Error:", err);
      alert(`Delete failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  

  const logActivity = async (action: string, description: string, dateStr: string) => {
    try {
      await supabase.from("activity_log").insert([{
        date: dateStr,
        timestamp: Math.floor(Date.now() / 1000),
        company_id: companyId,
        store_id: storeId === "ALL_STORES" ? null : storeId,
        user_id: user?.id || null,
        user_name: user?.username || "Unknown",
        action: action,
        description: description,
      }]);
    } catch (e) {
      console.error("Log error", e);
    }
  };

  // --- UI RENDER ---
  if (isLoading) {
    return <div className="flex h-full items-center justify-center bg-[#181818]"><p className="text-gray-500">Loading Configuration...</p></div>;
  }

  // --- NEW: STORE CLOSED LOCK SCREEN ---
  if (isStoreOpen === false) {
    return (
      <div className="flex h-full w-full bg-[#181818] items-center justify-center">
        <div className="bg-[#222222] border border-gray-800 shadow-xl rounded-2xl w-[650px] h-[400px] flex flex-col items-center justify-center p-8">
          
          <svg xmlns="http://www.w3.org/2000/svg" className="h-[75px] w-[75px] text-gray-300 mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>

          <h2 className="text-[34px] font-bold text-gray-400 mb-3 tracking-wide">Register is Currently Closed</h2>
          <p className="text-gray-500 text-[17px] mb-10 font-medium">Store is closed, open the store to manage cash.</p>
          
          {setActiveModule && (
              <button
                onClick={() => setActiveModule("Open/Close")}
                style={{ backgroundColor: themeColor }}
                className="px-10 py-3.5 rounded text-white font-bold text-[16px] tracking-widest uppercase transition-transform active:scale-95 shadow-md hover:brightness-110"
              >
                OPEN TILL NOW
              </button>
          )}
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="flex h-full w-full bg-[#181818] relative flex-col font-sans">
      {/* --- HEADER --- */}
      <div className="bg-[#1e1e1e] p-6 border-b border-gray-800 shrink-0">
        <h1 className="text-3xl font-bold text-white mb-6">Cash Management History</h1>

        <div className="flex flex-col gap-4">
          {/* Search Bar Row */}
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="Search by User, Amount, or Reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ "--focus-color": themeColor } as React.CSSProperties}
              className="flex-1 bg-[#141414] border border-gray-700 p-3 rounded-lg text-[15px] text-white outline-none focus:[border-color:var(--focus-color)] transition-colors"
            />
            <button
              onClick={() => openModal()}
              style={{ backgroundColor: themeColor }}
              className="w-[180px] rounded-lg text-white font-bold text-[15px] hover:brightness-110 active:scale-95 transition-all shadow-md tracking-wide"
            >
              MANAGE CASH
            </button>
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-[12px] font-bold text-gray-500 uppercase">Type:</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none w-36"
              >
                <option value="All Types">All Types</option>
                <option value="Add Cash">Add Cash</option>
                <option value="Remove Cash">Remove Cash</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[12px] font-bold text-gray-500 uppercase">User:</label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none w-36"
              >
                <option value="All Users">All Users</option>
                {userMap.map((uname) => (
                  <option key={uname} value={uname}>
                    {uname}
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
                className="bg-[#141414] border border-gray-700 rounded p-2 text-white text-sm outline-none [color-scheme:dark] w-36"
              />
              <button
                onClick={() => {
                  setFilterType("All Types");
                  setFilterUser("All Users");
                  setFilterDate("");
                  setSearchQuery("");
                }}
                className="text-xs text-gray-400 hover:text-white px-3 py-2 border border-transparent hover:border-gray-600 rounded transition-colors ml-2"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* --- SCROLLABLE LIST VIEW --- */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="bg-[#1e1e1e] rounded-xl border border-gray-800 overflow-hidden shadow-lg">
          {/* Table Header */}
          <div className="flex bg-[#252525] p-4 border-b border-gray-800 text-[12px] font-bold text-gray-400 uppercase tracking-wider">
            <div className="w-[200px]">Date / Time</div>
            <div className="w-[120px]">Type</div>
            <div className="w-[150px]">User</div>
            <div className="flex-1">Reason / Note</div>
            <div className="w-[100px] text-right">Amount</div>
            <div className="w-[120px] text-right ml-4 pr-2">Action</div>
          </div>

          {/* Table Body */}
          <div className="flex flex-col">
            {isLoading ? (
              <p className="text-center text-gray-500 py-10">Loading records...</p>
            ) : drops.length === 0 ? (
              <p className="text-center text-gray-500 py-10">No records found.</p>
            ) : (
              drops.map((drop) => {
                const isPositive = drop.total > 0;
                const displayAmt = isPositive ? `$${drop.total.toFixed(2)}` : `-$${Math.abs(drop.total).toFixed(2)}`;
                const amtColor = isPositive ? themeColor : "#C92C2C";

                return (
                  <div
                    key={drop.id}
                    className="flex items-center p-4 border-b border-gray-800 hover:bg-[#222222] transition-colors group"
                  >
                    {/* --- THE FIX: Projected Local Time --- */}
                    <div className="w-[200px] text-[14px] text-gray-300">{getLocalDisplayTime(drop.date, drop.store_id)}</div>
                    
                    <div className="w-[120px] text-[14px] text-gray-300">{drop.type}</div>
                    <div className="w-[150px] text-[14px] text-gray-300 truncate pr-4">{drop.user || "Unknown"}</div>
                    <div className="flex-1 text-[14px] text-gray-200 font-medium truncate pr-4">{drop.notes}</div>
                    <div className="w-[100px] text-right font-bold text-[15px]" style={{ color: amtColor }}>
                      {displayAmt}
                    </div>
                    <div className="w-[120px] flex justify-end ml-4">
                      <button
                        onClick={() => openModal(drop)}
                        style={{ backgroundColor: themeColor }}
                        className="px-4 py-1.5 rounded text-white font-bold text-[12px] hover:brightness-110 active:scale-95 transition-all shadow-sm"
                      >
                        View / Edit
                      </button>
                    </div>
                  </div>
                );
              })
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
          Showing {drops.length} rows
        </div>
      </div>

      {/* ========================================================= */}
      {/* --- ADD/EDIT CASH DROP MODAL OVERLAY --- */}
      {/* ========================================================= */}
      {isModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl border border-gray-600 shadow-2xl w-full max-w-[600px] overflow-hidden">
            
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-800">
              <h2 className="text-2xl font-bold text-white tracking-wide">
                {editRecord ? "Edit Cash Entry" : "Add/Remove Cash"}
              </h2>
              <button 
                onClick={closeModal} 
                disabled={isSaving}
                className="text-gray-500 hover:text-[#C92C2C] text-2xl font-bold px-2 transition-colors disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="p-10 flex flex-col items-center">
              
              <div className="w-full mb-6">
                <label className="text-[14px] font-bold text-gray-400 block mb-2">Amount ($)</label>
                <input 
                  type="text"
                  placeholder="0.00"
                  value={dropAmount}
                  onChange={handleAmountChange}
                  disabled={isSaving}
                  style={{ "--focus-color": themeColor } as React.CSSProperties}
                  className="w-full bg-[#141414] border border-gray-700 text-[36px] font-bold text-center py-4 rounded-lg outline-none focus:[border-color:var(--focus-color)] transition-colors disabled:opacity-50"
                />
              </div>

              <div className="w-full mb-8">
                <label className="text-[14px] font-bold text-gray-400 block mb-2">Reason / Note</label>
                <input 
                  type="text"
                  placeholder="e.g. Safe Drop, Opening Float"
                  value={dropReason}
                  onChange={(e) => setDropReason(e.target.value)}
                  disabled={isSaving}
                  style={{ "--focus-color": themeColor } as React.CSSProperties}
                  className="w-full bg-[#141414] border border-gray-700 text-[16px] py-4 px-4 rounded-lg outline-none focus:[border-color:var(--focus-color)] transition-colors disabled:opacity-50"
                />
              </div>

              {editRecord && (
                <div className="w-full text-center mb-6">
                  <p className="text-[14px] font-bold" style={{ color: themeColor }}>
                    Current Type: {editRecord.type}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="w-full flex flex-col gap-3">
                <button
                  onClick={() => processSave("Add Cash")}
                  disabled={isSaving}
                  style={{ backgroundColor: themeColor }}
                  className="w-full py-4 text-white font-bold text-[16px] rounded-lg transition-transform active:scale-95 shadow-md disabled:opacity-50 tracking-wider"
                >
                  ADD CASH
                </button>

                <button
                  onClick={() => processSave("Remove Cash")}
                  disabled={isSaving}
                  className="w-full py-4 bg-[#C92C2C] hover:bg-[#8a1c1c] text-white font-bold text-[16px] rounded-lg transition-transform active:scale-95 shadow-md disabled:opacity-50 tracking-wider"
                >
                  REMOVE CASH
                </button>

                {editRecord && (
                  <button
                    onClick={deleteRecord}
                    disabled={isSaving}
                    className="w-full py-3 mt-2 bg-transparent border border-[#C92C2C] text-[#C92C2C] hover:bg-[#3a1010] font-bold text-[15px] rounded-lg transition-colors disabled:opacity-50 tracking-wider"
                  >
                    Delete Entry
                  </button>
                )}

                <button
                  onClick={closeModal}
                  disabled={isSaving}
                  className="w-full py-3 mt-2 bg-transparent border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white font-bold text-[15px] rounded-lg transition-colors disabled:opacity-50 tracking-wider"
                >
                  Cancel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}