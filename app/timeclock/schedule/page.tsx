"use client";

// ============================================================================
// 1. IMPORTS & INTERFACES
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "../../../utils/supabase";
import { useRouter } from "next/navigation";

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
}

// --- TIMEZONE HELPERS ---
const getStoreTimezone = (province: string, isAllStores: boolean) => {
    if (isAllStores) return Intl.DateTimeFormat().resolvedOptions().timeZone; // Fallback to browser time
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

const getZonedDateStr = (utcDate: Date, timeZone: string) => {
    try {
        const localStr = utcDate.toLocaleString('en-US', { timeZone });
        const localDate = new Date(localStr);
        const yyyy = localDate.getFullYear();
        const mm = String(localDate.getMonth() + 1).padStart(2, '0');
        const dd = String(localDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch {
        return utcDate.toISOString().split('T')[0];
    }
};

const getZonedTime = (utcDate: Date, timeZone: string) => {
  try { return new Date(utcDate.toLocaleString('en-US', { timeZone })); } 
  catch { return new Date(utcDate.toLocaleString('en-US')); }
};

// Date Parsing Helper for Schedule Logic (Applies the Offset Rule calculation)
const parseShiftDateTime = (dateStr: string, timeStr: string, timeZone: string) => {
  if (!timeStr) return new Date();
  try {
    const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return new Date();
    let [ , hours, mins, ampm ] = match;
    let h = parseInt(hours, 10);
    const m = parseInt(mins, 10);
    if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
    
    const [yyyy, month, day] = dateStr.split('-').map(Number);
    const testLocal = new Date(yyyy, month - 1, day, h, m, 0);
    
    const zonedBase = getZonedTime(testLocal, timeZone);
    const offsetMs = zonedBase.getTime() - testLocal.getTime();
    return new Date(testLocal.getTime() - offsetMs); // Returns Absolute UTC Time of the Shift
  } catch {
    return new Date();
  }
};

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function TimeClockSchedule() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  const [themeColor, setThemeColor] = useState("#00A023");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [myEmpIds, setMyEmpIds] = useState<string[]>([]); // ADD THIS LINE
  const [storeId, setStoreId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>(""); 
  const [storeTimezone, setStoreTimezone] = useState<string>("America/Toronto");

  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth()); // 0-11
  
  const [scheduleData, setScheduleData] = useState<any[]>([]);
  const [schedulePunches, setSchedulePunches] = useState<any[]>([]);
  const [scheduleEmployees, setScheduleEmployees] = useState<Record<string, string>>({});

  // ============================================================================
  // 3. DATA FETCHING
  // ============================================================================
  
  const loadScheduleData = async (comp_id: string, s_id: string) => {
    try {
      let empsQuery = supabase.from('employees').select('id, first_name, last_name').eq('company_id', comp_id).eq('status', 'Active');
      if (s_id && s_id !== "ALL_STORES") empsQuery = empsQuery.eq('store_id', s_id);
      
      const { data: emps } = await empsQuery;

      const empMap: Record<string, string> = {};
      if (emps) {
        emps.forEach(e => empMap[e.id] = `${e.first_name} ${e.last_name}`);
        setScheduleEmployees(empMap);
      }

      const startDt = new Date(viewYear, viewMonth, 1);
      const endDt = new Date(viewYear, viewMonth + 1, 0);
      
      // OFFSET RULE: Padded window
      const paddedStartDt = new Date(startDt); paddedStartDt.setDate(paddedStartDt.getDate() - 3);
      const paddedEndDt = new Date(endDt); paddedEndDt.setDate(paddedEndDt.getDate() + 3);

      const startStr = getZonedDateStr(paddedStartDt, storeTimezone);
      const endStr = getZonedDateStr(paddedEndDt, storeTimezone);

      let shiftsQuery = supabase.from('schedules').select('*').eq('company_id', comp_id).gte('date', startStr).lte('date', endStr);
      if (s_id && s_id !== "ALL_STORES") shiftsQuery = shiftsQuery.eq('store_id', s_id);
      
      const { data: shifts } = await shiftsQuery;
      setScheduleData(shifts || []);

      const startUtcIso = paddedStartDt.toISOString();
      const endUtcIso = paddedEndDt.toISOString();

      let punchesQuery = supabase.from('time_punches').select('employee_id, clock_in').eq('company_id', comp_id).gte('clock_in', startUtcIso).lte('clock_in', endUtcIso);
      if (s_id && s_id !== "ALL_STORES") punchesQuery = punchesQuery.eq('store_id', s_id);
      
      const { data: punches } = await punchesQuery;
      setSchedulePunches(punches || []);
    } catch (err) {
      console.error("Error loading schedule:", err);
    }
  };

  useEffect(() => {
    const initializePage = async () => {
      const cachedColor = localStorage.getItem('chronara_theme_color');
      if (cachedColor) setThemeColor(cachedColor);

      const cachedStore = localStorage.getItem('chronara_last_store');
      let currentStoreId = cachedStore || "";
      setStoreId(currentStoreId);

      const cachedUserStr = localStorage.getItem('chronara_web_user');
      if (!cachedUserStr) {
        router.push("/timeclock");
        return;
      }
      const user = JSON.parse(cachedUserStr);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/timeclock");
        return;
      }

      let currentCompanyId = "";

      try {
        const { data: companies } = await supabase
          .from('companies')
          .select('id')
          .or(`email.eq.${session.user.email},owner_email.eq.${session.user.email}`)
          .limit(1);

        if (companies && companies.length > 0) {
          currentCompanyId = companies[0].id;
          setCompanyId(currentCompanyId); 
        }

        // --- NEW: Remove limit(1) and store ALL linked profile IDs ---
        const { data: empData } = await supabase
          .from('employees')
          .select('id, first_name, last_name') 
          .eq('user_id', user.id);

        if (empData && empData.length > 0) {
          setEmployee(empData[0]);
          setMyEmpIds(empData.map(e => e.id)); 
        }
        // -------------------------------------------------------------

        // --- FETCH STORE TIMEZONE ---
        let fetchedTz = "America/Toronto";
        if (currentStoreId && currentStoreId !== "ALL_STORES") {
            const { data: storeInfo } = await supabase.from('stores').select('province').eq('id', currentStoreId).single();
            if (storeInfo && storeInfo.province) {
                fetchedTz = getStoreTimezone(storeInfo.province, false);
                setStoreTimezone(fetchedTz);
            }
        } else if (currentStoreId === "ALL_STORES") {
            fetchedTz = getStoreTimezone('', true);
            setStoreTimezone(fetchedTz);
        }

        if (currentCompanyId && currentStoreId) {
          await loadScheduleData(currentCompanyId, currentStoreId);
        }
      } catch (err) {
        console.error("Error fetching context:", err);
      }
      setIsReady(true);
    };

    initializePage();
  }, [router]);

  // Reload data if month/year changes
  useEffect(() => {
    if (isReady && companyId && storeId) {
      loadScheduleData(companyId, storeId);
    }
  }, [viewMonth, viewYear]);


  // ============================================================================
  // 4. UI HELPERS (Schedule Styling)
  // ============================================================================
  const getShiftStyle = (shift: any) => {
    const isMine = myEmpIds.includes(shift.employee_id);
    const defaultBg = isMine ? themeColor : "#333333";
    const defaultFg = isMine ? "white" : "#aaaaaa";
    
    // Check for Excused
    if (String(shift.is_excused) === "1" || String(shift.is_excused).toLowerCase() === "true") {
      return { bg: "#9B59B6", fg: "white" };
    }

    try {
      const shiftStartDt = parseShiftDateTime(shift.date, shift.start_time, storeTimezone);
      const shiftEndDt = parseShiftDateTime(shift.date, shift.end_time, storeTimezone);
      
      // Fix for overnight shifts (e.g. 10PM to 2AM)
      if (shiftEndDt.getTime() < shiftStartDt.getTime()) {
         shiftEndDt.setDate(shiftEndDt.getDate() + 1);
      }
      
      const empPunches = schedulePunches
        .map(p => {
            const safeClockIn = String(p.clock_in).replace("Z", "+00:00");
            const clockInUtc = new Date(safeClockIn);
            const localDateStr = getZonedDateStr(clockInUtc, storeTimezone);
            return { ...p, clockInUtc, localDateStr };
        })
        .filter(p => p.employee_id === shift.employee_id && p.localDateStr === shift.date)
        .sort((a, b) => a.clockInUtc.getTime() - b.clockInUtc.getTime());

      if (empPunches.length > 0) {
        const firstPunchDt = empPunches[0].clockInUtc; // Absolute UTC punch time
        if (firstPunchDt.getTime() > shiftStartDt.getTime() + (10 * 60000)) {
          return { bg: "#E0A800", fg: "white" }; // Late
        } else {
          return { bg: "#00A023", fg: "white" }; // On Time
        }
      } else {
        const nowUtc = new Date();
        if (nowUtc.getTime() > shiftEndDt.getTime()) {
          return { bg: "#C92C2C", fg: "white" }; // Missed
        }
      }
    } catch (e) {}

    // Default future shift style (Grey for coworkers, Theme Color for me)
    return { bg: defaultBg, fg: defaultFg };
  };

  const renderCalendar = () => {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    let firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const days = [];
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(<div key={`empty-${i}`} className="bg-[#1e1e1e] min-h-[120px] border border-gray-800 rounded-sm" />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      const dayShifts = scheduleData
        .filter(s => s.date === dateStr)
        .sort((a, b) => {
          // --- NEW: Prioritize the logged-in user to the top ---
          const aIsMine = myEmpIds.includes(a.employee_id);
          const bIsMine = myEmpIds.includes(b.employee_id);
          if (aIsMine && !bIsMine) return -1;
          if (!aIsMine && bIsMine) return 1;
          return 0;
        });

      days.push(
        <div key={`day-${d}`} className="bg-[#2a2a2a] min-h-[120px] border border-gray-800 flex flex-col rounded-sm p-1">
          <div className="text-left text-sm font-bold mb-1 ml-1" style={{ color: themeColor }}>
            {d}
          </div>
          <div className="space-y-1 pb-1">
            {dayShifts.map((s, idx) => {
              const style = getShiftStyle(s);
              const isMine = myEmpIds.includes(s.employee_id);
              const name = scheduleEmployees[s.employee_id] || "Unknown";
              return (
                <div key={idx} className="px-2 py-1 rounded text-[10px] sm:text-xs font-semibold" style={{ backgroundColor: style.bg, color: style.fg }}>
                  <div className="truncate">{name}</div>
                  <div className={isMine ? "font-bold" : "font-normal"}>
                    {s.start_time} - {s.end_time}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return days;
  };

  // ============================================================================
  // 5. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#181818]"></div>;

  return (
    <div className="flex h-screen bg-[#222222] text-white font-sans overflow-hidden">
      
      {/* --- NARROW SIDEBAR (w-[180px]) --- */}
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
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors bg-[#2a2a2a] text-gray-200"
              >
                Schedule
              </button>
              <button 
                onClick={() => router.push("/timeclock/timecards")}
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200"
              >
                My Timecards
              </button>
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800">
          <button 
            onClick={() => {
              localStorage.removeItem('chronara_web_user');
              router.push("/timeclock");
            }}
            className="w-full text-left px-2 py-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Workspace - NO HEADER, MAXIMUM VERTICAL SPACE */}
      <main className="flex-1 flex flex-col p-6 overflow-y-auto">
        <div className="bg-[#2b2b2b] rounded-xl p-6 flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
          
          {/* Schedule Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <h3 className="text-xl font-bold tracking-wide">
              {employee ? `${employee.first_name}'s Schedule` : "My Schedule"}
            </h3>
            
            <div className="flex flex-wrap items-center gap-4">
              {/* Legend */}
              <div className="flex items-center gap-3 text-xs font-bold mr-4 hidden md:flex">
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-[#00A023] rounded-sm"></div> On Time</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-[#E0A800] rounded-sm"></div> Late</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-[#C92C2C] rounded-sm"></div> Missed</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-[#9B59B6] rounded-sm"></div> Excused</span>
              </div>

              {/* Month/Year Controls */}
              <select 
                value={viewMonth} 
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="bg-[#1e1e1e] border border-gray-700 text-white rounded p-2 text-sm font-semibold outline-none"
              >
                {Array.from({ length: 12 }).map((_, i) => {
                  const date = new Date(2000, i, 1);
                  return <option key={i} value={i}>{date.toLocaleString('default', { month: 'long' })}</option>
                })}
              </select>

              <select 
                value={viewYear} 
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="bg-[#1e1e1e] border border-gray-700 text-white rounded p-2 text-sm font-semibold outline-none"
              >
                {Array.from({ length: 11 }).map((_, i) => {
                  const yr = new Date().getFullYear() - 5 + i;
                  return <option key={yr} value={yr}>{yr}</option>
                })}
              </select>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e] rounded-lg overflow-hidden border border-gray-800">
            <div className="grid grid-cols-7 bg-[#222222] border-b border-gray-800 shrink-0">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                <div key={day} className="text-center py-3 text-sm font-bold text-gray-300">
                  {day}
                </div>
              ))}
            </div>
            
            <div className="flex-1 overflow-y-auto p-1 scrollbar-hide">
              {/* Swapped h-full to min-h-full to allow grid expansion */}
              <div className="grid grid-cols-7 gap-1 min-h-full">
                {renderCalendar()}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
