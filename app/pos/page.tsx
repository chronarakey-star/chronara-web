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

// ============================================================================
// 2. MAIN COMPONENT & STATE
// ============================================================================
export default function POSLogin() {
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
  // 4. ACTION HANDLERS
  // ============================================================================
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

      router.push("/pos/posdashboard");

    } catch (err) {
      setErrorMsg("An unexpected error occurred connecting to the database.");
    }
  };

  // ============================================================================
  // 5. UI RENDER (JSX)
  // ============================================================================
  if (!isReady) return <div className="min-h-screen bg-[#0a0f16]"></div>;

  return (
    <div className="min-h-screen bg-[#0a0f16] text-white flex flex-col relative overflow-hidden font-sans">
      
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <Image 
          src="/SuiteBackground.png" 
          alt="Background" 
          fill 
          className="object-cover opacity-60" 
          priority
        />
      </div>

      {/* Clock */}
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
          <h2 className="text-2xl font-bold mb-4 tracking-wide uppercase">Point of Sale</h2>

          <form className="w-full space-y-4" autoComplete="off" onSubmit={handleSignIn}>
            
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
                name="pos_auth_user_sec"
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
                name="pos_auth_pass_sec"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-[#131b26] border border-gray-700 rounded p-3 text-white outline-none focus:border-[#00A023] transition-colors"
                style={{ WebkitBoxShadow: "0 0 0px 1000px #131b26 inset", WebkitTextFillColor: "white" }}
              />
            </div>

            <div className="pt-2 space-y-3">
              <button 
                type="submit"
                style={{ backgroundColor: themeColor }}
                className="w-full text-white py-3.5 rounded font-bold shadow-md transition-transform active:scale-[0.98] hover:brightness-110"
              >
                SIGN IN TO POS
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