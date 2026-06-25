"use client";

// ============================================================================
// 1. IMPORTS & INTERFACES
// ============================================================================
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../../utils/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";
import SellModule from "./SellModule";
import DashboardModule from "./DashboardModule"; 
import SalesModule from "./SalesModule"; 
import CashManagementModule from "./CashManagementModule";
import OpenCloseModule from "./OpenCloseModule";
import InventoryModule from "./InventoryModule";

interface User {
  id: string;
  username: string;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  company_id: string;
  store_id?: string;
}

interface PosTill {
  id: string;
  company_id: string;
  store_id: string;
  name: string;
  is_default: number | boolean;
  is_active: number | boolean;
  sort_order: number | null;
}

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function POSDashboard() {
  const router = useRouter();
  
  const [isReady, setIsReady] = useState(false);

  const [themeColor, setThemeColor] = useState("#189777");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [storeId, setStoreId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  // Till / register selected for this browser.
  const [availableTills, setAvailableTills] = useState<PosTill[]>([]);
  const [tillId, setTillId] = useState<string>("");
  const [tillName, setTillName] = useState<string>("");

  // Module Navigation State
  const [activeModule, setActiveModule] = useState<string>("Sell");
  const [refundData, setRefundData] = useState<any>(null); // <--- ADDED REFUND STATE

  // --- AUTO LOGOUT STATES ---
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(false);

  // ============================================================================
  // 3. INITIALIZATION
  // ============================================================================
  useEffect(() => {
    const initializeDashboard = async () => {
      const clearCachedPOSSession = () => {
        localStorage.removeItem('chronara_web_user');
        localStorage.removeItem('chronara_last_store');
        localStorage.removeItem('chronara_theme_color');

        // Till assignments use company/store-specific keys.
        // Remove any saved web till assignments when this POS
        // authentication context is no longer valid.
        Object.keys(localStorage)
          .filter(key =>
            key.startsWith('chronara_web_till_')
          )
          .forEach(key =>
            localStorage.removeItem(key)
          );
      };

      const cachedStore =
        localStorage.getItem('chronara_last_store') || "";

      const cachedUserStr =
        localStorage.getItem('chronara_web_user');

      if (!cachedUserStr) {
        router.push("/pos");
        return;
      }

      let cachedUser: User;

      try {
        cachedUser = JSON.parse(cachedUserStr);
      } catch {
        clearCachedPOSSession();
        router.push("/pos");
        return;
      }

      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        clearCachedPOSSession();
        router.push("/pos");
        return;
      }

      try {
        const { data: companies, error: companyError } =
          await supabase
            .from('companies')
            .select('id, config_json')
            .or(
              `email.eq.${session.user.email},owner_email.eq.${session.user.email}`
            )
            .limit(1);

        if (companyError) {
          throw companyError;
        }

        if (!companies || companies.length === 0) {
          clearCachedPOSSession();
          router.push("/pos");
          return;
        }

        const company = companies[0];

        setCompanyId(company.id);

        let companyConfig: Record<string, any> = {};

        if (company.config_json) {
          try {
            companyConfig =
              typeof company.config_json === 'string'
                ? JSON.parse(company.config_json)
                : company.config_json;
          } catch (configError) {
            console.error(
              "Could not parse company theme configuration:",
              configError
            );
          }
        }

        const cloudThemeColor =
          typeof companyConfig.color_theme === 'string'
          && /^#[0-9A-Fa-f]{6}$/.test(
            companyConfig.color_theme
          )
            ? companyConfig.color_theme
            : "#189777";

        setThemeColor(cloudThemeColor);

        localStorage.setItem(
          'chronara_theme_color',
          cloudThemeColor
        );

        const { data: verifiedUser, error: userError } =
          await supabase
            .from('users')
            .select('id, username')
            .eq('id', cachedUser.id)
            .eq('company_id', company.id)
            .eq('is_active', 1)
            .maybeSingle();

        if (userError) {
          throw userError;
        }

        if (!verifiedUser) {
          clearCachedPOSSession();
          router.push("/pos");
          return;
        }

        const currentVerifiedUser: User = {
          id: verifiedUser.id,
          username: verifiedUser.username
        };

        setCurrentUser(currentVerifiedUser);

        localStorage.setItem(
          'chronara_web_user',
          JSON.stringify(currentVerifiedUser)
        );

        const { data: activeStores, error: storesError } =
          await supabase
            .from('stores')
            .select('id')
            .eq('company_id', company.id)
            .eq('is_active', 1);

        if (storesError) {
          throw storesError;
        }

        let validStoreId = "";

        if (
          cachedStore
          && activeStores?.some(
            store => store.id === cachedStore
          )
        ) {
          validStoreId = cachedStore;
        } else if (
          activeStores
          && activeStores.length > 0
        ) {
          validStoreId = activeStores[0].id;
        }

        setStoreId(validStoreId);

        if (validStoreId) {
          localStorage.setItem(
            'chronara_last_store',
            validStoreId
          );
        } else {
          localStorage.removeItem(
            'chronara_last_store'
          );
        }

        // ------------------------------------------------------------
        // Load active tills for this store and restore this browser's
        // saved till assignment.
        // ------------------------------------------------------------
        let resolvedTillId = "";
        let resolvedTillName = "";
        let resolvedTills: PosTill[] = [];

        if (validStoreId) {
          const { data: tillRows, error: tillsError } =
            await supabase
              .from('pos_tills')
              .select(
                'id, company_id, store_id, name, is_default, is_active, sort_order'
              )
              .eq('company_id', company.id)
              .eq('store_id', validStoreId)
              .eq('is_active', 1)
              .neq('is_deleted', true)
              .order('is_default', {
                ascending: false
              })
              .order('sort_order', {
                ascending: true
              })
              .order('name', {
                ascending: true
              });

          if (tillsError) {
            throw tillsError;
          }

          resolvedTills = (
            tillRows || []
          ) as PosTill[];

          const tillStorageKey =
            `chronara_web_till_${company.id}_${validStoreId}`;

          const cachedTillId =
            localStorage.getItem(
              tillStorageKey
            ) || "";

          const cachedTill = resolvedTills.find(
            till => till.id === cachedTillId
          );

          const defaultTill = resolvedTills.find(
            till =>
              till.is_default === true
              || Number(till.is_default) === 1
          );

          const selectedTill =
            cachedTill
            || defaultTill
            || resolvedTills[0]
            || null;

          if (selectedTill) {
            resolvedTillId = selectedTill.id;
            resolvedTillName = selectedTill.name;

            localStorage.setItem(
              tillStorageKey,
              selectedTill.id
            );
          } else {
            localStorage.removeItem(
              tillStorageKey
            );
          }
        }

        setAvailableTills(resolvedTills);
        setTillId(resolvedTillId);
        setTillName(resolvedTillName);

        const { data: empData, error: employeeError } =
          await supabase
            .from('employees')
            .select(
              'id, first_name, last_name, company_id, store_id'
            )
            .eq('company_id', company.id)
            .eq('user_id', verifiedUser.id);

        if (employeeError) {
          throw employeeError;
        }

        if (empData && empData.length > 0) {
          const targetEmp =
            empData.find(
              (employee: Employee) =>
                validStoreId
                && employee.store_id === validStoreId
            ) || empData[0];

          setEmployee(targetEmp);
        } else {
          setEmployee(null);
        }

        setIsReady(true);

      } catch (err) {
        console.error(
          "Error fetching POS context:",
          err
        );

        clearCachedPOSSession();
        router.push("/pos");
      }
    };

    initializeDashboard();
  }, [router]);

  // ============================================================================
  // AUTO-LOGOUT INACTIVITY TRACKER
  // ============================================================================
  useEffect(() => {
    if (!autoLogoutEnabled) return;

    const handleActivity = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      
      timeoutRef.current = setTimeout(() => {
        localStorage.removeItem('chronara_web_user');
        router.push("/pos");
      }, 60000 * 15); // 15 Minutes
    };

    handleActivity();

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, handleActivity));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [autoLogoutEnabled, router]);


  const handleTillChange = (
    selectedTillId: string
  ) => {
    const selectedTill = availableTills.find(
      till => till.id === selectedTillId
    );

    if (
      !selectedTill
      || !companyId
      || !storeId
    ) {
      return;
    }

    setTillId(selectedTill.id);
    setTillName(selectedTill.name);

    const tillStorageKey =
      `chronara_web_till_${companyId}_${storeId}`;

    localStorage.setItem(
      tillStorageKey,
      selectedTill.id
    );

    // Clear an in-progress cross-module refund when the till changes.
    // A refund should begin and finish under one explicitly selected till.
    setRefundData(null);
  };


  const handleSignOut = () => {
    localStorage.removeItem('chronara_web_user');
    router.push("/pos");
  };


  // ============================================================================
  // 4. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#181818]"></div>;

  return (
    <div className="flex h-screen bg-[#222222] text-white font-sans overflow-hidden">
      
      {/* --- NARROW SIDEBAR (w-[200px] to match Python) --- */}
      <aside className="w-[200px] bg-[#1e1e1e] flex flex-col border-r border-gray-800 shrink-0">
        
        {/* LOGO & USER */}
        <div className="pt-8 pb-4 flex flex-col items-center border-b border-gray-800 mx-4">
          <div className="w-[140px] h-[80px] relative mb-4">
            <Image 
              src="/chronarakeylogo.png" 
              alt="Chronara Key" 
              fill 
              className="object-contain" 
            />
          </div>
          <h2
            style={{ color: themeColor }}
            className="text-xl font-medium italic truncate w-full text-center"
          >
            {employee
              ? employee.first_name
              : (
                  currentUser
                    ? currentUser.username
                    : "Staff"
                )}
          </h2>


        </div>

        {/* --- POS LITE NAVIGATION --- */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1 scrollbar-hide">
          
          <button 
            onClick={() => setActiveModule("Sell")}
            style={{ 
              backgroundColor: activeModule === 'Sell' ? '#2a2a2a' : 'transparent',
              color: activeModule === 'Sell' ? themeColor : '#e5e7eb'
            }}
            className="w-full text-left px-6 py-3.5 text-[15px] font-bold transition-colors hover:bg-[#2a2a2a]"
          >
            Sell
          </button>
          
          <button 
            onClick={() => setActiveModule("Sales")}
            style={{ 
              backgroundColor: activeModule === 'Sales' ? '#2a2a2a' : 'transparent',
              color: activeModule === 'Sales' ? themeColor : '#e5e7eb'
            }}
            className="w-full text-left px-6 py-3.5 text-[15px] font-bold transition-colors hover:bg-[#2a2a2a]"
          >
            Sales
          </button>

          <button 
            onClick={() => setActiveModule("Inventory")}
            style={{ 
              backgroundColor: activeModule === 'Inventory' ? '#2a2a2a' : 'transparent',
              color: activeModule === 'Inventory' ? themeColor : '#e5e7eb'
            }}
            className="w-full text-left px-6 py-3.5 text-[15px] font-bold transition-colors hover:bg-[#2a2a2a]"
          >
            Inventory
          </button>

        </div>

        <div className="space-y-1 pb-3 pt-2 border-t border-gray-800">
          <button 
            onClick={() => setActiveModule("Cash Management")}
            style={{ color: activeModule === 'Cash Management' ? themeColor : '#e5e7eb' }}
            className="w-full text-left px-6 py-3.5 text-[15px] font-bold transition-colors hover:bg-[#2a2a2a]"
          >
            Cash Management
          </button>

          <button 
            onClick={() => setActiveModule("Open/Close")}
            style={{ color: activeModule === 'Open/Close' ? themeColor : '#e5e7eb' }}
            className="w-full text-left px-6 py-3.5 text-[15px] font-bold transition-colors hover:bg-[#2a2a2a]"
          >
            Open/Close
          </button>
        </div>

        <div className="px-4 pb-4">
          <label
            htmlFor="web-till-selector"
            className="block text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 mb-1.5"
          >
            Current Till
          </label>

          {availableTills.length > 0 ? (
            <select
              id="web-till-selector"
              value={tillId}
              onChange={event =>
                handleTillChange(
                  event.target.value
                )
              }
              className="w-full h-10 rounded-md bg-[#292929] border border-gray-700 px-2.5 text-[13px] font-bold text-white outline-none cursor-pointer"
              style={{
                borderColor: tillId
                  ? themeColor
                  : undefined
              }}
            >
              {availableTills.map(till => (
                <option
                  key={till.id}
                  value={till.id}
                >
                  {till.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="w-full min-h-10 rounded-md bg-[#292929] border border-red-900/70 px-2.5 py-2.5 text-[12px] font-bold text-red-400">
              No active till
            </div>
          )}
        </div>

        <div className="p-4 pt-0">
          <button 
            onClick={handleSignOut}
            style={{ backgroundColor: themeColor }}
            className="w-full text-center px-4 py-3 rounded-xl text-white font-bold text-[15px] transition-transform active:scale-95 shadow-md"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* --- Main Workspace --- */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#181818]">
        {/* Module Content Area */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          
          {activeModule === "Sell" && (
            <SellModule
              companyId={companyId}
              storeId={storeId}
              tillId={tillId}
              tillName={tillName}
              themeColor={themeColor}
              user={currentUser}
              setActiveModule={setActiveModule}
              refundData={refundData}
              clearRefundData={() =>
                setRefundData(null)
              }
            />
          )}

          {activeModule === "Dashboard" && (
            <DashboardModule 
              companyId={companyId} 
              storeId={storeId} 
              themeColor={themeColor} 
              user={currentUser} 
            />
          )}

          {activeModule === "Sales" && (
            <SalesModule
              companyId={companyId}
              storeId={storeId}
              tillId={tillId}
              tillName={tillName}
              themeColor={themeColor}
              user={currentUser}
              onInitiateRefund={(data) => {
                setRefundData(data);
                setActiveModule("Sell");
              }}
            />
          )}

          {activeModule === "Inventory" && (
            <InventoryModule 
              companyId={companyId} 
              storeId={storeId} 
              themeColor={themeColor} 
              setActiveModule={setActiveModule}
            />
          )}

          {activeModule === "Cash Management" && (
            <CashManagementModule
              companyId={companyId}
              storeId={storeId}
              tillId={tillId}
              tillName={tillName}
              themeColor={themeColor}
              user={currentUser}
              setActiveModule={setActiveModule}
            />
          )}

          {activeModule === "Open/Close" && (
            <OpenCloseModule
              companyId={companyId}
              storeId={storeId}
              tillId={tillId}
              tillName={tillName}
              themeColor={themeColor}
              user={currentUser}
              setActiveModule={setActiveModule}
            />
          )}

        </div>
      </main>
    </div>
  );
}