"use client";

// ============================================================================
// 1. IMPORTS & INTERFACES
// ============================================================================
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../../utils/supabase";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  username: string;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  company_id: string;
}

interface Store {
  id: string;
  name: string;
}

interface TimeBreak {
  id: string;
  punch_id: string;
  break_start: string;
  break_end: string | null;
  break_type: string;
  req_break_start?: string | null;
  req_break_end?: string | null;
  req_break_type?: string | null;
  is_new?: boolean; 
}

interface TimePunch {
  id: string;
  store_id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  status: string;
  type: string;
  req_clock_in?: string | null;
  req_clock_out?: string | null;
  req_notes?: string | null;
  applied_rounding_mins: number;
  breaks: TimeBreak[];
  calculated_hours: number | null;
  is_padded: boolean;
  
  // UI Format helpers generated during fetch
  display_date: string;
  display_in: string;
  display_out: string;
  req_in_str: string;
  req_out_str: string;
}

interface FeedbackModal {
  type: "success" | "error" | "info";
  title: string;
  message: string;
}

// ============================================================================
// HELPERS
// ============================================================================
const roundDate = (dt: Date, rMins: number) => {
  if (rMins <= 0) return dt;
  const ms = 1000 * 60 * rMins;
  const discard = dt.getTime() % ms;
  let newTime = dt.getTime() - discard;
  if (discard >= ms / 2) newTime += ms;
  return new Date(newTime);
};

