"use client";
"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package, Plus, Search, AlertTriangle, RefreshCw, Upload, Save, CheckCircle2, History, TrendingUp, Camera, Sparkles } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

export default function Inventory() {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/inventory/items'));
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      } else {
        // Fallback mock
        const mockItems = [
          { id: 1, name: "Pizza Flour", category: "Raw Material", current_stock: 45, minimum_stock: 50, unit: "kg", cost_per_unit: 45 },
          { id: 2, name: "Mozzarella Cheese", category: "Dairy", current_stock: 12, minimum_stock: 10, unit: "kg", cost_per_unit: 450 },
          { id: 3, name: "Tomato Sauce", category: "Sauces", current_stock: 8, minimum_stock: 15, unit: "liters", cost_per_unit: 120 },
        ];
        setItems(mockItems);
      }
      setIsLoading(false);
    } catch (err) { console.error(err); setIsLoading(false); }
  };

  const handleAdjust = async (type: 'purchase' | 'usage' | 'wastage', qty: number) => {
    setIsAdjusting(true);
    await new Promise(r => setTimeout(r, 1000));
    setItems(items.map(i => i.id === selectedItem.id ? {
      ...i, 
      current_stock: type === 'purchase' ? i.current_stock + qty : i.current_stock - qty 
    } : i));
    setIsAdjusting(false);
    setSelectedItem(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-500 mt-1">Track stock levels, record purchases, and process invoices.</p>
        </div>
        <div className="flex space-x-3">
          <a href="/inventory/scan"
            className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold inline-flex items-center gap-2">
            📷 Scan Bill
          </a>
           <button className="bg-orange-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-orange-100 flex items-center hover:bg-orange-700 transition-all">
             <Plus className="w-5 h-5 mr-2" /> Add Item
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Stock Table */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center relative">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Search stock items..."
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-orange-500 outline-none transition-all"
            />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-4 font-bold text-gray-700">Item Name</th>
                  <th className="px-6 py-4 font-bold text-gray-700">Stock Status</th>
                  <th className="px-6 py-4 font-bold text-gray-700 text-right">Current</th>
                  <th className="px-6 py-4 font-bold text-gray-700 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item: any) => {
                  const isLow = item.current_stock < item.minimum_stock;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900">{item.name}</div>
                        <div className="text-xs text-gray-400">{item.category}</div>
                      </td>
                      <td className="px-6 py-4">
                        {isLow ? (
                          <span className="flex items-center text-red-600 text-xs font-bold bg-red-50 px-2 py-1 rounded-full w-fit">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Low Stock
                          </span>
                        ) : (
                          <span className="flex items-center text-green-600 text-xs font-bold bg-green-50 px-2 py-1 rounded-full w-fit">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Healthy
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{item.current_stock}</span>
                        <span className="text-xs text-gray-400 ml-1">{item.unit}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button 
                          onClick={() => setSelectedItem(item)}
                          className="mx-auto block p-2 hover:bg-orange-50 text-orange-600 rounded-lg transition-colors"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sidebar Tools */}
        <div className="space-y-6">
          {/* Quick Adjustment Form */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-100">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-orange-600" />
              Stock Adjustment
            </h3>
            {selectedItem ? (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <div className="p-3 bg-orange-50 rounded-xl border border-orange-100">
                  <span className="text-xs text-orange-800 font-bold uppercase">Adjusting</span>
                  <div className="font-bold text-gray-900">{selectedItem.name}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['Purchase', 'Usage', 'Wastage'].map(type => (
                    <button 
                      key={type}
                      onClick={() => handleAdjust(type.toLowerCase() as any, 1)}
                      className="py-2 text-xs font-bold rounded-lg border border-gray-200 hover:border-orange-500 hover:bg-orange-50 transition-all capitalize"
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="w-full py-2 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic pb-4 text-center">Select an item to adjust stock levels.</p>
            )}
          </div>

          {/* AI Invoice Scanner */}
          <Link href="/inventory/scan" className="block transform transition-transform hover:scale-[1.02] active:scale-95">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-6 rounded-2xl shadow-xl text-white">
              <h3 className="font-bold mb-2 flex items-center">
                <Sparkles className="w-5 h-5 mr-2 text-orange-400" />
                AI Invoice Scanner
              </h3>
              <p className="text-xs text-gray-300 mb-4">Upload a photo of your stock receipt. Gemini will extract items and update stock automatically.</p>
              
              <div className="border-2 border-dashed border-gray-600 rounded-xl p-6 text-center border-orange-400/30 group-hover:border-orange-400 transition-colors cursor-pointer">
                <Upload className="w-8 h-8 mx-auto mb-2 text-orange-400" />
                <div className="text-sm font-bold text-white">Open AI Scanner</div>
                <div className="text-[10px] text-gray-500 mt-1">Camera + OCR Enabled</div>
              </div>
              
              <div className="w-full mt-4 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-bold text-center transition-all shadow-lg text-white">
                Process with Gemini
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
