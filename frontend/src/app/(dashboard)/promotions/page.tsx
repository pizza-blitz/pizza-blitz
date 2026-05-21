"use client";

import { useState, useEffect } from "react";
import { Tag, Calendar, TrendingUp, Plus, Save, Award, Info } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/promotions/");

export default function PromotionsPage() {
  const [promos, setPromos] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    discount_value: 10,
    discount_type: "percentage"
  });

  useEffect(() => { fetchPromos(); }, []);

  const fetchPromos = () => fetch(API_BASE).then(res => res.json()).then(setPromos);

  const savePromo = async (e) => {
    e.preventDefault();
    await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });
    setShowAdd(false);
    fetchPromos();
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent underline decoration-pink-500/20 underline-offset-8">
            Growth & Campaigns
        </h1>
        <button 
          onClick={() => setShowAdd(true)}
          className="bg-white text-black px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-pink-500 hover:text-white transition-all shadow-lg"
        >
          <Plus className="w-5 h-5" /> Launch New Promo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {promos.map((p: any) => (
          <div key={p.id} className="bg-[#1a1a1c] p-8 rounded-[3rem] border border-white/5 relative overflow-hidden group hover:border-pink-500/30 transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/5 blur-3xl rounded-full -mr-12 -mt-12"></div>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-pink-500/10 flex items-center justify-center text-pink-500">
                <Tag className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg">{p.name}</h3>
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{p.discount_value}% {p.discount_type}</p>
              </div>
            </div>

            <div className="flex justify-between items-end">
               <div className="space-y-1">
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Campaign Period</p>
                 <p className="text-xs font-medium text-gray-300">{p.start_date} - {p.end_date}</p>
               </div>
               <div className="text-right">
                  <div className="inline-flex items-center gap-1 bg-green-500/10 text-green-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter border border-green-500/20">
                    <TrendingUp className="w-3 h-3" /> Effectiveness High
                  </div>
               </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <form onSubmit={savePromo} className="w-full max-w-lg bg-[#1a1a1c] border border-white/10 rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300">
             <h2 className="text-2xl font-bold mb-8 text-center text-pink-400">Setup Marketing Trigger</h2>
             <div className="space-y-4">
                <input type="text" placeholder="Promo Name (e.g. IPL Finals Spec)" required value={formData.name} onChange={(e)=>setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl outline-none focus:border-pink-500" />
                <div className="grid grid-cols-2 gap-4">
                   <input type="date" value={formData.start_date} onChange={(e)=>setFormData({...formData, start_date: e.target.value})} className="bg-white/5 border border-white/10 p-5 rounded-2xl outline-none" />
                   <input type="date" value={formData.end_date} onChange={(e)=>setFormData({...formData, end_date: e.target.value})} className="bg-white/5 border border-white/10 p-5 rounded-2xl outline-none" />
                </div>
                <div className="flex gap-4 pt-6">
                   <button type="button" onClick={()=>setShowAdd(false)} className="flex-1 p-5 rounded-2xl font-bold text-gray-500">Cancel</button>
                   <button type="submit" className="flex-1 bg-pink-500 text-white p-5 rounded-2xl font-black hover:bg-pink-600 transition-all active:scale-95 shadow-xl shadow-pink-500/20">Active Campaign</button>
                </div>
             </div>
          </form>
        </div>
      )}
    </div>
  );
}
