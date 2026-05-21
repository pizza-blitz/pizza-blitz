"use client";
import React, { useState, useEffect } from 'react';
import { Send, Upload, Plus, FileText, CheckCircle2, Search, CornerDownRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { getApiUrl } from '@/lib/api';

export default function PurchaseOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/purchase-orders/'));
      const data = await res.json();
      setOrders(data);
    } catch (error) {
      console.error("Failed to fetch orders", error);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestedItems = [
    { id: 1, name: "Tomato Sauce", supplier: "Fresh Farms Inc.", whatsapp: "919876543210", needed: 10, unit: "kg" },
    { id: 2, name: "Pizza Base (9 inch)", supplier: "Bakers World", whatsapp: "919988776655", needed: 50, unit: "pcs" },
    { id: 3, name: "Mozzarella Cheese", supplier: "Dairy Best", whatsapp: "919988776655", needed: 8, unit: "kg" },
  ];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', e.target.files[0]);

      try {
        const res = await fetch(getApiUrl('/api/v1/restaurant/import/pdf'), {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
        alert(`Successfully imported ${result.imported} records from PDF!`);
        fetchOrders();
      } catch (error) {
        alert("Failed to process PDF note.");
      } finally {
        setIsUploading(false);
      }
    }
  };

  const getWhatsAppLink = (supplier: string, phone: string, items: any[]) => {
    const text = `Hello ${supplier},\n\nPlease send the following supplies for Pizza Blitz today:\n\n` + 
      items.map(i => `- ${i.name}: ${i.needed} ${i.unit}`).join('\n') + 
      `\n\nPlease confirm availability and total bill.\nRegards,\nPizza Blitz`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  };

  const ordersBySupplier = suggestedItems.reduce((acc: any, item) => {
    if (!acc[item.whatsapp]) acc[item.whatsapp] = { supplier: item.supplier, items: [] };
    acc[item.whatsapp].items.push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-gray-500 mt-1">Manage suppliers and auto-generate WhatsApp orders.</p>
        </div>
        <div className="flex gap-3">
          <label className="cursor-pointer px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 rounded-lg font-medium shadow-sm transition-colors flex items-center">
             {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
             {isUploading ? "Processing..." : "Upload Handwritten Note (PDF)"}
             <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-gray-900 bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <span className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mr-3 text-sm">1</span>
            Smart Suggestions <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-bold">Low Stock</span>
          </h3>
          
          {Object.entries(ordersBySupplier).map(([phone, data]: [string, any]) => (
            <div key={phone} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                 <div>
                    <h4 className="font-bold text-gray-900">{data.supplier}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">WhatsApp: +{phone}</p>
                 </div>
                 <Link 
                    href={getWhatsAppLink(data.supplier, phone, data.items)}
                    target="_blank"
                    className="px-4 py-2 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center"
                 >
                    <Send className="w-4 h-4 mr-2" />
                    Send via WhatsApp
                 </Link>
              </div>
              <div className="p-4 space-y-3">
                {data.items.map((item: any) => (
                  <div key={item.id} className="flex justify-between items-center text-sm">
                    <div className="flex items-center text-gray-700">
                      <CornerDownRight className="w-4 h-4 mr-2 text-gray-400" />
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <div className="font-bold border border-gray-200 bg-gray-50 px-3 py-1 rounded-md text-gray-900">
                      {item.needed} {item.unit}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
               <h3 className="text-lg font-bold text-gray-900">Recent PO History</h3>
               <div className="relative">
                 <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                 <input type="text" placeholder="Search orders..." className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-md text-sm outline-none focus:border-orange-500" />
               </div>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
              ) : orders.length === 0 ? (
                <div className="text-center p-8 text-gray-400 italic">No purchase orders found.</div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <div key={order.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg hover:border-orange-200 hover:shadow-sm transition-all group cursor-pointer">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">PO-{order.id}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center ${
                            order.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                          }`}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> {order.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{order.supplier_name} &bull; {new Date(order.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">₹{order.total_amount?.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
