"use client";

// ============================================================================
// 1. IMPORTS & INTERFACES
// ============================================================================
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../../utils/supabase";
import { useRouter, usePathname } from "next/navigation";

interface User {
  id: string;
  username: string;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  company_id: string;
  store_id?: string; // <--- ADD THIS
}

interface FeedbackModal {
  type: "success" | "error" | "welcome" | "info";
  title: string;
  message: string;
  subMessage?: string;
}

interface TimeOffRequest {
  id: string;
  start_date: string;
  end_date: string;
  type: string;
  status: string;
  employee_notes: string;
}

const formatDuration = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `Duration: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getLocalIsoString = () => {
  const now = new Date();
  const tzoffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzoffset).toISOString().slice(0, -1);
};

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function TimeClockDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const [themeColor, setThemeColor] = useState("#00A023");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employeeData, setEmployeeData] = useState<Employee[]>([]); // <--- NEW: Stores all linked profiles
  const [storeId, setStoreId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>(""); 

  const [status, setStatus] = useState<"CLOCKED_OUT" | "CLOCKED_IN" | "ON_BREAK">("CLOCKED_OUT");
  const [activePunchId, setActivePunchId] = useState<string | null>(null);
  const [activePunchTime, setActivePunchTime] = useState<Date | null>(null);
  const [activeBreakId, setActiveBreakId] = useState<string | null>(null);
  const [activeBreakTime, setActiveBreakTime] = useState<Date | null>(null);
  const [duration, setDuration] = useState("Duration: --:--:--");

  const [showBreakModal, setShowBreakModal] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModal | null>(null);

  // --- TIME OFF STATES ---
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [toStart, setToStart] = useState("");
  const [toEnd, setToEnd] = useState("");
  const [toType, setToType] = useState("Vacation");
  const [toNotes, setToNotes] = useState("");

  // --- AUTO LOGOUT STATES ---
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(false);

  const [stats, setStats] = useState({
    streak: 0,
    periodHours: 0,
    monthHours: 0,
    lifetimeHours: 0,
    lifetimeDays: 0,
    nextShift: "No upcoming shifts",
    periodTitle: "Hours this Period"
  });

  // ============================================================================
  // 3. DATA FETCHING & MATH
  // ============================================================================
  const fetchTimeOffs = async (empIds: string[]) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('time_off_requests')
        .select('*')
        .in('employee_id', empIds)
        .in('status', ['Approved', 'Pending', 'Rejected']) 
        .gte('end_date', todayStr)
        .order('start_date', { ascending: true });
        
      if (data) setTimeOffRequests(data);
    } catch (err) {
      console.error("Error fetching time off:", err);
    }
  };

  const loadPerformanceStats = async (empIds: string[], currentCompanyId: string, currentStoreId: string) => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let payPeriodStart = new Date(today);
      payPeriodStart.setDate(today.getDate() - today.getDay()); 
      let payPeriodEnd = new Date(payPeriodStart);
      payPeriodEnd.setDate(payPeriodStart.getDate() + 6); 
      
      let freq = "weekly";
      let firstStartStr = "";
      
      if (currentCompanyId) {
         const { data: comp } = await supabase.from('companies').select('config_json').eq('id', currentCompanyId).single();
         if (comp && comp.config_json) {
             try {
                 const conf = JSON.parse(comp.config_json);
                 freq = (conf.pay_frequency || "weekly").toLowerCase();
                 firstStartStr = conf.first_period_start || "";
             } catch (e) {}
         }
      }
      
      if (freq === "monthly") {
          payPeriodStart = new Date(today.getFullYear(), today.getMonth(), 1);
          payPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      } else if (freq === "semimonthly") {
          if (today.getDate() <= 15) {
              payPeriodStart = new Date(today.getFullYear(), today.getMonth(), 1);
              payPeriodEnd = new Date(today.getFullYear(), today.getMonth(), 15);
          } else {
              payPeriodStart = new Date(today.getFullYear(), today.getMonth(), 16);
              payPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          }
      } else if (firstStartStr) {
          const firstStart = new Date(firstStartStr + 'T00:00:00');
          const diffTime = today.getTime() - firstStart.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          
          let cycleDays = 7;
          if (freq === "biweekly" || freq === "bi-weekly") cycleDays = 14;
          
          if (diffDays >= 0) {
              const daysIntoPeriod = diffDays % cycleDays;
              payPeriodStart = new Date(today);
              payPeriodStart.setDate(today.getDate() - daysIntoPeriod);
              payPeriodEnd = new Date(payPeriodStart);
              payPeriodEnd.setDate(payPeriodStart.getDate() + cycleDays - 1);
          } else {
              const daysBefore = Math.abs(diffDays) % cycleDays;
              if (daysBefore === 0) {
                  payPeriodStart = new Date(today);
              } else {
                  payPeriodStart = new Date(today);
                  payPeriodStart.setDate(today.getDate() - (cycleDays - daysBefore));
              }
              payPeriodEnd = new Date(payPeriodStart);
              payPeriodEnd.setDate(payPeriodStart.getDate() + cycleDays - 1);
          }
      }

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      
      const formatDateStr = (d: Date) => {
          const tzoffset = d.getTimezoneOffset() * 60000;
          return new Date(d.getTime() - tzoffset).toISOString().split('T')[0];
      };

      const periodStartStr = formatDateStr(payPeriodStart) + "T00:00:00";
      const periodEndStr = formatDateStr(payPeriodEnd) + "T23:59:59";
      const monthStartStr = formatDateStr(startOfMonth) + "T00:00:00";
      const monthEndStr = formatDateStr(endOfMonth) + "T23:59:59";

      // --- ISOLATE MATH BY STORE ---
      let punchQuery = supabase.from('time_punches')
          .select('id, clock_in, clock_out, employee_id')
          .in('employee_id', empIds);
      
      if (currentStoreId && currentStoreId !== "ALL_STORES") {
          punchQuery = punchQuery.eq('store_id', currentStoreId);
      }
          
      const { data: allPunches } = await punchQuery;
          
      const punchIds = allPunches?.map(p => p.id) || [];
      const { data: allBreaks } = await supabase.from('time_punch_breaks')
          .select('punch_id, break_start, break_end, break_type')
          .in('punch_id', punchIds)
          .eq('break_type', 'Unpaid');

      let schedQuery = supabase.from('schedules').select('employee_id, date').in('employee_id', empIds);
      if (currentStoreId && currentStoreId !== "ALL_STORES") {
          schedQuery = schedQuery.eq('store_id', currentStoreId);
      }
      const { data: schedData } = await schedQuery;
      const schedSet = new Set(schedData?.map(s => `${s.employee_id}_${s.date}`));

      let minPayActive = false;
      let minPayHours = 3.0;

      if (currentStoreId) {
          const { data: sSetData } = await supabase.from('store_time_clock_settings').select('min_reporting_pay, min_reporting_hours').eq('store_id', currentStoreId).limit(1);
          if (sSetData && sSetData.length > 0) {
              const sSet = sSetData[0];
              minPayActive = sSet.min_reporting_pay === 1 || String(sSet.min_reporting_pay).toLowerCase() === "true";
              minPayHours = parseFloat(sSet.min_reporting_hours || "3.0");
          }
      }

      const calcNetHours = (punches: any[], breaks: any[]) => {
          let totalSec = 0;
          punches.forEach(p => {
              if (p.clock_out) {
                  try {
                      let tIn = new Date(p.clock_in);
                      let tOut = new Date(p.clock_out);
                      
                      const grossSec = (tOut.getTime() - tIn.getTime()) / 1000.0;
                      
                      const pBreaks = (breaks || []).filter(b => b.punch_id === p.id && b.break_end);
                      let breakSec = 0;
                      pBreaks.forEach(b => {
                          try {
                              let bS = new Date(b.break_start);
                              let bE = new Date(b.break_end);
                              breakSec += (bE.getTime() - bS.getTime()) / 1000.0;
                          } catch (e) {}
                      });
                      
                      let netHours = Math.max(0, grossSec - breakSec) / 3600.0;
                      
                      if (minPayActive && netHours > 0 && netHours < minPayHours) {
                          const tzoffset = tIn.getTimezoneOffset() * 60000;
                          const localDateStr = new Date(tIn.getTime() - tzoffset).toISOString().split('T')[0];
                          if (schedSet.has(`${p.employee_id}_${localDateStr}`)) {
                              netHours = minPayHours;
                          }
                      }
                      
                      totalSec += netHours * 3600.0;
                  } catch (e) {}
              }
          });
          return totalSec / 3600.0;
      };

      const periodPunches = (allPunches || []).filter(p => p.clock_in >= periodStartStr && p.clock_in <= periodEndStr);
      const monthPunches = (allPunches || []).filter(p => p.clock_in >= monthStartStr && p.clock_in <= monthEndStr);
      
      const periodHrs = calcNetHours(periodPunches, allBreaks || []);
      const monthHrs = calcNetHours(monthPunches, allBreaks || []);
      const lifetimeHrs = calcNetHours(allPunches || [], allBreaks || []);
      const lifetimeDays = lifetimeHrs / 24.0;

      const dailyHours: { [key: string]: number } = {};
      for (let i = 14; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          dailyHours[formatDateStr(d)] = 0.0;
      }

      Object.keys(dailyHours).forEach(dStr => {
          const dayPunches = (allPunches || []).filter(p => p.clock_in.startsWith(dStr));
          dailyHours[dStr] = calcNetHours(dayPunches, allBreaks || []);
      });

      let streak = 0;
      let checkDate = new Date(today);
      if (dailyHours[formatDateStr(checkDate)] === 0) {
          checkDate.setDate(checkDate.getDate() - 1);
      }
      
      while (dailyHours[formatDateStr(checkDate)] > 0) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
      }

      let nextShiftStr = "No upcoming shifts";
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      let nextSchedQuery = supabase.from('schedules')
          .select('date, start_time, end_time')
          .in('employee_id', empIds)
          .gte('date', formatDateStr(today))
          .order('date', { ascending: true })
          .order('start_time', { ascending: true });
          
      if (currentStoreId && currentStoreId !== "ALL_STORES") {
          nextSchedQuery = nextSchedQuery.eq('store_id', currentStoreId);
      }
      const { data: nextScheds } = await nextSchedQuery.limit(5);

      if (nextScheds && nextScheds.length > 0) {
          let validShift = null;
          const todayStr = formatDateStr(today);
          const hasWorkedToday = (allPunches || []).some(p => p.clock_in.startsWith(todayStr));
          const nowMs = now.getTime();

          const parseTime = (dateStr: string, timeStr: string) => {
              if (!timeStr) return null;
              const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
              if (!match) return null;
              let [ , hours, mins, ampm ] = match;
              let h = parseInt(hours, 10);
              const m = parseInt(mins, 10);
              if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
              if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
              
              const dt = new Date(dateStr + 'T00:00:00');
              dt.setHours(h, m, 0, 0);
              return dt.getTime();
          };

          for (const s of nextScheds) {
              if (s.date === todayStr) {
                  if (hasWorkedToday) continue;
                  
                  if (s.end_time) {
                      const endMs = parseTime(s.date, s.end_time);
                      if (endMs && nowMs > endMs) continue;
                  }
              }
              validShift = s;
              break;
          }

          if (validShift) {
              const s = validShift;
              const shiftDate = new Date(s.date + 'T00:00:00');
              const monthName = shiftDate.toLocaleString('default', { month: 'short' });
              const dayNum = shiftDate.getDate();
              
              if (s.date === todayStr) {
                  nextShiftStr = `Today\n${s.start_time} - ${s.end_time || '?'}`;
              } else if (s.date === formatDateStr(tomorrow)) {
                  nextShiftStr = `Tomorrow\n${s.start_time} - ${s.end_time || '?'}`;
              } else {
                  nextShiftStr = `${shiftDate.toLocaleDateString('en-US', { weekday: 'short' })}, ${monthName} ${dayNum}\n${s.start_time} - ${s.end_time || '?'}`;
              }
          }
      }

      const formatTitleDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const periodTitle = `Hours this Period - ${formatTitleDate(payPeriodStart)} - ${formatTitleDate(payPeriodEnd)}`;

      setStats({
          streak,
          periodHours: periodHrs,
          monthHours: monthHrs,
          lifetimeHours: lifetimeHrs,
          lifetimeDays: lifetimeDays,
          nextShift: nextShiftStr,
          periodTitle: periodTitle
      });

    } catch (err) {
      console.error("Error loading performance stats:", err);
    }
  };

  const refreshStatus = async (empIds: string[], currentCompanyId: string, currentStoreId: string) => {
    try {
      let punchQ = supabase.from('time_punches')
        .select('*')
        .in('employee_id', empIds);
        
      if (currentStoreId && currentStoreId !== "ALL_STORES") {
          punchQ = punchQ.eq('store_id', currentStoreId);
      }
      
      const { data: punches } = await punchQ.order('clock_in', { ascending: false }).limit(1);

      if (punches && punches.length > 0) {
        const punch = punches[0];
        if (!punch.clock_out) {
          
          let autoClockedOut = false;
          
          // --- AUTO CLOCK OUT LOGIC ---
          try {
            const clockInDt = new Date(punch.clock_in);
            const activeStoreId = punch.store_id || currentStoreId;
            const { data: settingsData } = await supabase.from('store_time_clock_settings')
              .select('auto_clock_out, auto_clock_out_mins')
              .eq('store_id', activeStoreId).limit(1);

            const s = settingsData?.[0];
            const autoOutEnabled = s?.auto_clock_out === 1 || s?.auto_clock_out === true || String(s?.auto_clock_out).toLowerCase() === "true" || String(s?.auto_clock_out).toLowerCase() === "1";
            const bufferMins = parseInt(s?.auto_clock_out_mins as string, 10) || 0;

            if (autoOutEnabled) {
              const tzoffset = clockInDt.getTimezoneOffset() * 60000;
              const dateStr = new Date(clockInDt.getTime() - tzoffset).toISOString().split('T')[0];

              let schedQ = supabase.from('schedules')
                  .select('end_time')
                  .in('employee_id', empIds)
                  .eq('date', dateStr);
              if (activeStoreId && activeStoreId !== "ALL_STORES") {
                  schedQ = schedQ.eq('store_id', activeStoreId);
              }
              const { data: schedData } = await schedQ.limit(1);
              
              const shift = schedData?.[0];
              let autoClockOutTime: Date | null = null;
              const now = new Date();

              if (shift && shift.end_time) {
                  const match = shift.end_time.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
                  if (match) {
                      let [ , hours, mins, ampm ] = match;
                      let h = parseInt(hours, 10);
                      const m = parseInt(mins, 10);
                      if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
                      if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
                      
                      const shiftEndDt = new Date(clockInDt);
                      shiftEndDt.setHours(h, m, 0, 0);

                      if (shiftEndDt < clockInDt) {
                          shiftEndDt.setDate(shiftEndDt.getDate() + 1);
                      }

                      const bufferDt = new Date(shiftEndDt.getTime() + bufferMins * 60000);
                      if (now >= bufferDt) {
                          autoClockOutTime = shiftEndDt;
                      }
                  }
              } 
              
              if (!autoClockOutTime) {
                  const maxDuration = new Date(clockInDt.getTime() + 14 * 3600000); // 14 hours fallback
                  if (now >= maxDuration) {
                      autoClockOutTime = maxDuration;
                  }
              }

              if (autoClockOutTime) {
                  const tzoffset2 = autoClockOutTime.getTimezoneOffset() * 60000;
                  const outIso = new Date(autoClockOutTime.getTime() - tzoffset2).toISOString().slice(0, -1);

                  await supabase.from('time_punches')
                      .update({ 
                          clock_out: outIso, 
                          status: 'Pending Edit', 
                          req_notes: 'SYSTEM: Auto-Clocked Out (Forgot to punch)' 
                      })
                      .eq('id', punch.id);
                  
                  await supabase.from('time_punch_breaks')
                      .update({ break_end: outIso })
                      .eq('punch_id', punch.id)
                      .or('break_end.is.null,break_end.eq.""');
                  
                  autoClockedOut = true;
              }
            }
          } catch (err) {
            console.error("Auto clock out check error:", err);
          }
          // --- END AUTO CLOCK OUT LOGIC ---

          if (autoClockedOut) {
            setStatus("CLOCKED_OUT");
            setActivePunchId(null);
            setActivePunchTime(null);
            setActiveBreakId(null);
            setActiveBreakTime(null);
          } else {
            setActivePunchId(punch.id);
            setActivePunchTime(new Date(punch.clock_in));

            const { data: breaks } = await supabase
              .from('time_punch_breaks')
              .select('*')
              .eq('punch_id', punch.id)
              .order('break_start', { ascending: false })
              .limit(1);

            if (breaks && breaks.length > 0 && !breaks[0].break_end) {
              setActiveBreakId(breaks[0].id);
              setActiveBreakTime(new Date(breaks[0].break_start));
              setStatus("ON_BREAK");
            } else {
              setActiveBreakId(null);
              setActiveBreakTime(null);
              setStatus("CLOCKED_IN");
            }
          }
        } else {
          setStatus("CLOCKED_OUT");
          setActivePunchId(null);
          setActivePunchTime(null);
          setActiveBreakId(null);
          setActiveBreakTime(null);
        }
      } else {
        setStatus("CLOCKED_OUT");
      }

      await loadPerformanceStats(empIds, currentCompanyId, currentStoreId);
      await fetchTimeOffs(empIds);
    } catch (err) {
      console.error("Error refreshing status:", err);
    }
  };

  useEffect(() => {
    const initializeDashboard = async () => {
      const cachedColor = localStorage.getItem('chronara_theme_color');
      if (cachedColor) setThemeColor(cachedColor);

      const cachedStore = localStorage.getItem('chronara_last_store') || "";
      if (cachedStore) setStoreId(cachedStore);

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
        const { data: companies } = await supabase
          .from('companies')
          .select('id')
          .or(`email.eq.${session.user.email},owner_email.eq.${session.user.email}`)
          .limit(1);

        let activeCompanyId = "";
        if (companies && companies.length > 0) {
          activeCompanyId = companies[0].id;
          setCompanyId(activeCompanyId); 
        }

        const { data: empData } = await supabase
          .from('employees')
          .select('id, first_name, last_name, company_id, store_id') 
          .eq('user_id', user.id);

        if (empData && empData.length > 0) {
          setEmployeeData(empData);
          const targetEmp = empData.find(e => e.store_id === cachedStore) || empData[0];
          setEmployee(targetEmp);
          
          const empIds = empData.map(e => e.id);
          await refreshStatus(empIds, activeCompanyId, cachedStore);
        }

        // --- FETCH AUTO LOGOUT SETTINGS ---
        if (cachedStore) {
          const { data: settingsData } = await supabase
            .from('store_time_clock_settings')
            .select('*')
            .eq('store_id', cachedStore)
            .limit(1);
            
          if (settingsData && settingsData.length > 0) {
            const s = settingsData[0];
            const autoOut = s.auto_logout || s.auto_signout || s.enforce_auto_logout;
            if (autoOut === 1 || autoOut === true || String(autoOut).toLowerCase() === "true" || String(autoOut).toLowerCase() === "1") {
              setAutoLogoutEnabled(true);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching context:", err);
      }

      setIsReady(true);
    };

    initializeDashboard();
  }, [router]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      if (status === "ON_BREAK" && activeBreakTime) {
        const diff = Math.max(0, Math.floor((now.getTime() - activeBreakTime.getTime()) / 1000));
        setDuration(formatDuration(diff));
      } else if (status === "CLOCKED_IN" && activePunchTime) {
        const diff = Math.max(0, Math.floor((now.getTime() - activePunchTime.getTime()) / 1000));
        setDuration(formatDuration(diff));
      } else {
        setDuration("Duration: --:--:--");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status, activeBreakTime, activePunchTime]);

  useEffect(() => {
    if (!employeeData || employeeData.length === 0) return;
    const syncTimer = setInterval(() => {
      const empIds = employeeData.map(e => e.id);
      refreshStatus(empIds, companyId, storeId);
    }, 10000);
    return () => clearInterval(syncTimer);
  }, [employeeData, companyId, storeId]);

  // ============================================================================
  // AUTO-LOGOUT INACTIVITY TRACKER
  // ============================================================================
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
  // 4. ACTION HANDLERS (Database Writes)
  // ============================================================================
  const handleClockIn = async () => {
    if (!employee) return;
    if (!companyId) {
      setFeedbackModal({ type: "error", title: "System Error", message: "Company ID is missing. Please refresh the page." });
      return;
    }
    
    try {
      // --- PREVENT EARLY CLOCK IN & ROUNDING LOGIC ---
      const { data: settingsData } = await supabase
        .from('store_time_clock_settings')
        .select('enforce_schedule, early_clock_in_mins, round_time_punches, rounding_increment_mins, clock_in_message')
        .eq('store_id', storeId)
        .limit(1);

      const settings = settingsData?.[0];
      const enforce = settings?.enforce_schedule === 1 || settings?.enforce_schedule === true || String(settings?.enforce_schedule).toLowerCase() === "true" || String(settings?.enforce_schedule).toLowerCase() === "1";
      const earlyMins = settings?.early_clock_in_mins ? parseInt(settings.early_clock_in_mins as string, 10) : 10;

      let appliedRoundingMins = 0;
      const isRounded = settings?.round_time_punches === 1 || settings?.round_time_punches === true || String(settings?.round_time_punches).toLowerCase() === "true" || String(settings?.round_time_punches).toLowerCase() === "1";
      if (isRounded && settings?.rounding_increment_mins) {
        appliedRoundingMins = parseInt(settings.rounding_increment_mins as string, 10) || 0;
      }

      if (enforce) {
        const now = new Date();
        const tzoffset = now.getTimezoneOffset() * 60000;
        const todayStr = new Date(now.getTime() - tzoffset).toISOString().split('T')[0];

        const { data: shifts } = await supabase
          .from('schedules')
          .select('start_time, end_time')
          .eq('employee_id', employee.id)
          .eq('date', todayStr)
          .order('start_time', { ascending: true });

        if (!shifts || shifts.length === 0) {
          setFeedbackModal({
            type: "error",
            title: "Not Scheduled",
            message: "You are not scheduled to work today.",
            subMessage: "Please speak with a manager to clock in."
          });
          return;
        }

        let allowed = false;
        let nextShiftDt: Date | null = null;

        const parseTimeStr = (timeStr: string, baseDate = new Date()) => {
          if (!timeStr) return null;
          const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (!match) return null;
          let [ , hours, mins, ampm ] = match;
          let h = parseInt(hours, 10);
          const m = parseInt(mins, 10);
          if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
          if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
          
          const dt = new Date(baseDate);
          dt.setHours(h, m, 0, 0);
          return dt;
        };

        for (const s of shifts) {
          if (!s.start_time) continue;
          
          const shiftStartDt = parseTimeStr(s.start_time, now);
          if (!shiftStartDt) continue;

          const earliestAllowed = new Date(shiftStartDt.getTime() - (earlyMins * 60000));
          let shiftEndDt = parseTimeStr(s.end_time || "", now);
          
          if (shiftEndDt) {
            if (shiftEndDt < shiftStartDt) {
              shiftEndDt.setDate(shiftEndDt.getDate() + 1);
            }
          } else {
            shiftEndDt = new Date(shiftStartDt.getTime() + (12 * 3600000)); // Fallback +12 hours
          }

          if (now >= earliestAllowed && now <= shiftEndDt) {
            allowed = true;
            break;
          } else if (now < earliestAllowed) {
            if (!nextShiftDt || shiftStartDt < nextShiftDt) {
              nextShiftDt = shiftStartDt;
            }
          }
        }

        if (!allowed) {
          if (nextShiftDt) {
            const friendlyTime = nextShiftDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            setFeedbackModal({
                type: "error",
                title: "Too Early",
                message: `You are scheduled at ${friendlyTime}.`,
                subMessage: `You cannot clock in more than ${earlyMins} minutes early.`
            });
          } else {
            setFeedbackModal({
                type: "error",
                title: "Shift Missed",
                message: "You do not have an applicable shift right now.",
                subMessage: "Your scheduled time has already passed."
            });
          }
          return;
        }
      }

      const punchId = `tck_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
      const nowIso = getLocalIsoString();

      const { error: err1 } = await supabase.from('time_punches').insert({
        id: punchId,
        company_id: companyId,
        employee_id: employee.id,
        store_id: storeId || null,
        clock_in: nowIso,
        type: "Regular",
        status: "Approved",
        applied_rounding_mins: appliedRoundingMins
      });

      if (err1) {
        const { error: err2 } = await supabase.from('time_punches').insert({
          id: punchId,
          company_id: companyId,
          employee_id: employee.id,
          store_id: storeId || null,
          clock_in: nowIso,
          type: "Regular",
          status: "Approved"
        });

        if (err2) {
          const { error: err3 } = await supabase.from('time_punches').insert({
            id: punchId,
            company_id: companyId,
            employee_id: employee.id,
            clock_in: nowIso,
            type: "Regular",
            status: "Approved"
          });
          if (err3) throw err3;
        }
      }
      
      // --- CLOCK IN MESSAGE LOGIC ---
      let displayMsg = "Welcome, {name}!";
      try {
        const { data: empData } = await supabase.from('employees').select('first_name, next_clock_in_message').eq('id', employee.id).single();
        
        if (settings?.clock_in_message && settings.clock_in_message.trim() !== "") {
          displayMsg = settings.clock_in_message;
        } else {
          const { data: compData } = await supabase.from('companies').select('config_json').eq('id', companyId).single();
          if (compData && compData.config_json) {
            try {
              const config = JSON.parse(compData.config_json);
              if (config.default_clock_in_message) displayMsg = config.default_clock_in_message;
            } catch (e) {}
          }
        }

        if (empData?.next_clock_in_message && empData.next_clock_in_message.trim() !== "") {
          displayMsg = empData.next_clock_in_message;
          await supabase.from('employees').update({ next_clock_in_message: "" }).eq('id', employee.id);
        } else {
          displayMsg = displayMsg.replace(/{name}/g, empData?.first_name || "Employee");
        }
      } catch (msgErr) {
        console.error("Error fetching welcome message:", msgErr);
      }

      setFeedbackModal({
          type: "welcome",
          title: "Clocked In Successfully",
          message: displayMsg,
          subMessage: `Clocked IN at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      });
      
      const empIds = employeeData.map(e => e.id);
      await refreshStatus(empIds, companyId, storeId);
    } catch (err: any) {
      const errorString = JSON.stringify(err);
      if (err.code === '23505' || errorString.includes('duplicate') || errorString.includes('one_active_shift')) {
        setFeedbackModal({
            type: "info",
            title: "Already Clocked In",
            message: "You are already clocked in! Your status has been refreshed.",
        });
        const empIds = employeeData.map(e => e.id);
        await refreshStatus(empIds, companyId, storeId);
      } else {
        setFeedbackModal({ type: "error", title: "Error", message: "Error clocking in. Please try again." });
      }
    }
  };

  const handleClockOut = async () => {
    if (!activePunchId || !employee) return;
    let nowIso = getLocalIsoString();

    try {
      // --- MINIMUM REPORTING PAY & ROUNDING LOGIC ---
      const { data: punchData } = await supabase.from('time_punches').select('clock_in, store_id').eq('id', activePunchId).single();
      
      if (punchData && punchData.clock_in) {
          let clockOutDt = new Date();
          const clockInDt = new Date(punchData.clock_in);
          const activeStoreId = punchData.store_id || storeId;

          const { data: settingsData } = await supabase.from('store_time_clock_settings')
            .select('min_reporting_pay, min_reporting_hours, round_time_punches, rounding_increment_mins')
            .eq('store_id', activeStoreId).limit(1);

          const s = settingsData?.[0];
          const minPayActive = s?.min_reporting_pay === 1 || s?.min_reporting_pay === true || String(s?.min_reporting_pay).toLowerCase() === "true" || String(s?.min_reporting_pay).toLowerCase() === "1";
          const minHrs = parseFloat(s?.min_reporting_hours as string) || 3.0;
          const isRounded = s?.round_time_punches === 1 || s?.round_time_punches === true || String(s?.round_time_punches).toLowerCase() === "true" || String(s?.round_time_punches).toLowerCase() === "1";
          const roundMins = parseInt(s?.rounding_increment_mins as string, 10) || 15;

          const roundDate = (dt: Date, rMins: number) => {
              if (rMins <= 0) return dt;
              const ms = 1000 * 60 * rMins;
              const discard = dt.getTime() % ms;
              let newTime = dt.getTime() - discard;
              if (discard >= ms / 2) newTime += ms;
              return new Date(newTime);
          };

          let grossSec = 0;
          if (isRounded && roundMins > 0) {
             const cInRounded = roundDate(clockInDt, roundMins);
             const cOutRounded = roundDate(clockOutDt, roundMins);
             grossSec = (cOutRounded.getTime() - cInRounded.getTime()) / 1000;
          } else {
             grossSec = (clockOutDt.getTime() - clockInDt.getTime()) / 1000;
          }

          const { data: breaksData } = await supabase.from('time_punch_breaks').select('break_start, break_end').eq('punch_id', activePunchId).eq('break_type', 'Unpaid');
          let breakSec = 0;
          if (breaksData) {
             for (const b of breaksData) {
                if (b.break_start) {
                   let bStart = new Date(b.break_start);
                   let bEnd = b.break_end ? new Date(b.break_end) : clockOutDt;
                   if (isRounded && roundMins > 0) {
                       bStart = roundDate(bStart, roundMins);
                       bEnd = roundDate(bEnd, roundMins);
                   }
                   breakSec += (bEnd.getTime() - bStart.getTime()) / 1000;
                }
             }
          }

          const netHours = Math.max(0, grossSec - breakSec) / 3600.0;

          if (minPayActive && netHours >= 0 && netHours < minHrs) {
              const tzoffset = clockInDt.getTimezoneOffset() * 60000;
              const dateStr = new Date(clockInDt.getTime() - tzoffset).toISOString().split('T')[0];
              
              const { data: schedData } = await supabase.from('schedules').select('id').eq('employee_id', employee.id).eq('date', dateStr).limit(1);
              
              if (schedData && schedData.length > 0) {
                  const paddedSec = breakSec + (minHrs * 3600.0);
                  const paddedOutDt = new Date(clockInDt.getTime() + (paddedSec * 1000));
                  const tzoffset2 = paddedOutDt.getTimezoneOffset() * 60000;
                  nowIso = new Date(paddedOutDt.getTime() - tzoffset2).toISOString().slice(0, -1);
              }
          }
      }
      // --- END MINIMUM REPORTING PAY LOGIC ---

      const { error } = await supabase.from('time_punches')
        .update({ clock_out: nowIso, status: 'Approved' })
        .eq('id', activePunchId);
      
      if (error) throw error;

      if (activeBreakId) {
        await supabase.from('time_punch_breaks')
          .update({ break_end: nowIso })
          .eq('id', activeBreakId);
      }

      setFeedbackModal({
          type: "success",
          title: "Shift Complete",
          message: "You have successfully clocked out. Have a great day!",
          subMessage: `Clocked OUT at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      });

      const empIds = employeeData.map(e => e.id);
      await refreshStatus(empIds, companyId, storeId);
    } catch (err: any) {
      setFeedbackModal({ type: "error", title: "Error", message: "Error Clocking Out. Please try again." });
    }
  };

  const executeStartBreak = async (breakType: "Paid" | "Unpaid") => {
    if (!activePunchId || !employee || !companyId) return;
    setShowBreakModal(false);

    const breakId = `tcb_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
    const nowIso = getLocalIsoString();

    try {
      const { error } = await supabase.from('time_punch_breaks').insert({
        id: breakId,
        company_id: companyId,
        punch_id: activePunchId,
        break_start: nowIso,
        break_type: breakType
      });

      if (error) throw error;

      setFeedbackModal({
          type: "info",
          title: "Break Started",
          message: `Enjoy your ${breakType} break!`,
          subMessage: `Started at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      });

      const empIds = employeeData.map(e => e.id);
      await refreshStatus(empIds, companyId, storeId);
    } catch (err: any) {
      const errorString = JSON.stringify(err);
      if (err.code === '23505' || errorString.includes('duplicate') || errorString.includes('one_active_break')) {
        setFeedbackModal({ type: "info", title: "Already on Break", message: "You are already on a break! Your status has been refreshed." });
        const empIds = employeeData.map(e => e.id);
        await refreshStatus(empIds, companyId, storeId);
      } else {
        setFeedbackModal({ type: "error", title: "Error", message: "Error starting break. Please try again." });
      }
    }
  };

  const handleEndBreak = async () => {
    if (!activeBreakId || !employee) return;
    const nowIso = getLocalIsoString();

    try {
      const { error } = await supabase.from('time_punch_breaks')
        .update({ break_end: nowIso })
        .eq('id', activeBreakId);

      if (error) throw error;

      setFeedbackModal({
          type: "success",
          title: "Break Ended",
          message: "Welcome back!",
          subMessage: `Ended at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      });

      const empIds = employeeData.map(e => e.id);
      await refreshStatus(empIds, companyId, storeId);
    } catch (err: any) {
      setFeedbackModal({ type: "error", title: "Error", message: "Error ending break. Please try again." });
    }
  };

  const handleTimeOffSubmit = async () => {
    if (!employee || !companyId) return;

    if (!toStart || !toEnd) {
      setFeedbackModal({ type: "error", title: "Missing Dates", message: "Both Start Date and End Date are required." });
      return;
    }

    if (new Date(toEnd) < new Date(toStart)) {
      setFeedbackModal({ type: "error", title: "Invalid Dates", message: "End Date cannot be before Start Date." });
      return;
    }

    const reqId = `tor_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

    try {
      const { error } = await supabase.from('time_off_requests').insert({
        id: reqId,
        company_id: companyId,
        employee_id: employee.id,
        start_date: toStart,
        end_date: toEnd,
        type: toType,
        status: 'Pending',
        employee_notes: toNotes.trim()
      });

      if (error) throw error;

      setFeedbackModal({ type: "success", title: "Success", message: "Time off request submitted to management." });
      setShowTimeOffModal(false);
      setToStart(""); 
      setToEnd(""); 
      setToType("Vacation"); 
      setToNotes("");
      
      const empIds = employeeData.map(e => e.id);
      await fetchTimeOffs(empIds);
    } catch (err) {
      setFeedbackModal({ type: "error", title: "Error", message: "Failed to submit time off request." });
    }
  };

  const handleDeleteTimeOff = async (reqId: string) => {
    try {
      await supabase.from('time_off_requests').delete().eq('id', reqId);
      const empIds = employeeData.map(e => e.id);
      if (empIds.length > 0) await fetchTimeOffs(empIds);
    } catch (err) {
      console.error("Error deleting time off request:", err);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('chronara_web_user');
    router.push("/timeclock");
  };



  // ============================================================================
  // 5. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#181818]"></div>;

  return (
    <div className="flex h-screen bg-[#222222] text-white font-sans overflow-hidden relative">
      
      {/* --- CUSTOM FEEDBACK MODAL --- */}
      {feedbackModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className={`border p-10 rounded-2xl shadow-2xl flex flex-col items-center text-center transform transition-all scale-100 ${
            feedbackModal.type === 'welcome' ? 'bg-[#1e293b] border-blue-500/30 w-full max-w-2xl' : 
            feedbackModal.type === 'error' ? 'bg-[#2b1b1b] border-red-500/30 w-full max-w-md' : 
            'bg-[#1b2b22] border-green-500/30 w-full max-w-md'
          }`}>
            
            {feedbackModal.type === 'welcome' && <div className="text-6xl mb-4 animate-bounce">👋</div>}
            {feedbackModal.type === 'error' && <div className="text-6xl mb-4">⚠️</div>}
            {feedbackModal.type === 'success' && <div className="text-6xl mb-4">✅</div>}
            {feedbackModal.type === 'info' && <div className="text-6xl mb-4">☕</div>}

            <h2 className={`${feedbackModal.type === 'welcome' ? 'text-4xl' : 'text-2xl'} font-extrabold text-white mb-4 leading-tight`}>
              {feedbackModal.type === 'welcome' ? feedbackModal.message : feedbackModal.title}
            </h2>
            
            <p className={`text-lg mb-6 ${feedbackModal.type === 'welcome' ? 'text-blue-200' : 'text-gray-300'}`}>
              {feedbackModal.type === 'welcome' ? feedbackModal.title : feedbackModal.message}
            </p>

            {feedbackModal.subMessage && (
              <div className="bg-black/40 px-6 py-4 rounded-xl border border-white/10 mb-8 w-full">
                <p className="text-gray-300 font-mono text-lg">{feedbackModal.subMessage}</p>
              </div>
            )}

            <button 
              onClick={() => setFeedbackModal(null)}
              style={{ backgroundColor: themeColor }}
              className="w-full max-w-[250px] py-4 rounded-xl text-xl font-bold hover:brightness-110 transition-all shadow-lg"
            >
              {feedbackModal.type === 'welcome' ? "Awesome, let's work!" : 
               feedbackModal.type === 'error' ? "Try Again" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* Break Modal */}
      {showBreakModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#2b2b2b] border border-gray-700 p-8 rounded-xl w-full max-w-md shadow-2xl flex flex-col items-center">
            <h3 className="text-2xl font-bold mb-2">Start a Break</h3>
            <p className="text-gray-400 mb-8">Is this a paid or unpaid break?</p>
            <div className="flex gap-4 w-full mb-6">
              <button 
                onClick={() => executeStartBreak("Paid")}
                style={{ backgroundColor: themeColor }}
                className="flex-1 py-6 rounded-lg text-lg font-bold hover:brightness-110 transition-all shadow-md"
              >
                Paid Break<br/><span className="text-sm font-normal opacity-80">(15 Min)</span>
              </button>
              <button 
                onClick={() => executeStartBreak("Unpaid")}
                className="flex-1 bg-[#DB8700] hover:bg-[#b26e00] py-6 rounded-lg text-lg font-bold transition-all shadow-md"
              >
                Unpaid Break<br/><span className="text-sm font-normal opacity-80">(30 Min Lunch)</span>
              </button>
            </div>
            <button 
              onClick={() => setShowBreakModal(false)}
              className="text-gray-400 hover:text-white border border-gray-600 px-8 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Time Off Modal */}
      {showTimeOffModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#2b2b2b] border border-gray-700 p-8 rounded-xl w-full max-w-md shadow-2xl flex flex-col">
            <h3 className="text-2xl font-bold mb-6" style={{ color: themeColor }}>Request Time Off</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-1">Start Date</label>
                <input 
                  type="date" 
                  value={toStart} 
                  onChange={e => setToStart(e.target.value)} 
                  className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-gray-500" 
                  style={{ colorScheme: 'dark' }} 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-1">End Date</label>
                <input 
                  type="date" 
                  value={toEnd} 
                  onChange={e => setToEnd(e.target.value)} 
                  className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-gray-500" 
                  style={{ colorScheme: 'dark' }} 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-1">Type</label>
                <select 
                  value={toType} 
                  onChange={e => setToType(e.target.value)} 
                  className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-gray-500"
                >
                  <option value="Vacation">Vacation</option>
                  <option value="Sick">Sick</option>
                  <option value="Unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-1">Notes</label>
                <textarea 
                  value={toNotes} 
                  onChange={e => setToNotes(e.target.value)} 
                  className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-gray-500 h-20 resize-none" 
                  placeholder="Add any notes..." 
                />
              </div>
            </div>

            <div className="flex justify-between mt-8">
              <button 
                onClick={() => setShowTimeOffModal(false)} 
                className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors font-semibold border border-gray-600 rounded"
              >
                Cancel
              </button>
              <button 
                onClick={handleTimeOffSubmit} 
                style={{ backgroundColor: themeColor }} 
                className="px-8 py-2.5 rounded text-white font-bold hover:brightness-110 shadow-lg transition-transform active:scale-95"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors bg-[#2a2a2a] text-gray-200"
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
                className="w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200"
              >
                My Timecards
              </button>
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800">
          <button 
            onClick={handleSignOut}
            className="w-full text-left px-2 py-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col p-8 overflow-y-auto">
        <header className="flex justify-between items-start mb-8 shrink-0">
          <div>
            <p className="text-gray-400 text-sm mb-1">Chronara Web</p>
            <h2 className="text-4xl font-semibold tracking-wide">
              Welcome, {employee ? employee.first_name : (currentUser ? currentUser.username : "Employee")}
            </h2>
          </div>
          <div className="text-right">
            <div className="text-[40px] font-light tracking-wider" style={{ color: themeColor }}>
              {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
            </div>
            <div className="text-gray-400 text-sm mt-1">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
          
          {/* Performance Stats */}
          <div className="bg-[#2b2b2b] rounded-xl p-6 flex flex-col shadow-sm">
            <h3 className="text-center text-sm font-bold text-gray-400 tracking-widest mb-6">MY PERFORMANCE STATS</h3>
            <div className="flex-1 overflow-y-auto space-y-4 scrollbar-hide">
              <div className="bg-[#333333] rounded-lg p-4 flex justify-center items-center h-16">
                <span className="text-gray-400 font-medium text-lg">
                  {stats.streak > 0 
                    ? `🔥 You are on a ${stats.streak} day streak!` 
                    : "Ready to build a streak?"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#333333] rounded-lg p-5">
                  <p className="text-gray-400 text-sm font-medium mb-1">{stats.periodTitle}</p>
                  <p className="text-4xl font-semibold" style={{ color: themeColor }}>
                    {stats.periodHours.toFixed(2)}h
                  </p>
                </div>
                <div className="bg-[#333333] rounded-lg p-5">
                  <p className="text-gray-400 text-sm font-medium mb-1">Hours this Month</p>
                  <p className="text-4xl font-semibold" style={{ color: themeColor }}>
                    {stats.monthHours.toFixed(2)}h
                  </p>
                </div>
              </div>
              <div className="bg-[#333333] rounded-lg p-5">
                <p className="text-gray-400 text-sm font-medium mb-1">Next Scheduled Shift</p>
                <p className="text-2xl font-bold text-gray-100 whitespace-pre-wrap leading-tight">{stats.nextShift}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#333333] rounded-lg p-5">
                  <p className="text-gray-400 text-sm font-medium mb-1">Lifetime Hours</p>
                  <p className="text-4xl font-semibold" style={{ color: themeColor }}>
                    {stats.lifetimeHours.toFixed(2)}h
                  </p>
                </div>
                <div className="bg-[#333333] rounded-lg p-5">
                  <p className="text-gray-400 text-sm font-medium mb-1">Lifetime Days</p>
                  <p className="text-4xl font-semibold" style={{ color: themeColor }}>
                    {stats.lifetimeDays.toFixed(2)}d
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-6">
            <div className="bg-[#2b2b2b] rounded-xl p-8 flex flex-col items-center justify-center shadow-sm">
              <div className="text-center mb-6">
                {status === "CLOCKED_OUT" && <p className="text-[#C92C2C] font-bold text-lg tracking-wider mb-1">🔴 CLOCKED OUT</p>}
                {status === "CLOCKED_IN" && <p className="text-[#00A023] font-bold text-lg tracking-wider mb-1">🟢 CLOCKED IN</p>}
                {status === "ON_BREAK" && <p className="text-[#DB8700] font-bold text-lg tracking-wider mb-1">🟠 ON BREAK</p>}
                <p className="text-gray-400">{duration}</p>
              </div>

              <div className="w-full max-w-[400px] space-y-4">
                {status === "CLOCKED_OUT" && (
                  <button onClick={handleClockIn} className="w-full bg-[#00A023] hover:bg-[#00801c] text-white py-4 rounded text-xl font-bold transition-colors shadow-lg active:scale-[0.98]">
                    Clock In
                  </button>
                )}
                {status === "CLOCKED_IN" && (
                  <>
                    <button onClick={handleClockOut} className="w-full bg-[#C92C2C] hover:bg-[#8a1c1c] text-white py-4 rounded text-xl font-bold transition-colors shadow-lg active:scale-[0.98]">
                      Clock Out
                    </button>
                    <button onClick={() => setShowBreakModal(true)} className="w-full bg-[#DB8700] hover:bg-[#b26e00] text-white py-4 rounded text-xl font-bold transition-colors shadow-lg active:scale-[0.98]">
                      Start Break
                    </button>
                  </>
                )}
                {status === "ON_BREAK" && (
                  <button onClick={handleEndBreak} className="w-full bg-[#00A023] hover:bg-[#00801c] text-white py-4 rounded text-xl font-bold transition-colors shadow-lg active:scale-[0.98]">
                    End Break
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#2b2b2b] rounded-xl p-6 flex flex-col flex-1 min-h-0 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-gray-400 tracking-widest">TIME OFF</h3>
                <button 
                  onClick={() => setShowTimeOffModal(true)}
                  className="text-white px-4 py-1.5 rounded text-sm font-bold transition-colors shadow" 
                  style={{ backgroundColor: themeColor }}
                >
                  + Request
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 scrollbar-hide pr-2">
                {timeOffRequests.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-gray-500 italic text-sm">No upcoming time off.</p>
                  </div>
                ) : (
                  timeOffRequests.map(req => (
                    <div key={req.id} className="bg-[#333333] rounded-lg p-4 relative group border border-gray-700/50">
                       <button 
                         onClick={() => handleDeleteTimeOff(req.id)} 
                         className="absolute top-3 right-3 text-gray-500 hover:text-[#C92C2C] font-bold text-xl leading-none transition-colors"
                         title="Cancel Request"
                       >
                         &times;
                       </button>
                       <div className="flex gap-2 items-center mb-1">
                         <span className="font-bold tracking-wide" style={{ color: themeColor }}>
                           {req.start_date} <span className="text-gray-400 font-normal text-sm mx-1">to</span> {req.end_date}
                         </span>
                       </div>
                       <div className="flex justify-between items-end mt-2">
                         <div className="text-sm font-medium text-gray-400">Type: {req.type}</div>
                         {/* FIX: Check for Rejected and color it red (#C92C2C) */}
                         <div className={`text-xs font-bold px-2 py-1 rounded bg-black/30 tracking-wider ${req.status === 'Approved' ? 'text-[#00A023]' : req.status === 'Rejected' ? 'text-[#C92C2C]' : 'text-[#DB8700]'}`}>
                           {req.status.toUpperCase()}
                         </div>
                       </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}