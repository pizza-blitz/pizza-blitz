"use client";

import { useState, useEffect } from "react";
import { Utensils, Users, Plus, CheckCircle2, Clock, ShoppingBag, X } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/orders/");

export default function OrdersPage() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [items, setItems] = useState([
    { name: "Margherita Pizza", price: 450, quantity: 1 },
    { name: "Pepperoni Pizza", price: 550, quantity: 1 },
    { name: "Garlic Bread", price: 150, quantity: 1 },
    { name: "Coke", price: 60, quantity: 1 }
  ]);

  useEffect(() => {
    fetch(`${API_BASE}tables`).then(res => res.json()).then(setTables);
  }, []);

  const createOrder = async () => {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_type: selectedTable ? "dine-in" : "takeaway",
        table_number: selectedTable,
        items: items.filter(i => i.quantity > 0)
      })
    });
    const data = await res.json();
    alert(`Order CREATED: ID ${data.order_id}`);
    setShowOrderModal(false);
    fetch(`${API_BASE}tables`).then(res => res.json()).then(setTables);
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent underline decoration-orange-500/20 underline-offset-8">
            Visual POS Hub
        </h1>
        <button 
          onClick={() => { setSelectedTable(null); setShowOrderModal(true); }}
          className="bg-white text-black px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-orange-500 hover:text-white transition-all shadow-lg active:scale-95"
        >
          <Plus className="w-5 h-5" /> Takeaway Order
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {tables.map((table) => (
          <div 
            key={table.id}
            onClick={() => { setSelectedTable(table.table_number); setShowOrderModal(true); }}
            className={`cursor-pointer group relative p-8 rounded-[2.5rem] border transition-all duration-300 ${
              table.status === 'occupied' 
              ? 'bg-orange-500/10 border-orange-500/30' 
              : 'bg-[#1a1a1c] border-white/5 hover:border-orange-500/30 hover:bg-[#1e1e21]'
            }`}
          >
            <div className="flex justify-between items-start mb-6">
              <span className={`text-4xl font-black ${table.status === 'occupied' ? 'text-orange-500' : 'text-gray-700'}`}>
                {table.table_number}
              </span>
              <div className={`p-2 rounded-xl ${table.status === 'occupied' ? 'bg-orange-500/20' : 'bg-white/5'}`}>
                <Utensils className={`w-5 h-5 ${table.status === 'occupied' ? 'text-orange-500' : 'text-gray-500'}`} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 tracking-widest uppercase">
              <Users className="w-4 h-4" /> {table.capacity} Seater
            </div>
            
            <div className={`mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase ${table.status === 'occupied' ? 'text-orange-400' : 'text-green-500'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${table.status === 'occupied' ? 'bg-orange-500 animate-pulse' : 'bg-green-500'}`} />
              {table.status}
            </div>
          </div>
        ))}
      </div>

      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md h-full bg-[#1a1a1c] border-l border-white/10 p-8 flex flex-col shadow-2xl animate-in slide-in-from-right duration-500">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-orange-400">
                {selectedTable ? `Table ${selectedTable}` : 'Takeaway'} Order
              </h2>
              <button onClick={() => setShowOrderModal(false)} className="p-2 hover:bg-white/5 rounded-xl"><X /></button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                  <div>
                    <p className="font-bold">{item.name}</p>
                    <p className="text-xs text-gray-500">₹{item.price}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" min="0" value={item.quantity}
                      onChange={(e) => {
                        const newItems = [...items];
                        newItems[idx].quantity = parseInt(e.target.value) || 0;
                        setItems(newItems);
                      }}
                      className="w-16 bg-black/40 border border-white/10 p-2 rounded-xl text-center font-bold"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={createOrder}
              className="mt-8 w-full bg-orange-500 p-4 rounded-2xl font-bold text-lg hover:bg-orange-600 active:scale-95 transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)]"
            >
              Send to Kitchen (KOT)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
