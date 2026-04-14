"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  // STATE: Now defaults to FALSE (Locked) until Supabase proves otherwise
  const [unlockedModules, setUnlockedModules] = useState({
    POS: false,
    CLOCK: false,
  });

  useEffect(() => {
    const checkUserAndLicenses = async () => {
      // 1. Security Check
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/"); 
        return;
      }
      setUser(session.user);

      try {
        // 2. Find the Company ID attached to this logged-in email
        // Based on your Python schema, it's either in 'email' or 'owner_email'
        const { data: companies, error: compError } = await supabase
          .from('companies')
          .select('id')
          .or(`email.eq.${session.user.email},owner_email.eq.${session.user.email}`)
          .limit(1);

        if (companies && companies.length > 0) {
          const companyId = companies[0].id;

          // 3. Check the 'licenses' table for active keys claimed by this company
          const { data: licenses, error: licError } = await supabase
            .from('licenses')
            .select('module, is_active')
            .eq('claimed_by_company', companyId)
            .eq('is_active', true);

          let activeStatus = { POS: false, CLOCK: false };

          // 4. Parse the active licenses
          if (licenses && licenses.length > 0) {
            licenses.forEach((lic) => {
              const mod = String(lic.module).toUpperCase();
              if (mod.includes('SUITE')) {
                activeStatus.POS = true;
                activeStatus.CLOCK = true;
              }
              if (mod.includes('POS')) activeStatus.POS = true;
              if (mod.includes('CLOCK')) activeStatus.CLOCK = true;
            });
          }
          
          setUnlockedModules(activeStatus);
        }
      } catch (error) {
        console.error("Error validating licenses:", error);
      }
    };

    checkUserAndLicenses();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (!user) return <div className="min-h-screen bg-[#0a0f16]"></div>;

  return (
    <div className="min-h-screen bg-[#0a0f16] text-white flex flex-col relative overflow-hidden">
      
      {/* Background Image */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <Image 
          src="/SuiteBackground.png" 
          alt="Background" 
          fill 
          className="object-cover opacity-60" 
          priority
        />
      </div>

      {/* Top Bar for Logout */}
      <div className="absolute top-4 right-4 z-10">
        <button 
          onClick={handleLogout} 
          className="bg-transparent text-gray-400 hover:text-white px-4 py-2 text-sm font-bold transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center z-10 p-4">
        
        {/* Logo Section */}
        <div className="flex flex-col items-center mt-48">
          
          <div className="relative w-full h-4 flex justify-center mb-6">
            <div className="absolute bottom-0 w-[240px] h-[550px] pointer-events-none">
              <Image 
                src="/chronarakeylogo.png" 
                alt="Chronara Key" 
                fill 
                className="object-contain object-bottom" 
                priority
              />
            </div>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight z-10 relative">Chronara Key Suite</h1>
          <p className="text-gray-400 mt-2 text-lg z-10 relative">Select an application to launch</p>
        </div>

        {/* Applications Grid */}
        <div className="flex flex-wrap justify-center gap-8 mt-6">
          
          {/* Point of Sale Button */}
          <button 
            onClick={() => unlockedModules.POS && router.push("/pos")}
            disabled={!unlockedModules.POS}
            className={`flex flex-col items-center group transition-transform ${unlockedModules.POS ? 'active:scale-95 cursor-pointer' : 'cursor-not-allowed'}`}
          >
            <div className={`w-44 h-44 relative transition-all ${unlockedModules.POS ? 'group-hover:scale-105' : ''}`}>
               <Image 
                 src={unlockedModules.POS ? "/pos.png" : "/pos2.png"} 
                 alt="Point of Sale" 
                 fill 
                 className="object-contain" 
               />
            </div>
            <h2 className="mt-4 text-xl font-bold">Point of Sale</h2>
            <span className={`text-sm font-semibold ${unlockedModules.POS ? 'text-[#189777]' : 'text-[#C92C2C]'}`}>
              {unlockedModules.POS ? 'Active' : 'Locked'}
            </span>
          </button>

          {/* Time Clock Button */}
          <button 
            onClick={() => unlockedModules.CLOCK && router.push("/timeclock")}
            disabled={!unlockedModules.CLOCK}
            className={`flex flex-col items-center group transition-transform ${unlockedModules.CLOCK ? 'active:scale-95 cursor-pointer' : 'cursor-not-allowed'}`}
          >
            <div className={`w-44 h-44 relative transition-all ${unlockedModules.CLOCK ? 'group-hover:scale-105' : ''}`}>
               <Image 
                 src={unlockedModules.CLOCK ? "/clock.png" : "/clock2.png"} 
                 alt="Time Clock" 
                 fill 
                 className="object-contain" 
               />
            </div>
            <h2 className="mt-4 text-xl font-bold">Time Clock</h2>
            <span className={`text-sm font-semibold ${unlockedModules.CLOCK ? 'text-[#189777]' : 'text-[#C92C2C]'}`}>
              {unlockedModules.CLOCK ? 'Active' : 'Locked'}
            </span>
          </button>

        </div>
      </main>
    </div>
  );
}