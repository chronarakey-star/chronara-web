"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [time, setTime] = useState(new Date());
  const router = useRouter();

  useEffect(() => {
    // 1. Security Check: Are they actually logged in?
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // If they don't have a secure token, kick them back to the login screen
        router.push("/"); 
      } else {
        setUser(session.user);
      }
    };
    checkUser();

    // 2. Start the live clock
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // Show a blank dark screen for a split second while we check their security clearance
  if (!user) return <div className="min-h-screen bg-gray-900"></div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top Navigation Bar */}
      <header className="flex justify-between items-center p-4 md:p-6 bg-gray-800 border-b border-gray-700 shadow-md">
        <h1 className="text-xl md:text-2xl font-bold text-white">Chronara Key</h1>
        <div className="flex gap-2 md:gap-4">
          <button className="bg-gray-700 text-white hover:bg-gray-600 px-3 py-2 md:px-4 md:py-2 rounded text-sm md:text-base font-semibold transition-colors">
            Time Clock
          </button>
          <button className="bg-gray-700 text-white hover:bg-gray-600 px-3 py-2 md:px-4 md:py-2 rounded text-sm md:text-base font-semibold transition-colors">
            Lite POS
          </button>
          <button 
            onClick={handleLogout} 
            className="bg-transparent border border-red-500 text-red-500 hover:bg-red-500/10 px-3 py-2 md:px-4 md:py-2 rounded text-sm md:text-base font-bold transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content - Time Clock */}
      <main className="flex flex-col items-center justify-center mt-16 md:mt-32 px-4">
        <h2 className="text-lg md:text-xl text-gray-400 mb-4">
          Logged in as: <span className="text-white">{user.email}</span>
        </h2>
        
        {/* The Live Clock */}
        <div className="text-5xl md:text-8xl font-mono font-bold mb-12 tracking-wider drop-shadow-lg">
          {time.toLocaleTimeString()}
        </div>

        {/* The Punch Buttons */}
        <div className="flex flex-col md:flex-row gap-6 w-full max-w-md md:max-w-2xl">
          <button className="flex-1 bg-[#00A023] hover:bg-[#00671A] text-white text-xl md:text-2xl font-bold py-6 px-8 rounded-lg shadow-lg transition-transform active:scale-95">
            CLOCK IN
          </button>
          <button className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xl md:text-2xl font-bold py-6 px-8 rounded-lg shadow-lg transition-transform active:scale-95 border border-gray-600">
            CLOCK OUT
          </button>
        </div>
      </main>
    </div>
  );
}