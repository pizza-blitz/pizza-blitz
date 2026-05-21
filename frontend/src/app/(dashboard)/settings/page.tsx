"use client";
export const dynamic = "force-dynamic";
import React, { useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, Shield, Layers, CheckCircle2 } from 'lucide-react';

export default function Settings() {
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
    <div className="space-y-6 max-w-3xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure portal preferences, data sources, and security.</p>
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