const toDatetimeLocal = (isoString: string | null) => {
  if (!isoString) return "";
  const dt = new Date(isoString);
  const tzoffset = dt.getTimezoneOffset() * 60000;
  return new Date(dt.getTime() - tzoffset).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (localString: string) => {
  if (!localString) return null;
  const dt = new Date(localString);
  return dt.toISOString();
};

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function MyTimecards() {
  const router = useRouter();
  
  const [isReady, setIsReady] = useState(false);
  const [themeColor, setThemeColor] = useState("#00A023");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [companyId, setCompanyId] = useState<string>(""); 
  
  const [stores, setStores] = useState<Store[]>([]);
  const [allPunches, setAllPunches] = useState<TimePunch[]>([]);
  const [displayedPunches, setDisplayedPunches] = useState<TimePunch[]>([]);
  
  // --- PAGINATION & FILTERS ---
  const [page, setPage] = useState(1);
  const limit = 25;
  const [filterStore, setFilterStore] = useState("All Stores");
  const [filterDate, setFilterDate] = useState("");
  const [filteredHours, setFilteredHours] = useState(0);

  // --- MODALS ---
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModal | null>(null);
  const [editModalPunch, setEditModalPunch] = useState<TimePunch | null>(null);
  
  // --- EDIT MODAL STATES ---
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBreaks, setEditBreaks] = useState<TimeBreak[]>([]);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(false);

  // ============================================================================
  // 3. DATA FETCHING & MATH
  // ============================================================================
  const fetchTimecards = async (empId: string, compId: string) => {
    try {
      // 1. Base Query for Punches
      let query = supabase.from('time_punches')
        .select('*')
        .eq('company_id', compId)
        .eq('employee_id', empId)
        .order('clock_in', { ascending: false });

      if (filterStore !== "All Stores") {
        const targetStore = stores.find((s: any) => s.name === filterStore);
        if (targetStore) query = query.eq('store_id', targetStore.id);
      }

      if (filterDate) {
        query = query.like('clock_in', `${filterDate}%`);
      }

      const { data: punchesData } = await query;
      if (!punchesData) return;

      // 2. Fetch dependencies
      const { data: settingsData } = await supabase.from('store_time_clock_settings').select('store_id, min_reporting_pay, min_reporting_hours, round_time_punches, rounding_increment_mins').eq('company_id', compId);
      const { data: schedulesData } = await supabase.from('schedules').select('employee_id, date').eq('company_id', compId);
      const { data: breaksData } = await supabase.from('time_punch_breaks').select('*').in('punch_id', punchesData.map((p: any) => p.id));

      const schedSet = new Set(schedulesData?.map((s: any) => `${s.employee_id}_${s.date}`));
      let totalHours = 0;

      // 3. Process and Math
      const processed: TimePunch[] = punchesData.map((p: any) => {
        const sSet: any = settingsData?.find((s: any) => s.store_id === p.store_id) || {};
        const roundMins = parseInt(p.applied_rounding_mins || "0", 10);
        const isRounded = roundMins > 0;

        let dtIn = p.clock_in ? new Date(p.clock_in) : null;
        let dtOut = p.clock_out ? new Date(p.clock_out) : null;

        const rawIn = dtIn;
        const rawOut = dtOut;

        if (isRounded && dtIn) dtIn = roundDate(dtIn, roundMins);
        if (isRounded && dtOut) dtOut = roundDate(dtOut, roundMins);

        const myBreaks = ((breaksData as TimeBreak[]) || []).filter((b: any) => b.punch_id === p.id).sort((a: any, b: any) => new Date(a.break_start).getTime() - new Date(b.break_start).getTime());
        
        let breakSec = 0;
        myBreaks.filter((b: any) => b.break_type === 'Unpaid' && b.break_end).forEach((b: any) => {
          let bStart = new Date(b.break_start);
          let bEnd = new Date(b.break_end!);
          if (isRounded) {
            bStart = roundDate(bStart, roundMins);
            bEnd = roundDate(bEnd, roundMins);
          }
          breakSec += (bEnd.getTime() - bStart.getTime()) / 1000;
        });

        let hours: number | null = null;
        let isPadded = false;

        if (dtIn && dtOut) {
          const grossSec = (dtOut.getTime() - dtIn.getTime()) / 1000;
          const netSec = Math.max(0, grossSec - breakSec);
          hours = netSec / 3600.0;

          if ((sSet.min_reporting_pay === 1 || sSet.min_reporting_pay === true) && hours > 0 && hours < parseFloat(sSet.min_reporting_hours || "3.0")) {
             const tzoffset = dtIn.getTimezoneOffset() * 60000;
             const localDateStr = new Date(dtIn.getTime() - tzoffset).toISOString().split('T')[0];
             if (schedSet.has(`${p.employee_id}_${localDateStr}`)) {
                hours = parseFloat(sSet.min_reporting_hours || "3.0");
                isPadded = true;
             }
          }
          totalHours += hours;
        }

        // --- FORMATTING FOR UI ---
        const formatDate = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        const formatTime = (dt: Date) => dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        let displayDate = "Invalid Date";
        let displayIn = "--";
        if (rawIn) {
          displayDate = formatDate(rawIn);
          displayIn = formatTime(rawIn);
          if (dtIn && formatTime(dtIn) !== displayIn) {
            displayIn = `${displayIn} (${formatTime(dtIn)})`;
          }
        }

        let displayOut = "Active Shift";
        if (rawOut) {
          displayOut = formatTime(rawOut);
          if (dtOut && formatTime(dtOut) !== displayOut) {
            displayOut = `${displayOut} (${formatTime(dtOut)})`;
          }
        } else if (p.status === "Approved" && !p.clock_out) {
          displayOut = "Error"; // Missing punch out
        }

        let reqInStr = "";
        let reqOutStr = "";
        if (p.status === "Pending Edit") {
          if (p.req_clock_in) reqInStr = ` (${formatTime(new Date(p.req_clock_in))})`;
          if (p.req_clock_out) reqOutStr = ` (${formatTime(new Date(p.req_clock_out))})`;
        }

        return {
          ...p,
          type: p.type || "Regular", // FIX: Provide a default fallback so null types never crash the UI
          breaks: myBreaks,
          calculated_hours: hours,
          is_padded: isPadded,
          display_date: displayDate,
          display_in: displayIn,
          display_out: displayOut,
          req_in_str: reqInStr,
          req_out_str: reqOutStr
        };
      });

      setAllPunches(processed);
      setFilteredHours(totalHours);
      updatePagination(processed, 1);

    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  const updatePagination = (data: TimePunch[], targetPage: number) => {
    setPage(targetPage);
    const offset = (targetPage - 1) * limit;
    setDisplayedPunches(data.slice(offset, offset + limit));
  };

  useEffect(() => {
    const initializePage = async () => {
      const cachedColor = localStorage.getItem('chronara_theme_color');
      if (cachedColor) setThemeColor(cachedColor);

      const cachedStore = localStorage.getItem('chronara_last_store');
      
      const cachedUserStr = localStorage.getItem('chronara_web_user');
      if (!cachedUserStr) {
        router.push("/timeclock");
        return;
      }

      const user: User = JSON.parse(cachedUserStr);
      setCurrentUser(user);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/timeclock");
        return;
      }

      try {
        const { data: companies } = await supabase.from('companies').select('id').or(`email.eq.${session.user.email},owner_email.eq.${session.user.email}`).limit(1);
        if (companies && companies.length > 0) {
          setCompanyId(companies[0].id); 
          
          const { data: storeData } = await supabase.from('stores').select('id, name').eq('company_id', companies[0].id);
          if (storeData) setStores(storeData.sort((a: any, b: any) => a.name.localeCompare(b.name)));

          const { data: empData } = await supabase.from('employees').select('id, first_name, last_name, company_id').eq('user_id', user.id).limit(1);
          if (empData && empData.length > 0) {
            setEmployee(empData[0]);
            
            if (cachedStore && storeData?.some((s: any) => s.id === cachedStore)) {
              const sName = storeData.find((s: any) => s.id === cachedStore)?.name;
              if (sName) setFilterStore(sName);
            }

            await fetchTimecards(empData[0].id, companies[0].id);
          }

          // Auto Logout check
          if (cachedStore) {
            const { data: sSet } = await supabase.from('store_time_clock_settings').select('*').eq('store_id', cachedStore).limit(1);
            if (sSet && sSet.length > 0) {
              const autoOut = sSet[0].auto_logout || sSet[0].auto_signout || sSet[0].enforce_auto_logout;
              if (String(autoOut).toLowerCase() === "true" || String(autoOut) === "1") setAutoLogoutEnabled(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching context:", err);
      }
      setIsReady(true);
    };

    initializePage();
  }, [router]);

  useEffect(() => {
    if (!autoLogoutEnabled) return;
    const handleActivity = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        localStorage.removeItem('chronara_web_user');
        router.push("/timeclock");
      }, 60000); 
    };
    handleActivity();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, handleActivity));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [autoLogoutEnabled, router]);

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================
  const handleFilterExecute = () => {
    if (employee && companyId) fetchTimecards(employee.id, companyId);
  };

  const handleClearFilters = () => {
    setFilterStore("All Stores");
    setFilterDate("");
    setTimeout(() => {
      if (employee && companyId) fetchTimecards(employee.id, companyId);
    }, 50);
  };

  const handleSignOut = () => {
    localStorage.removeItem('chronara_web_user');
    router.push("/timeclock");
  };

  // --- EDIT MODAL LOGIC ---
  const openEditModal = (punch: TimePunch) => {
    const isPending = punch.status === "Pending Edit";
    
    const targetIn = isPending ? (punch.req_clock_in || punch.clock_in) : punch.clock_in;
    const targetOut = isPending ? (punch.req_clock_out || punch.clock_out) : punch.clock_out;
    
    setEditIn(toDatetimeLocal(targetIn));
    
    if (!targetOut && targetIn) {
       const dt = new Date(targetIn);
       dt.setHours(dt.getHours() + 8);
       setEditOut(toDatetimeLocal(dt.toISOString()));
    } else {
       setEditOut(toDatetimeLocal(targetOut));
    }
    
    setEditNotes(punch.req_notes || "");
    
    const clonedBreaks = punch.breaks.map((b: any) => ({
      ...b,
      req_break_start: isPending ? (b.req_break_start || b.break_start) : b.break_start,
      req_break_end: isPending ? (b.req_break_end || b.break_end) : b.break_end,
      req_break_type: isPending ? (b.req_break_type || b.break_type) : b.break_type,
    }));
    
    setEditBreaks(clonedBreaks);
    setEditModalPunch(punch);
  };

  const closeEditModal = () => {
    setEditModalPunch(null);
    setEditIn("");
    setEditOut("");
    setEditNotes("");
    setEditBreaks([]);
  };

  const handleAddBreak = () => {
    // Extract strictly the local date string from editIn (e.g. "2026-03-29") to prevent UTC bleed
    const baseDate = editIn ? editIn.split('T')[0] : toDatetimeLocal(new Date().toISOString()).split('T')[0];
    const defaultTime = `${baseDate}T12:00`;
    
    const newB: TimeBreak = {
      id: `tcb_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
      punch_id: editModalPunch!.id,
      break_start: "",
      break_end: "",
      break_type: "Unpaid",
      req_break_start: fromDatetimeLocal(defaultTime),
      req_break_end: fromDatetimeLocal(defaultTime),
      req_break_type: "Unpaid",
      is_new: true
    };
    setEditBreaks([...editBreaks, newB]);
  };

  // --- Dynamic Changes Checker ---
  let hasChanges = false;
  if (editModalPunch) {
    const isPending = editModalPunch.status === "Pending Edit";
    const origIn = toDatetimeLocal(isPending ? (editModalPunch.req_clock_in || editModalPunch.clock_in) : editModalPunch.clock_in);
    const origOut = toDatetimeLocal(isPending ? (editModalPunch.req_clock_out || editModalPunch.clock_out) : editModalPunch.clock_out);
    const origNotes = editModalPunch.req_notes || "";

    if (editIn !== origIn || editOut !== origOut || editNotes !== origNotes) {
      hasChanges = true;
    } else if (editBreaks.length !== editModalPunch.breaks.length) {
      hasChanges = true;
    } else {
      for (let i = 0; i < editBreaks.length; i++) {
        const b = editBreaks[i];
        const origB = editModalPunch.breaks[i];
        const oS = toDatetimeLocal(isPending ? (origB.req_break_start || origB.break_start) : origB.break_start);
        const oE = toDatetimeLocal(isPending ? (origB.req_break_end || origB.break_end) : origB.break_end);
        const oType = isPending ? (origB.req_break_type || origB.break_type) : origB.break_type;

        if (toDatetimeLocal(b.req_break_start || "") !== oS || toDatetimeLocal(b.req_break_end || "") !== oE || b.req_break_type !== oType || b.is_new) {
          hasChanges = true;
          break;
        }
      }
    }
  }

  const handleEditSubmit = async () => {
    if (!editModalPunch || !hasChanges) return;

    if (!editIn) {
      setFeedbackModal({ type: "error", title: "Missing Time", message: "Clock In time is required." });
      return;
    }

    const isoIn = fromDatetimeLocal(editIn);
    const isoOut = fromDatetimeLocal(editOut);

    if (isoIn && isoOut && new Date(isoOut) < new Date(isoIn)) {
      setFeedbackModal({ type: "error", title: "Invalid Times", message: "Clock Out cannot be before Clock In." });
      return;
    }

    for (const b of editBreaks) {
       const bS = b.req_break_start;
       const bE = b.req_break_end;
       if (bS && bE && new Date(bE) < new Date(bS)) {
         setFeedbackModal({ type: "error", title: "Invalid Break", message: "A Break End time cannot be before its Start time." });
         return;
       }
       if (bS && isoIn && new Date(bS) < new Date(isoIn)) {
         setFeedbackModal({ type: "error", title: "Invalid Break", message: "Breaks cannot start before Clock In." });
         return;
       }
       if (bE && isoOut && new Date(bE) > new Date(isoOut)) {
         setFeedbackModal({ type: "error", title: "Invalid Break", message: "Breaks cannot end after Clock Out." });
         return;
       }
    }

    try {
      const updates = editBreaks.filter(b => {
        if (b.is_new) return true;
        const oS = b.break_start ? new Date(b.break_start).getTime() : null;
        const oE = b.break_end ? new Date(b.break_end).getTime() : null;
        const nS = b.req_break_start ? new Date(b.req_break_start).getTime() : null;
        const nE = b.req_break_end ? new Date(b.req_break_end).getTime() : null;
        return oS !== nS || oE !== nE || b.break_type !== b.req_break_type;
      });

      const { error: pErr } = await supabase.from('time_punches').update({
        status: 'Pending Edit',
        req_clock_in: isoIn,
        req_clock_out: isoOut,
        req_notes: editNotes.trim()
      }).eq('id', editModalPunch.id);

      if (pErr) throw pErr;

      for (const b of updates) {
        if (b.is_new) {
          await supabase.from('time_punch_breaks').insert({
            id: b.id,
            company_id: companyId,
            punch_id: editModalPunch.id,
            break_type: b.req_break_type,
            req_break_start: b.req_break_start,
            req_break_end: b.req_break_end,
            req_break_type: b.req_break_type
          });
        } else {
          await supabase.from('time_punch_breaks').update({
            req_break_start: b.req_break_start,
            req_break_end: b.req_break_end,
            req_break_type: b.req_break_type
          }).eq('id', b.id);
        }
      }

      setFeedbackModal({ type: "success", title: "Request Submitted", message: "Your timecard modification request has been sent to management." });
      closeEditModal();
      fetchTimecards(employee!.id, companyId);

    } catch (err: any) {
      setFeedbackModal({ type: "error", title: "Error", message: "Failed to submit request. Please try again." });
    }
  };

  // ============================================================================
  // 5. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#181818]"></div>;

  return (
    <div className="flex h-screen bg-[#222222] text-white font-sans overflow-hidden relative">
      
      {/* --- FEEDBACK MODAL --- */}
      {feedbackModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1b2b22] border border-green-500/30 p-10 rounded-2xl shadow-2xl flex flex-col items-center text-center w-full max-w-md">
            <div className="text-6xl mb-4">{feedbackModal.type === 'success' ? '✅' : feedbackModal.type === 'error' ? '⚠️' : '☕'}</div>
            <h2 className="text-2xl font-extrabold text-white mb-4 leading-tight">{feedbackModal.title}</h2>
            <p className="text-lg mb-8 text-gray-300">{feedbackModal.message}</p>
            <button 
              onClick={() => setFeedbackModal(null)}
              style={{ backgroundColor: themeColor }}
              className="w-full py-4 rounded-xl text-xl font-bold hover:brightness-110 transition-all shadow-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* --- EDIT MODAL --- */}
      {editModalPunch && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#2b2b2b] border border-gray-700 rounded-xl shadow-2xl flex flex-col w-full max-w-2xl max-h-[90vh]">
            <div className="p-6 border-b border-gray-700 shrink-0">
              <h2 className="text-2xl font-bold" style={{ color: themeColor }}>Request Timecard Edit</h2>
              <p className="text-gray-400 mt-1">{employee?.first_name} {employee?.last_name} @ {stores.find(s => s.id === editModalPunch.store_id)?.name}</p>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 scrollbar-hide">
               {/* Times */}
               <div className="space-y-4">
                 <div>
                   <label className="block text-sm font-bold text-gray-400 mb-1">Clock In</label>
                   <input 
                     type="datetime-local" 
                     value={editIn}
                     onChange={(e) => setEditIn(e.target.value)}
                     className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023]" 
                   />
                 </div>
                 <div>
                   <label className="block text-sm font-bold text-gray-400 mb-1">Clock Out</label>
                   <input 
                     type="datetime-local" 
                     value={editOut}
                     onChange={(e) => setEditOut(e.target.value)}
                     className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023]" 
                   />
                 </div>
               </div>

               {/* Breaks */}
               {editBreaks.length > 0 && <hr className="border-gray-700" />}
               <div className="space-y-6">
                 {editBreaks.map((b, i) => (
                   <div key={b.id} className="bg-black/20 p-4 rounded-lg border border-gray-700/50">
                     <div className="flex justify-between items-center mb-3">
                       <span className="font-bold text-[#E0A800]">Break {i + 1}</span>
                       <select 
                          value={b.req_break_type || "Unpaid"}
                          onChange={(e) => {
                            const copy = [...editBreaks];
                            copy[i].req_break_type = e.target.value;
                            setEditBreaks(copy);
                          }}
                          className="bg-[#131b26] border border-gray-600 rounded px-2 py-1 text-sm"
                       >
                         <option>Paid</option>
                         <option>Unpaid</option>
                       </select>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-xs text-gray-500 mb-1">Start</label>
                         <input 
                           type="datetime-local" 
                           value={toDatetimeLocal(b.req_break_start || "")}
                           onChange={(e) => {
                             const copy = [...editBreaks];
                             copy[i].req_break_start = fromDatetimeLocal(e.target.value);
                             setEditBreaks(copy);
                           }}
                           className="w-full bg-[#131b26] border border-gray-700 rounded p-2 text-white text-sm" 
                         />
                       </div>
                       <div>
                         <label className="block text-xs text-gray-500 mb-1">End</label>
                         <input 
                           type="datetime-local" 
                           value={toDatetimeLocal(b.req_break_end || "")}
                           onChange={(e) => {
                             const copy = [...editBreaks];
                             copy[i].req_break_end = fromDatetimeLocal(e.target.value);
                             setEditBreaks(copy);
                           }}
                           className="w-full bg-[#131b26] border border-gray-700 rounded p-2 text-white text-sm" 
                         />
                       </div>
                     </div>
                   </div>
                 ))}
                 
                 <button onClick={handleAddBreak} className="text-sm font-bold mt-2" style={{ color: themeColor }}>
                   + Add Missing Break
                 </button>
               </div>

               <hr className="border-gray-700" />
               
               {/* Notes */}
               <div>
                 <label className="block text-sm font-bold text-gray-400 mb-1">Reason / Notes</label>
                 <textarea 
                   value={editNotes}
                   onChange={(e) => setEditNotes(e.target.value)}
                   className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023] h-24 resize-none"
                   placeholder="Explain why you are requesting this change..."
                 />
               </div>
            </div>

            <div className="p-6 border-t border-gray-700 flex justify-between shrink-0 bg-black/20 rounded-b-xl">
              <button onClick={closeEditModal} className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors font-semibold">Cancel</button>
              <button 
                onClick={handleEditSubmit} 
                disabled={!hasChanges}
                style={{ backgroundColor: hasChanges ? themeColor : '#333333', color: hasChanges ? 'white' : 'gray' }} 
                className={`px-8 py-2.5 rounded font-bold shadow-lg transition-all ${hasChanges ? 'hover:brightness-110 active:scale-95' : 'cursor-not-allowed'}`}
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- NARROW SIDEBAR --- */}
      <aside className="w-[180px] bg-[#1e1e1e] flex flex-col border-r border-gray-800 shrink-0">
        <div className="p-5 pt-8">
          <h1 className="text-[16px] font-bold leading-tight tracking-wide text-gray-100">
            CHRONARA<br />TIME CLOCK
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6 scrollbar-hide">
          <div>
            <p className="text-[10px] font-bold text-gray-500 tracking-wider mb-2 px-2 uppercase">Personal</p>
            <nav className="space-y-1">
              <button 
                onClick={() => router.push("/timeclock/dashboard")}
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200"
              >
                Dashboard
              </button>
              <button 
                onClick={() => router.push("/timeclock/schedule")}
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200"
              >
                Schedule
              </button>
              <button 
                onClick={() => router.push("/timeclock/timecards")}
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors bg-[#2a2a2a] text-gray-200"
              >
                My Timecards
              </button>
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800">
          <button onClick={handleSignOut} className="w-full text-left px-2 py-2 text-gray-400 hover:text-white transition-colors text-sm">
            Sign Out
          </button>
        </div>
      </aside>

      {/* --- MAIN WORKSPACE --- */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* Header */}
        <header className="bg-[#2b2b2b] h-[75px] shrink-0 flex items-center justify-between px-8 border-b border-gray-800">
          <h2 className="text-2xl font-bold text-white tracking-wide">My Timecards</h2>
          <div className="text-xl font-bold" style={{ color: themeColor }}>
            Filtered Hours: {filteredHours.toFixed(2)}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex flex-col p-8 overflow-hidden">
          
          {/* Filters */}
          <div className="flex items-center gap-4 mb-6 shrink-0">
             <div className="flex items-center gap-2">
               <label className="text-sm font-bold text-gray-300">Store:</label>
               <select 
                 value={filterStore} 
                 onChange={(e) => setFilterStore(e.target.value)}
                 className="bg-[#131b26] border border-gray-700 rounded px-3 py-2 text-white outline-none w-40 text-sm focus:border-gray-500"
               >
                 <option>All Stores</option>
                 {stores.map(s => <option key={s.id}>{s.name}</option>)}
               </select>
             </div>
             
             <div className="flex items-center gap-2 ml-2">
               <label className="text-sm font-bold text-gray-300">Date:</label>
               <input 
                 type="date" 
                 value={filterDate}
                 onChange={(e) => setFilterDate(e.target.value)}
                 className="bg-[#131b26] border border-gray-700 rounded px-3 py-2 text-white outline-none text-sm focus:border-gray-500"
                 style={{ colorScheme: 'dark' }}
               />
             </div>

             <button onClick={handleFilterExecute} style={{ backgroundColor: themeColor }} className="ml-2 px-4 py-2 rounded text-sm font-bold hover:brightness-110 transition-all">Search</button>
             <button onClick={handleClearFilters} className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white border border-gray-700 transition-all">Clear</button>
          </div>

          {/* Table Header */}
          <div className="bg-[#2b2b2b] rounded-t-lg flex items-center px-4 py-3 shrink-0 text-sm font-bold text-gray-300 border-b border-gray-700">
            <div className="w-[120px]">Date</div>
            <div className="w-[150px]">Location</div>
            <div className="w-[200px]">Clock In (Rounded)</div>
            <div className="w-[200px]">Clock Out (Rounded)</div>
            <div className="flex-1"></div>
            <div className="w-[140px]">Status</div>
            <div className="w-[100px]">Type</div>
            <div className="w-[90px] text-right mr-4">Duration</div>
            <div className="w-[80px] text-center">Action</div>
          </div>

          {/* Table Body / Scroll List */}
          <div className="flex-1 overflow-y-auto bg-transparent scrollbar-hide py-2 space-y-1">
             {displayedPunches.length === 0 ? (
               <div className="text-center text-gray-500 py-10">No timecards found for this filter.</div>
             ) : (
               displayedPunches.map((p) => {
                 const isPending = p.status === "Pending Edit";
                 const statusColor = isPending ? "text-[#E0A800]" : "text-gray-400";
                 const isMissing = p.calculated_hours === null;
                 const durColorClass = isMissing || p.is_padded ? "text-[#E0A800]" : "";
                 const durStyle = isMissing || p.is_padded ? {} : { color: themeColor };
                 const displayStatus = isPending ? "AWAITING APPROVAL" : p.status.toUpperCase();
                 
                 return (
                   <div key={p.id} onDoubleClick={() => openEditModal(p)} className="bg-[#222222] hover:bg-[#2a2a2a] border border-gray-800 rounded-lg flex items-center px-4 py-1.5 text-sm transition-colors cursor-pointer group">
                     <div className="w-[120px] font-bold">{p.display_date}</div>
                     <div className="w-[150px] truncate pr-2">{stores.find(s => s.id === p.store_id)?.name || "Unknown"}</div>
                     
                     <div className="w-[200px] flex items-center">
                       <span>{p.display_in}</span>
                       {p.req_in_str && <span className="text-[#E0A800] font-bold ml-1">{p.req_in_str}</span>}
                     </div>
                     
                     <div className="w-[200px] flex items-center">
                       <span>{p.display_out}</span>
                       {p.req_out_str && <span className="text-[#E0A800] font-bold ml-1">{p.req_out_str}</span>}
                     </div>
                     
                     <div className="flex-1"></div>
                     
                     <div className={`w-[140px] font-bold ${statusColor}`}>{displayStatus}</div>
                     <div className="w-[100px] font-bold text-gray-500">{p.type.toUpperCase()}</div>
                     <div className={`w-[90px] text-right font-bold text-lg mr-4 ${durColorClass}`} style={durStyle}>
                       {!isMissing ? `${p.calculated_hours!.toFixed(2)}h` : "--"}
                     </div>
                     
                     <div className="w-[80px] flex justify-center">
                       <button 
                         onClick={(e) => { e.stopPropagation(); openEditModal(p); }}
                         className="border border-gray-600 text-gray-300 hover:text-white hover:border-white px-3 py-1 rounded text-xs transition-colors"
                       >
                         Modify
                       </button>
                     </div>
                   </div>
                 )
               })
             )}
          </div>

          {/* Footer / Pagination */}
          <div className="h-[60px] shrink-0 flex items-center justify-between border-t border-gray-800 pt-4 mt-2">
             <div className="flex items-center gap-4">
               <button 
                 disabled={page === 1}
                 onClick={() => updatePagination(allPunches, page - 1)}
                 style={{ backgroundColor: page === 1 ? 'transparent' : themeColor }}
                 className={`px-4 py-2 rounded text-sm font-bold transition-all border ${page === 1 ? 'border-gray-700 text-gray-500' : 'border-transparent text-white hover:brightness-110'}`}
               >
                 &lt; Previous
               </button>
               <span className="font-bold">Page {page}</span>
               <button 
                 disabled={page * limit >= allPunches.length}
                 onClick={() => updatePagination(allPunches, page + 1)}
                 style={{ backgroundColor: page * limit >= allPunches.length ? 'transparent' : themeColor }}
                 className={`px-4 py-2 rounded text-sm font-bold transition-all border ${page * limit >= allPunches.length ? 'border-gray-700 text-gray-500' : 'border-transparent text-white hover:brightness-110'}`}
               >
                 Next &gt;
               </button>
             </div>
             <div className="text-gray-500 text-sm">
               Showing {displayedPunches.length} visible rows
             </div>
          </div>

        </div>
      </main>
    </div>
  );
}