"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, ReceiptText, ShieldCheck, ShoppingBag } from "lucide-react";
import { getApiUrl } from "@/lib/api";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"otp" | "order">("otp");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [orderId, setOrderId] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [debugCode, setDebugCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const requestCode = async () => {
    if (!phone.trim()) {
      setMessage("Enter your phone number.");
      return;
    }
    setIsSending(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/auth/customer/otp/request"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not send the code.");
      setOtpSent(true);
      setDebugCode(data.debug_code || "");
      setMessage("Verification code sent. It expires in 5 minutes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the code.");
    } finally {
      setIsSending(false);
    }
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "otp" && !otpSent) {
      await requestCode();
      return;
    }
    setIsSubmitting(true);
    setMessage("");

    const body =
      mode === "otp" ? { phone, otp } : { phone, order_id: orderId };
    const response = await fetch("/api/customer-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setIsSubmitting(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not sign in with those details.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next || "/account");
    router.refresh();
  };

  return (
    <div
      data-testid="customer-login"
      data-hydrated={hydrated ? "true" : "false"}
      className="min-h-screen bg-[#f8fafc] text-slate-950"
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">Customer Login</h1>
          </div>
          <Link
            href="/order"
            className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
          >
            <ShoppingBag className="h-4 w-4" /> Order Food
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl justify-center px-5 py-10">
        <form
          onSubmit={signIn}
          className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6"
        >
          <p className="text-sm font-black uppercase tracking-widest text-red-700">
            My orders
          </p>
          <h2 className="mt-2 text-3xl font-black">Sign in to see your orders.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Use a one-time code sent to your phone, or the phone number and order ID
            from a recent receipt.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("otp");
                setMessage("");
              }}
              className={`rounded-md px-3 py-2 text-xs font-black uppercase tracking-widest ${
                mode === "otp"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              One-time code
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("order");
                setMessage("");
              }}
              className={`rounded-md px-3 py-2 text-xs font-black uppercase tracking-widest ${
                mode === "order"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Order details
            </button>
          </div>

          {message && (
            <div className="mt-5 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {message}
            </div>
          )}

          {debugCode && (
            <div
              data-testid="customer-otp-debug"
              className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
            >
              Development code: <span className="tracking-[0.3em]">{debugCode}</span>
            </div>
          )}

          <label className="mt-6 flex items-center gap-3 rounded-md border border-slate-300 px-3 py-3 focus-within:border-red-600">
            <Phone className="h-4 w-4 text-slate-400" />
            <input
              aria-label="Phone number"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setOtpSent(false);
                setDebugCode("");
              }}
              placeholder="Phone number"
              inputMode="tel"
              required
              className="w-full outline-none"
            />
          </label>

          {mode === "otp" ? (
            <>
              {otpSent && (
                <label className="mt-3 flex items-center gap-3 rounded-md border border-slate-300 px-3 py-3 focus-within:border-red-600">
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                  <input
                    aria-label="Verification code"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    className="w-full tracking-[0.3em] outline-none"
                  />
                </label>
              )}
              <button
                type={otpSent ? "submit" : "button"}
                onClick={otpSent ? undefined : requestCode}
                disabled={isSending || isSubmitting}
                className="mt-4 w-full rounded-md bg-slate-950 px-5 py-3 font-black text-white hover:bg-red-700 disabled:bg-slate-300"
              >
                {otpSent
                  ? isSubmitting
                    ? "Verifying"
                    : "Verify and sign in"
                  : isSending
                    ? "Sending code"
                    : "Send verification code"}
              </button>
              {otpSent && (
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={isSending}
                  className="mt-2 w-full text-xs font-bold text-slate-500 hover:text-red-700"
                >
                  Send a new code
                </button>
              )}
            </>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-3 rounded-md border border-slate-300 px-3 py-3 focus-within:border-red-600">
                <ReceiptText className="h-4 w-4 text-slate-400" />
                <input
                  aria-label="Recent order ID"
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  placeholder="Recent order ID"
                  inputMode="numeric"
                  required
                  className="w-full outline-none"
                />
              </label>
              <button
                disabled={isSubmitting}
                className="mt-4 w-full rounded-md bg-slate-950 px-5 py-3 font-black text-white hover:bg-red-700 disabled:bg-slate-300"
              >
                {isSubmitting ? "Checking" : "View My Orders"}
              </button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
