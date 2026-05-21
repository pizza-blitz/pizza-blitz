"use client";

import { useState, useEffect } from "react";
import { User, Clock, Calendar, Save, TrendingUp, Users } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/shifts/");

export default function ShiftLogPage() {
  const [shifts, setShifts] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    staff_name: "",
    role: "Chef",
    shift_start: "11:00",
    shift_end: "23:00",
    notes: ""
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [sRes, pRes] = await Promise.all([
      fetch(API_BASE),
      fetch(`${API_BASE}performance`)
    ]);
    setShifts(await sRes.json());
    setPerformance(await pRes.json());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setFormData({ ...formData, staff_name: "", notes: "" });
    fetchData();
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
          Staff Shift Ledger
        </h1>
        <div className="flex items-center gap-4 bg-white/5 p-2 px-4 rounded-2xl border border-white/10">
          <Users className="w-5 h-5 text-orange-400" />
          <span className="text-sm font-semibold">{performance.length} Staff Members Active</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Log Form */}
        <div className="bg-[#1a1a1c] p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" /> New Shift Entry
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase ml-1">Staff Name</label>
              <input 
                type="text" required value={formData.staff_name}
                onChange={(e) => setFormData({...formData, staff_name: e.target.value})}
                className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl mt-1 focus:border-orange-500 transition-colors outline-none"
                placeholder="Name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase ml-1">Start</label>
                <input type="time" value={formData.shift_start} onChange={(e)=>setFormData({...formData, shift_start: e.target.value})} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl mt-1 outline-none"/>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase ml-1">End</label>
                <input type="time" value={formData.shift_end} onChange={(e)=>setFormData({...formData, shift_end: e.target.value})} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl mt-1 outline-none"/>
              </div>
            </div>
            <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 p-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-orange-500/20">
              <Save className="w-5 h-5" /> Log Shift
            </button>
          </form>
        </div>

        {/* Performance */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          {performance.map((staff) => (
            <div key={staff.staff_name} className="bg-gradient-to-br from-[#1a1a1c] to-[#0a0a0b] p-6 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/10 blur-3xl rounded-full -mr-12 -mt-12 group-hover:bg-orange-500/20 transition-all"></div>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-orange-500/20 flex items-center justify-center">
                  <User className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{staff.staff_name}</h3>
                  <span className="text-xs text-gray-500 font-bold uppercase tracking-widest">{staff.days_worked} Days Worked</span>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-tighter">Avg. Sales Daily</p>
                  <p className="text-2xl font-black">₹{Math.round(staff.avg_revenue_on_shift_days).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-tighter">Personal Best</p>
                  <p className="text-lg font-bold text-green-400">₹{Math.round(staff.best_day_revenue).toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
