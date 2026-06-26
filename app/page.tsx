"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "../utils/supabase";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();

  const handleLogin = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/webapp-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const result = await response.json().catch(() => null);

      if (
        !response.ok ||
        !result?.success ||
        !result?.access_token ||
        !result?.refresh_token
      ) {
        setError(
          result?.message ||
            "The Web App username or password is incorrect."
        );
        setLoading(false);
        return;
      }

      const {
        data: sessionData,
        error: sessionError,
      } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });

      if (
        sessionError ||
        !sessionData.session
      ) {
        console.error(
          "Web App session installation failed:",
          sessionError
        );

        setError(
          "Chronara Key verified the login but could not start the session."
        );

        setLoading(false);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (loginError) {
      console.error(
        "Web App login request failed:",
        loginError
      );

      setError(
        "Chronara Key could not connect to the login service. Please try again."
      );

      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0f16] px-4 font-sans text-white">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <Image
          src="/SuiteBackground.png"
          alt=""
          fill
          className="object-cover opacity-60"
          priority
        />
      </div>

      {/* Dark overlay */}
      <div className="absolute inset-0 z-[1] bg-[#0a0f16]/35" />

      <div className="relative z-10 flex w-full flex-col items-center">
        {/* Login card */}
        <section className="w-full max-w-[560px] rounded-xl border border-gray-800 bg-[#0a0f16]/85 px-10 py-10 shadow-2xl backdrop-blur-md">
          <h1 className="mb-8 text-center text-4xl font-bold text-white">
            Chronara Key Online
          </h1>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-center text-sm text-red-400"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={handleLogin}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="webapp-username"
                className="mb-2 block text-base font-medium text-gray-400"
              >
                Web App Username
              </label>

              <input
                id="webapp-username"
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="h-[58px] w-full rounded-md border border-[#314a6b] bg-[#10233d] px-4 text-lg text-white caret-white outline-none transition-colors placeholder:text-[#8fa2ba] focus:border-[#189777] focus:ring-1 focus:ring-[#189777]"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label
                htmlFor="webapp-password"
                className="mb-2 block text-base font-medium text-gray-400"
              >
                Web App Password
              </label>

              <input
                id="webapp-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                className="h-[58px] w-full rounded-md border border-[#314a6b] bg-[#10233d] px-4 text-lg text-white caret-white outline-none transition-colors placeholder:text-[#8fa2ba] focus:border-[#189777] focus:ring-1 focus:ring-[#189777]"
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-7 h-[58px] w-full rounded-md bg-[#189777] text-lg font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "VERIFYING..." : "SIGN IN"}
            </button>
          </form>
        </section>

        {/* Detached setup instructions */}
        <p className="mt-6 max-w-[620px] px-4 text-center text-sm leading-6 text-gray-400">
          To access Chronara Key Online, first create your company&apos;s
          Web App username and password in the Chronara Key desktop program
          under{" "}
          <span className="font-semibold text-gray-200">
            System Setup → Web App
          </span>
          .
        </p>
      </div>
    </main>
  );
}