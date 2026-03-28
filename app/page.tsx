"use client";

import { useState } from "react";
import { supabase } from "../utils/supabase";
import { useRouter } from "next/navigation";

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
    <div className="flex min-h-screen items-center justify-center bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-gray-800 p-8 shadow-lg border border-gray-700">
        <h1 className="mb-6 text-center text-3xl font-bold text-white">
          Chronara Key
        </h1>
        
        {error && (
          <div className="mb-4 rounded bg-red-500/10 p-3 text-center text-sm text-red-500 border border-red-500/50">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-600 bg-gray-700 p-3 text-white focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-600 bg-gray-700 p-3 text-white focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-md bg-[#00A023] p-3 font-bold text-white hover:bg-[#00671A] disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying..." : "SIGN IN"}
          </button>
        </form>
      </div>
    </div>
  );
}