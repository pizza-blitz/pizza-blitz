"use client";
import React, { useState } from "react";
import Link from "next/link";
import { ShieldCheck, UserCog } from "lucide-react";

type PortalRole = "admin" | "staff";

export default function Login() {
  const [role, setRole] = useState<PortalRole>("admin");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    const response = await fetch("/api/admin-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password, role }),
    });
    const data = await response.json().catch(() => ({}));
    setIsSubmitting(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not sign in.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next || data.startPath || (role === "staff" ? "/orders" : "/dashboard"));
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
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "admin" as PortalRole, label: "Admin", icon: ShieldCheck },
              { id: "staff" as PortalRole, label: "Counter Staff", icon: UserCog },
            ].map((item) => {
              const Icon = item.icon;
              const active = role === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setRole(item.id);
                    setId("");
                    setPassword("");
                    setMessage("");
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-black transition-all ${
                    active
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-200 bg-white text-gray-500 hover:border-orange-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {role === "staff" ? "Staff ID" : "Admin ID"}
            </label>
            <input 
              type="text" 
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all"
              placeholder={role === "staff" ? "Enter staff ID" : "Enter admin ID"}
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
            {isSubmitting
              ? "Signing In"
              : role === "staff"
                ? "Sign In to Counter"
                : "Sign In to Portal"}
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
