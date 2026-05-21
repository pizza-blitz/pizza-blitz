"use client";

import { useState, useEffect } from "react";
import { Truck, TrendingUp, AlertTriangle, Search, Info, Plus, ChevronRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/vendors");

export default function VendorPricePage() {
  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [itemSearch, setItemSearch] = useState("Amul Cheese");
  const [cheapest, setCheapest] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/prices/alerts/increases`).then(res => res.json()).then(setAlerts);
    loadItemData(itemSearch);
  }, []);

  const loadItemData = async (name) => {
    const [hRes, cRes] = await Promise.all([
      fetch(`${API_BASE}/prices/history/${name}`),
      fetch(`${API_BASE}/intelligence/cheapest/${name}`)
    ]);
    setHistory(await hRes.json());
    setCheapest(await cRes.json());
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent underline decoration-blue-500/20 underline-offset-8">
            Vendor Price Intelligence
        </h1>
        <div className="flex items-center gap-3">
           <input 
             type="text" value={itemSearch} onChange={(e)=>setItemSearch(e.target.value)}
             className="bg-white/5 border border-white/10 p-3 px-5 rounded-2xl outline-none focus:border-blue-500"
             placeholder="Search Item..."
           />
           <button onClick={()=>loadItemData(itemSearch)} className="bg-white text-black p-3 px-6 rounded-2xl font-bold hover:bg-blue-500 hover:text-white transition-all">Analyze</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Alerts & Cheapest */}
        <div className="lg:col-span-4 space-y-6">
           <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
             <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-6 flex items-center gap-2">
               <AlertTriangle className="w-4 h-4 text-orange-500" /> Price Spike Alerts
             </h3>
             <div className="space-y-4">
                {alerts.map((a:any, idx) => (
                  <div key={idx} className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl flex justify-between items-center">
                    <div>
                        <p className="font-bold text-sm">{a.item_name}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Vendor: {a.vendor_name}</p>
                    </div>
                    <span className="text-red-400 font-black text-xs">+{a.pct_increase.toFixed(1)}%</span>
                  </div>
                ))}
             </div>
           </div>

           <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-6">Vendor Comparison</h3>
              <div className="space-y-3">
                {cheapest.map((v:any, idx) => (
                   <div key={idx} className={`p-4 rounded-2xl border ${idx === 0 ? 'bg-green-500/10 border-green-500/20' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex justify-between items-center">
                         <span className="font-bold text-sm">{v.vendor_name}</span>
                         <span className="font-mono font-black text-sm">₹{v.price_per_unit}</span>
                      </div>
                      {idx === 0 && <span className="text-[8px] font-black text-green-500 uppercase tracking-widest mt-1 block">Best Price Found</span>}
                   </div>
                ))}
              </div>
           </div>
        </div>

        {/* Price History Chart */}
        <div className="lg:col-span-8 bg-[#1a1a1c] p-8 rounded-[3rem] border border-white/5">
            <h3 className="text-lg font-bold mb-8 flex items-center gap-2 capitalize">
              <TrendingUp className="w-5 h-5 text-blue-400" /> {itemSearch} Price Trends
            </h3>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 400 }}>
                <LineChart data={history.reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2c" vertical={false} />
                  <XAxis dataKey="recorded_date" stroke="#666" fontSize={10} tickFormatter={(str)=>str.split(' ')[0]} />
                  <YAxis stroke="#666" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '1.5rem', backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                  <Line type="monotone" dataKey="price_per_unit" stroke="#3b82f6" strokeWidth={4} dot={{ r: 6, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 8 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
}
