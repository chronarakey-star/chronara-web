"use client";

// ============================================================================
// 1. IMPORTS & INTERFACES
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface Store {
  id: string;
  name: string;
  is_active?: any; 
}

interface FeedbackModal {
  type: "success" | "error" | "welcome" | "info";
  title: string;
  message: string;
  subMessage?: string;
}

const getLocalIsoString = () => {
  const now = new Date();
  const tzoffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzoffset).toISOString().slice(0, -1);
};

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function TimeClockLogin() {
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isReady, setIsReady] = useState(false); 

  const [companyId, setCompanyId] = useState<string>("");
  const [stores, setStores] = useState<Store[]>([]);
  const [themeColor, setThemeColor] = useState("#1F538D");

  const [selectedStore, setSelectedStore] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [quickEmpId, setQuickEmpId] = useState<string | null>(null);
  const [punchStatus, setPunchStatus] = useState<"INVALID" | "CLOCKED_OUT" | "CLOCKED_IN" | "ON_BREAK">("INVALID");
  const [activePunchId, setActivePunchId] = useState<string | null>(null);
  const [activeBreakId, setActiveBreakId] = useState<string | null>(null);
  const [showBreakModal, setShowBreakModal] = useState(false);
  
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModal | null>(null);

  // ============================================================================
  // 3. INITIALIZATION
  // ============================================================================
  useEffect(() => {
    const initializePage = async () => {
      const cachedColor = localStorage.getItem('chronara_theme_color');
      if (cachedColor) setThemeColor(cachedColor);

      const cachedStore = localStorage.getItem('chronara_last_store');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/");
        return;
      }

      try {
        const { data: companies } = await supabase
          .from('companies')
          .select('id, config_json') 
          .or(`email.eq.${session.user.email},owner_email.eq.${session.user.email}`)
          .limit(1);

        if (companies && companies.length > 0) {
          const comp = companies[0];
          setCompanyId(comp.id); 

          if (comp.config_json) {
            const config = JSON.parse(comp.config_json);
            if (config.color_theme) {
              setThemeColor(config.color_theme);
              localStorage.setItem('chronara_theme_color', config.color_theme);
            }
          }

          const { data: storeData } = await supabase
            .from('stores')
            .select('id, name, is_active')
            .eq('company_id', comp.id);

          if (storeData) {
            const activeStores = storeData.filter(s => {
              const activeVal = String(s.is_active ?? 1).toLowerCase();
              return !["0", "false"].includes(activeVal);
            });

            const sortedStores = activeStores.sort((a, b) => a.name.localeCompare(b.name));
            setStores(sortedStores);

            if (cachedStore && sortedStores.some(s => s.id === cachedStore)) {
              setSelectedStore(cachedStore);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
      setIsReady(true);
    };

    initializePage();

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [router]);

  // ============================================================================
  // 4. QUICK-PUNCH LISTENER & AUTO-REFRESH
  // ============================================================================
  
  const checkPunchStatus = async (empId: string) => {
    try {
      const { data: punches } = await supabase
        .from('time_punches')
        .select('id, clock_in, clock_out, store_id')
        .eq('employee_id', empId)
        .eq('store_id', selectedStore) // <--- NEW: STRICT STORE FILTER
        .order('clock_in', { ascending: false })
        .limit(1);

      if (punches && punches.length > 0 && !punches[0].clock_out) {
        const punch = punches[0];
        let autoClockedOut = false;

        // --- AUTO CLOCK OUT LOGIC ---
        try {
          const clockInDt = new Date(punch.clock_in);
          const activeStoreId = punch.store_id || selectedStore;
          const { data: settingsData } = await supabase.from('store_time_clock_settings')
            .select('auto_clock_out, auto_clock_out_mins')
            .eq('store_id', activeStoreId).limit(1);

          const s = settingsData?.[0];
          const autoOutEnabled = s?.auto_clock_out === 1 || s?.auto_clock_out === true || String(s?.auto_clock_out).toLowerCase() === "true" || String(s?.auto_clock_out).toLowerCase() === "1";
          const bufferMins = parseInt(s?.auto_clock_out_mins as string, 10) || 0;

          if (autoOutEnabled) {
            const tzoffset = clockInDt.getTimezoneOffset() * 60000;
            const dateStr = new Date(clockInDt.getTime() - tzoffset).toISOString().split('T')[0];

            const { data: schedData } = await supabase.from('schedules')
                .select('end_time')
                .eq('employee_id', empId)
                .eq('date', dateStr).limit(1);
            
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
          setActivePunchId(null);
          setActiveBreakId(null);
          setPunchStatus("CLOCKED_OUT");
          return;
        }

        setActivePunchId(punch.id);

        const { data: breaks } = await supabase
          .from('time_punch_breaks')
          .select('id, break_end')
          .eq('punch_id', punch.id)
          .order('break_start', { ascending: false })
          .limit(1);

        if (breaks && breaks.length > 0 && !breaks[0].break_end) {
          setActiveBreakId(breaks[0].id);
          setPunchStatus("ON_BREAK");
        } else {
          setActiveBreakId(null);
          setPunchStatus("CLOCKED_IN");
        }
      } else {
        setActivePunchId(null);
        setActiveBreakId(null);
        setPunchStatus("CLOCKED_OUT");
      }
    } catch (err) {
      console.error("Status check error:", err);
    }
  };

  // Triggered when user types
  // Triggered when user types
  useEffect(() => {
    const checkCredentials = setTimeout(async () => {
      if (!companyId || !username || !password || !selectedStore) {
        setPunchStatus("INVALID");
        setQuickEmpId(null);
        return;
      }

      try {
        const { data: users } = await supabase
          .from('users')
          .select('id, is_active')
          .eq('company_id', companyId)
          .ilike('username', username) 
          .eq('password', password) 
          .limit(1);

        if (!users || users.length === 0 || String(users[0].is_active).toLowerCase() === "0" || String(users[0].is_active).toLowerCase() === "false") {
          setPunchStatus("INVALID");
          setQuickEmpId(null);
          return;
        }

        // --- NEW: FETCH ALL PROFILES AND MATCH TO STORE ---
        const { data: emps } = await supabase
          .from('employees')
          .select('id, store_id')
          .eq('user_id', users[0].id);

        if (!emps || emps.length === 0) {
          setPunchStatus("INVALID");
          setQuickEmpId(null);
          return;
        }

        // Find the specific employee profile for this store, or fallback to the first one
        const targetEmp = emps.find(e => e.store_id === selectedStore) || emps[0];
        const empId = targetEmp.id;

        setQuickEmpId(empId);
        await checkPunchStatus(empId);

      } catch (err) {
        console.error("Quick punch validation error:", err);
        setPunchStatus("INVALID");
        setQuickEmpId(null);
      }
    }, 400);

    return () => clearTimeout(checkCredentials);
  }, [username, password, companyId, selectedStore]);

  // Background Polling
  useEffect(() => {
    if (!quickEmpId || punchStatus === "INVALID") return;
    const syncTimer = setInterval(() => {
      checkPunchStatus(quickEmpId);
    }, 10000);
    return () => clearInterval(syncTimer);
  }, [quickEmpId, punchStatus]);

  // ============================================================================
  // 5. ACTION HANDLERS
  // ============================================================================
  const handleQuickClockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (punchStatus !== "CLOCKED_OUT" || !quickEmpId) return;

    try {
      // --- PREVENT EARLY CLOCK IN & ROUNDING LOGIC ---
      const { data: settingsData } = await supabase
        .from('store_time_clock_settings')
        .select('enforce_schedule, early_clock_in_mins, round_time_punches, rounding_increment_mins, clock_in_message')
        .eq('store_id', selectedStore)
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
          .eq('employee_id', quickEmpId)
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
      // --- END PREVENT EARLY CLOCK IN LOGIC ---

      const punchId = `tck_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
      const nowIso = getLocalIsoString();

      const { error: err1 } = await supabase.from('time_punches').insert({
        id: punchId,
        company_id: companyId,
        employee_id: quickEmpId,
        store_id: selectedStore || null,
        clock_in: nowIso,
        type: "Regular",
        status: "Approved",
        applied_rounding_mins: appliedRoundingMins
      });

      if (err1) {
        const { error: err2 } = await supabase.from('time_punches').insert({
          id: punchId,
          company_id: companyId,
          employee_id: quickEmpId,
          store_id: selectedStore || null,
          clock_in: nowIso,
          type: "Regular",
          status: "Approved"
        });
        if (err2) throw err2;
      }
      
      // --- CLOCK IN MESSAGE LOGIC ---
      let displayMsg = "Welcome, {name}!";
      try {
        const { data: empData } = await supabase.from('employees').select('first_name, next_clock_in_message').eq('id', quickEmpId).single();
        
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
          await supabase.from('employees').update({ next_clock_in_message: "" }).eq('id', quickEmpId);
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

      setUsername("");
      setPassword("");
    } catch (err: any) {
      const errorString = JSON.stringify(err);
      if (err.code === '23505' || errorString.includes('duplicate') || errorString.includes('one_active_shift')) {
        setFeedbackModal({
            type: "info",
            title: "Already Clocked In",
            message: "You are already clocked in! Your buttons have been refreshed.",
        });
        await checkPunchStatus(quickEmpId);
      } else {
        setFeedbackModal({ type: "error", title: "Error", message: "Error Clocking In. Please try again." });
      }
    }
  };

  const handleQuickClockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (punchStatus !== "CLOCKED_IN" || !activePunchId || !quickEmpId) return;
    
    let nowIso = getLocalIsoString();

    try {
      // --- MINIMUM REPORTING PAY & ROUNDING LOGIC ---
      const { data: punchData } = await supabase.from('time_punches').select('clock_in, store_id').eq('id', activePunchId).single();
      
      if (punchData && punchData.clock_in) {
          let clockOutDt = new Date();
          const clockInDt = new Date(punchData.clock_in);
          const activeStoreId = punchData.store_id || selectedStore;

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
              
              const { data: schedData } = await supabase.from('schedules').select('id').eq('employee_id', quickEmpId).eq('date', dateStr).limit(1);
              
              if (schedData && schedData.length > 0) {
                  const paddedSec = breakSec + (minHrs * 3600.0);
                  const paddedOutDt = new Date(clockInDt.getTime() + (paddedSec * 1000));
                  const tzoffset2 = paddedOutDt.getTimezoneOffset() * 60000;
                  nowIso = new Date(paddedOutDt.getTime() - tzoffset2).toISOString().slice(0, -1);
              }
          }
      }
      // --- END MINIMUM REPORTING PAY LOGIC ---

      await supabase.from('time_punches')
        .update({ clock_out: nowIso, status: 'Approved' })
        .eq('id', activePunchId);
        
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

      setUsername("");
      setPassword("");
      await checkPunchStatus(quickEmpId);
    } catch (err) {
      setFeedbackModal({ type: "error", title: "Error", message: "Error Clocking Out. Please try again." });
    }
  };

  const handleQuickStartBreak = async (breakType: "Paid" | "Unpaid") => {
    if (punchStatus !== "CLOCKED_IN" || !activePunchId) return;
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

      setUsername("");
      setPassword("");
      await checkPunchStatus(quickEmpId!);
    } catch (err: any) {
      const errorString = JSON.stringify(err);
      if (err.code === '23505' || errorString.includes('duplicate') || errorString.includes('one_active_break')) {
        setFeedbackModal({ type: "info", title: "Already on Break", message: "You are already on a break! Your buttons have been refreshed." });
        await checkPunchStatus(quickEmpId!);
      } else {
        setFeedbackModal({ type: "error", title: "Error", message: "Error starting break. Please try again." });
      }
    }
  };

  const handleQuickEndBreak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (punchStatus !== "ON_BREAK" || !activeBreakId) return;
    
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

      setUsername("");
      setPassword("");
      await checkPunchStatus(quickEmpId!);
    } catch (err: any) {
      setFeedbackModal({ type: "error", title: "Error", message: "Error ending break. Please try again." });
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!companyId) return setErrorMsg("System error: Company ID missing.");
    if (!selectedStore) return setErrorMsg("Please select a store location.");
    if (!username || !password) return setErrorMsg("Username and password required.");

    try {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, username, is_active')
        .eq('company_id', companyId)
        .ilike('username', username) 
        .eq('password', password) 
        .limit(1);

      if (error || !users || users.length === 0) {
        return setErrorMsg("Invalid username or password.");
      }

      const user = users[0];

      const isActive = String(user.is_active ?? 1).toLowerCase();
      if (isActive === "0" || isActive === "false") {
        return setErrorMsg("This account has been deactivated.");
      }
      
      localStorage.setItem('chronara_last_store', selectedStore);
      localStorage.setItem('chronara_web_user', JSON.stringify(user));

      router.push("/timeclock/dashboard");

    } catch (err) {
      setErrorMsg("An unexpected error occurred connecting to the database.");
    }
  };

  // ============================================================================
  // 6. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#0a0f16]"></div>;

  return (
    <div className="min-h-screen bg-[#0a0f16] text-white flex flex-col relative overflow-hidden font-sans">
      
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

      {showBreakModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#2b2b2b] border border-gray-700 p-8 rounded-xl w-full max-w-md shadow-2xl flex flex-col items-center">
            <h3 className="text-2xl font-bold mb-2">Start a Break</h3>
            <p className="text-gray-400 mb-8">Is this a paid or unpaid break?</p>
            
            <div className="flex gap-4 w-full mb-6">
              <button 
                onClick={() => handleQuickStartBreak("Paid")}
                style={{ backgroundColor: themeColor }}
                className="flex-1 py-6 rounded-lg text-lg font-bold hover:brightness-110 transition-all shadow-md"
              >
                Paid Break<br/><span className="text-sm font-normal opacity-80">(15 Min)</span>
              </button>
              
              <button 
                onClick={() => handleQuickStartBreak("Unpaid")}
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

      <div className="absolute inset-0 pointer-events-none z-0">
        <Image 
          src="/SuiteBackground.png" 
          alt="Background" 
          fill 
          className="object-cover opacity-60" 
          priority
        />
      </div>

      <div className="absolute top-6 right-6 z-10 text-right">
        <div className="text-xl font-semibold text-gray-200">
          {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="text-3xl font-bold tracking-wider text-white">
          {currentTime.toLocaleTimeString('en-US')}
        </div>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center z-10 p-4">
        
        <div className="bg-[#0a0f16]/80 backdrop-blur-md border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl flex flex-col items-center">
          
          <div className="w-[100px] h-[120px] relative mb-2">
            <Image 
              src="/chronarakeylogo.png" 
              alt="Chronara Key" 
              fill 
              className="object-contain" 
            />
          </div>
          <h2 className="text-2xl font-bold mb-4 tracking-wide">TIME CLOCK</h2>

          <form className="w-full space-y-4" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            
            <input type="text" name="fake_usernameref" style={{ display: 'none' }} aria-hidden="true" />
            <input type="password" name="fake_passwordref" style={{ display: 'none' }} aria-hidden="true" />

            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm font-semibold p-3 rounded text-center">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Select Store Location</label>
              <select 
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023] transition-colors"
              >
                <option value="" disabled>Select Store Location</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Username</label>
              <input 
                type="text"
                name="clock_auth_user_sec"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023] transition-colors"
                style={{ WebkitBoxShadow: "0 0 0px 1000px #131b26 inset", WebkitTextFillColor: "white" }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Password</label>
              <input 
                type="password"
                name="clock_auth_pass_sec"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023] transition-colors"
                style={{ WebkitBoxShadow: "0 0 0px 1000px #131b26 inset", WebkitTextFillColor: "white" }}
              />
            </div>

            <div className="pt-2 space-y-3">
              
              {(punchStatus === "INVALID" || punchStatus === "CLOCKED_OUT") && (
                <button 
                  onClick={handleQuickClockIn}
                  disabled={punchStatus === "INVALID"}
                  className={`w-full py-3 rounded text-lg font-bold shadow-lg transition-all 
                    ${punchStatus === "INVALID" ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-[#00A023] hover:bg-[#00801c] text-white active:scale-[0.98]"}`}
                >
                  CLOCK IN
                </button>
              )}

              {punchStatus === "CLOCKED_IN" && (
                <div className="flex gap-2">
                  <button 
                    onClick={handleQuickClockOut}
                    className="flex-1 bg-[#C92C2C] hover:bg-[#8a1c1c] text-white py-3 rounded text-lg font-bold shadow-lg transition-transform active:scale-[0.98]"
                  >
                    CLOCK OUT
                  </button>
                  <button 
                    onClick={(e) => { e.preventDefault(); setShowBreakModal(true); }}
                    className="flex-1 bg-[#DB8700] hover:bg-[#b26e00] text-white py-3 rounded text-lg font-bold shadow-lg transition-transform active:scale-[0.98]"
                  >
                    START BREAK
                  </button>
                </div>
              )}

              {punchStatus === "ON_BREAK" && (
                <div className="flex gap-2">
                  <button 
                    disabled
                    className="flex-1 bg-gray-700 text-gray-500 py-3 rounded text-lg font-bold shadow-lg cursor-not-allowed"
                  >
                    CLOCK OUT
                  </button>
                  <button 
                    onClick={handleQuickEndBreak}
                    className="flex-1 bg-[#00A023] hover:bg-[#00801c] text-white py-3 rounded text-lg font-bold shadow-lg transition-transform active:scale-[0.98]"
                  >
                    END BREAK
                  </button>
                </div>
              )}
              
              <button 
                onClick={handleSignIn}
                style={{ backgroundColor: themeColor }}
                className="w-full text-white py-2.5 rounded font-bold shadow-md transition-transform active:scale-[0.98] hover:brightness-110"
              >
                SIGN IN TO DASHBOARD
              </button>
            </div>
          </form>

        </div>
        
        <button 
          onClick={() => router.push("/dashboard")}
          className="mt-6 text-gray-500 hover:text-white flex items-center gap-2 transition-colors font-semibold z-10"
        >
          ← Back to Suite
        </button>

      </main>
    </div>
  );
}