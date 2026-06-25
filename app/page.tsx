"use client";

import { useState } from "react";
import { supabase } from "../utils/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Attempt to log in using Supabase
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // If successful, push them to the POS dashboard
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f16] text-white flex items-center justify-center relative overflow-hidden font-sans">

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

      {/* Optional dark overlay for readability */}
      <div className="absolute inset-0 bg-[#0a0f16]/35 z-[1]" />

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md rounded-xl bg-[#0a0f16]/80 backdrop-blur-md p-8 shadow-2xl border border-gray-800">

        <h1 className="mb-6 text-center text-3xl font-bold text-white">
          Chronara Key
        </h1>

        {error && (
          <div className="mb-4 rounded bg-red-500/10 p-3 text-center text-sm text-red-500 border border-red-500/50">
            {error}
          </div>
        )}

        <form
          onSubmit={handleLogin}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              className="w-full rounded-md border border-gray-700 bg-[#131b26] p-3 text-white outline-none focus:border-[#189777] focus:ring-1 focus:ring-[#189777] transition-colors"
              placeholder="employee@chronarakey.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              className="w-full rounded-md border border-gray-700 bg-[#131b26] p-3 text-white outline-none focus:border-[#189777] focus:ring-1 focus:ring-[#189777] transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-md bg-[#189777] p-3 font-bold text-white hover:brightness-110 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {loading
              ? "Verifying..."
              : "SIGN IN"}
          </button>
        </form>
      </div>
    </div>
  );
}