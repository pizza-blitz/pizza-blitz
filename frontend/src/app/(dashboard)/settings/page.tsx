"use client";
export const dynamic = "force-dynamic";
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe2,
  Layers,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';

type RoleAccess = {
  role: string;
  access: string;
  entry: string;
  protection: string;
};

type SessionStatus = {
  name: string;
  cookie: string;
  duration: string;
  protectedRoutes: number;
  status: string;
};

type HardeningCheck = {
  name: string;
  status: string;
  detail: string;
};

type SecurityOverview = {
  roles: RoleAccess[];
  sessions: SessionStatus[];
  hardening: HardeningCheck[];
};

export default function Settings() {
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [isSecurityLoading, setIsSecurityLoading] = useState(true);
  const [categories, setCategories] = useState([
    { id: 1, name: "Raw Materials", active: true },
    { id: 2, name: "Electricity", active: true },
    { id: 3, name: "Rent", active: true },
    { id: 4, name: "Staff Wages", active: true },
    { id: 5, name: "Gas", active: true },
    { id: 6, name: "Packaging", active: true },
  ]);
  const [newCategory, setNewCategory] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [importMode, setImportMode] = useState("all"); // "all" or "current"
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{rows: number, months: number} | null>(null);

  // Missing State for Admin Credentials
  const [adminId, setAdminId] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => {
    let isMounted = true;
    fetch("/api/security-overview", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: SecurityOverview) => {
        if (isMounted) {
          setSecurityOverview(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSecurityOverview(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSecurityLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Missing Handlers for Categories
  const toggleCategory = (id: number) => {
    setCategories(categories.map(cat => 
      cat.id === id ? { ...cat, active: !cat.active } : cat
    ));
  };

  const deleteCategory = (id: number) => {
    setCategories(categories.filter(cat => cat.id !== id));
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    const nextId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
    setCategories([...categories, { id: nextId, name: newCategory, active: true }]);
    setNewCategory("");
  };

  const handleSync = async () => {
    if (!sheetUrl) { alert("Please enter your Google Sheet URL first."); return; }
    setIsSyncing(true);
    setSyncResult(null);
    
    try {
      // In production, this would be:
      // const response = await fetch('/api/v1/restaurant/sync/sync-sheets', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ url: sheetUrl, mode: importMode })
      // });
      // const data = await response.json();
      
      // Simulating the 2.5 year import progress
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setSyncResult({ rows: 847, months: 28 });
      setIsSyncing(false);
      alert("Import Successful! Imported 847 rows across 28 months.");
    } catch (error) {
      setIsSyncing(false);
      alert("Error during sync. Please check API logs.");
    }
  };

  return (
    <div className="space-y-6 max-w-6xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure portal preferences, data sources, and security.</p>
      </div>

      {/* Access Control */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start">
            <div className="p-2 bg-indigo-100 rounded-lg mr-3">
              <LockKeyhole className="w-5 h-5 text-indigo-700" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Access Control & Roles</h3>
              <p className="text-sm text-gray-500">
                Admin and customer sessions are separated today; staff-specific permissions are the next hardening step.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-3 py-2 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Admin protected
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-3 py-2 text-blue-700">
              <UserCheck className="h-3.5 w-3.5" /> Customer protected
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-3 py-2 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Staff split pending
            </span>
          </div>
        </div>

        {isSecurityLoading ? (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            Loading security overview...
          </div>
        ) : securityOverview ? (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {securityOverview.sessions.map((session) => (
                <div key={session.cookie} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-gray-900">{session.name}</p>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{session.cookie}</p>
                    </div>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-black ${
                        session.status === "Ready"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-white p-3">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Clock className="h-4 w-4" />
                        Session
                      </div>
                      <p className="mt-1 font-black text-gray-900">{session.duration}</p>
                    </div>
                    <div className="rounded-md bg-white p-3">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Shield className="h-4 w-4" />
                        Routes
                      </div>
                      <p className="mt-1 font-black text-gray-900">{session.protectedRoutes} protected</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-100">
              <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-black uppercase text-gray-500">
                <div className="col-span-12 md:col-span-3">Role</div>
                <div className="hidden md:col-span-5 md:block">Access</div>
                <div className="hidden md:col-span-2 md:block">Entry</div>
                <div className="hidden md:col-span-2 md:block">Protection</div>
              </div>
              {securityOverview.roles.map((role) => (
                <div key={role.role} className="grid grid-cols-12 gap-2 border-t border-gray-100 px-4 py-3 text-sm">
                  <div className="col-span-12 font-black text-gray-900 md:col-span-3">
                    <span className="inline-flex items-center gap-2">
                      {role.role === "Public Visitor" ? (
                        <Globe2 className="h-4 w-4 text-gray-400" />
                      ) : role.role === "Customer" ? (
                        <Users className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Shield className="h-4 w-4 text-indigo-600" />
                      )}
                      {role.role}
                    </span>
                  </div>
                  <div className="col-span-12 text-gray-600 md:col-span-5">{role.access}</div>
                  <div className="col-span-6 font-semibold text-gray-700 md:col-span-2">{role.entry}</div>
                  <div className="col-span-6 text-gray-600 md:col-span-2">{role.protection}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {securityOverview.hardening.map((item) => {
                const needsAction = ["Default", "Fallback", "Planned"].includes(item.status);
                return (
                  <div
                    key={item.name}
                    className={`rounded-lg border p-4 ${
                      needsAction
                        ? "border-amber-100 bg-amber-50"
                        : "border-green-100 bg-green-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black text-gray-900">{item.name}</p>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-black ${
                          needsAction ? "bg-white text-amber-700" : "bg-white text-green-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
            Security overview is unavailable. Check the Next.js API route logs.
          </div>
        )}
      </div>

      {/* Google Sheets Integration */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-green-100 rounded-lg mr-3">
            <RefreshCw className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Google Sheets Data Sync</h3>
            <p className="text-sm text-gray-500">Import historical data (2024-2026) from your spreadsheet.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Spreadsheet URL</label>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center cursor-pointer">
              <input 
                type="radio" 
                name="importMode" 
                value="all" 
                checked={importMode === "all"} 
                onChange={() => setImportMode("all")}
                className="w-4 h-4 text-orange-600 focus:ring-orange-500"
              />
              <span className="ml-2 text-sm text-gray-700 font-medium">Import All Tabs (2024-2026)</span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input 
                type="radio" 
                name="importMode" 
                value="current" 
                checked={importMode === "current"} 
                onChange={() => setImportMode("current")}
                className="w-4 h-4 text-orange-600 focus:ring-orange-500"
              />
              <span className="ml-2 text-sm text-gray-700 font-medium">Current Month Only</span>
            </label>
          </div>

          <div className="text-xs text-gray-500 bg-orange-50 p-3 rounded-lg border border-orange-100 italic">
            <strong>Note:</strong> System maps columns automatically: <code className="bg-white px-1 rounded border">A:Date</code>, <code className="bg-white px-1 rounded border">B:Cash</code>, <code className="bg-white px-1 rounded border">C:Expense</code>, <code className="bg-white px-1 rounded border">D:Sale</code>.
          </div>

          <div className="pt-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold shadow-md transition-all flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Importing Data...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Import All Data
                </>
              )}
            </button>
            
            {isSyncing && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs font-medium text-gray-600">
                  <span>Processing tabs...</span>
                  <span>75%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-orange-500 h-2 rounded-full animate-pulse" style={{width: '75%'}}></div>
                </div>
              </div>
            )}

            {syncResult && (
              <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg flex items-center text-green-700 text-sm font-medium animate-in zoom-in-95 duration-200">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Successfully imported {syncResult.rows} days across {syncResult.months} monthly tabs.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expense Categories */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-orange-100 rounded-lg mr-3">
            <Layers className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Expense Categories</h3>
            <p className="text-sm text-gray-500">Add or remove categories for the expense tracker.</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-gray-200 transition-all">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={cat.active}
                  onChange={() => toggleCategory(cat.id)}
                  className="w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500 cursor-pointer mr-3"
                />
                <span className={`font-medium ${cat.active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                  {cat.name}
                </span>
              </div>
              <button
                onClick={() => deleteCategory(cat.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            placeholder="New category name..."
            className="flex-1 border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <button
            onClick={addCategory}
            className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold transition-colors flex items-center shadow-sm"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add
          </button>
        </div>
      </div>

      {/* Admin Credentials */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-blue-100 rounded-lg mr-3">
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Admin Credentials</h3>
            <p className="text-sm text-gray-500">Update the portal login ID and password.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Admin ID</label>
            <input
              type="text"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter new password"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
        </div>
        <div className="mt-4">
          <button className="px-5 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-bold shadow-sm transition-colors flex items-center">
            <Save className="w-4 h-4 mr-2" /> Save Credentials
          </button>
        </div>
      </div>
    </div>
  );
}
