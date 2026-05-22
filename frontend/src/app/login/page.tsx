"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Login() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    const response = await fetch("/api/admin-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.detail || "Could not sign in.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next || "/");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-orange-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-orange-600 mb-2">Pizza Blitz</h1>
          <p className="text-gray-500 font-medium">Restaurant Management Portal</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-6">
          {message && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {message}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Admin ID</label>
            <input 
              type="text" 
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all"
              placeholder="Enter admin ID"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all"
              placeholder="Enter password"
              required
            />
          </div>
          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-orange-200 flex justify-center items-center transform hover:-translate-y-0.5"
          >
            {isSubmitting ? "Signing In" : "Sign In to Portal"}
          </button>
        </form>
        <div className="mt-6 border-t border-gray-100 pt-5 text-center">
          <Link href="/order" className="font-bold text-orange-700 hover:text-orange-900">
            Continue as Customer
          </Link>
        </div>
      </div>
    </div>
  );
}
