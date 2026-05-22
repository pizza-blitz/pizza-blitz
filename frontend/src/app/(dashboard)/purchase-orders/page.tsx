"use client";
import React, { useState, useEffect } from 'react';
import { Send, Plus, FileText, CheckCircle2, Search, CornerDownRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { getApiUrl } from '@/lib/api';

export default function PurchaseOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [reorderGroups, setReorderGroups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const [ordersRes, lowStockRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/restaurant/purchase-orders/')),
        fetch(getApiUrl('/api/v1/restaurant/inventory/low-stock')),
      ]);
      const data = await ordersRes.json();
      setOrders(data);
      if (lowStockRes.ok) {
        const lowStock = await lowStockRes.json();
        setReorderGroups(lowStock.groups || []);
      }
    } catch (error) {
      console.error("Failed to fetch orders", error);
    } finally {
      setIsLoading(false);
    }
  };

  const createDrafts = async () => {
    setIsCreatingDrafts(true);
    setMessage("");
    try {
      const response = await fetch(getApiUrl('/api/v1/restaurant/purchase-orders/from-low-stock'), {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not create purchase order drafts.");
      setMessage(
        data.created
          ? `Created ${data.created} purchase order draft${data.created === 1 ? "" : "s"}.`
          : "No low-stock items need reorder drafts."
      );
      await fetchOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create purchase order drafts.");
    } finally {
      setIsCreatingDrafts(false);
    }
  };

  const updatePurchaseOrder = async (orderId: number, action: "sent" | "receive") => {
    const updateKey = `${action}-${orderId}`;
    setUpdatingOrderId(updateKey);
    setMessage("");
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/purchase-orders/${orderId}/${action}`), {
        method: 'PATCH',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not update purchase order.");

      const updatedItems = data.inventory_updates?.length || 0;
      setMessage(
        action === "receive"
          ? `Received PO-${orderId} and updated ${updatedItems} inventory item${updatedItems === 1 ? "" : "s"}.`
          : `Marked PO-${orderId} as sent.`
      );
      await fetchOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update purchase order.");
    } finally {
      setUpdatingOrderId("");
    }
  };

  const statusClass = (status: string) => {
    if (status === "received") return "bg-green-100 text-green-700";
    if (status === "sent") return "bg-blue-100 text-blue-700";
    return "bg-orange-100 text-orange-700";
  };

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
      items.map(i => `- ${i.name}: ${i.reorder_quantity || i.needed} ${i.unit}`).join('\n') +
      `\n\nPlease confirm availability and total bill.\nRegards,\nPizza Blitz`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  };

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
          <button
            onClick={createDrafts}
            disabled={isCreatingDrafts || reorderGroups.length === 0}
            className="px-4 py-2 bg-orange-600 text-white hover:bg-orange-700 rounded-lg font-bold shadow-sm transition-colors flex items-center disabled:bg-gray-300"
          >
            {isCreatingDrafts ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Draft Low-Stock POs
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-gray-900 bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <span className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mr-3 text-sm">1</span>
            Smart Suggestions <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-bold">Low Stock</span>
          </h3>

          {reorderGroups.map((data: any) => (
            <div key={`${data.supplier_name}-${data.supplier_whatsapp}`} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                 <div>
                    <h4 className="font-bold text-gray-900">{data.supplier_name}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {data.supplier_whatsapp ? `WhatsApp: +${data.supplier_whatsapp}` : "No WhatsApp saved"}
                    </p>
                 </div>
                 <Link
                    href={data.supplier_whatsapp ? getWhatsAppLink(data.supplier_name, data.supplier_whatsapp, data.items) : "#"}
                    target="_blank"
                    className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center ${
                      data.supplier_whatsapp
                        ? "bg-[#25D366] hover:bg-[#128C7E] text-white"
                        : "bg-gray-100 text-gray-400 pointer-events-none"
                    }`}
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
                      {item.reorder_quantity} {item.unit}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {reorderGroups.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-dashed border-gray-200 p-8 text-center text-gray-500 font-semibold">
              No low-stock purchase suggestions right now.
            </div>
          )}
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
                    <div key={order.id} className="flex justify-between items-center gap-4 p-3 border border-gray-100 rounded-lg hover:border-orange-200 hover:shadow-sm transition-all group">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">PO-{order.id}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center ${statusClass(order.status)}`}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> {order.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{order.supplier_name} &bull; {new Date(order.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-gray-400 mt-1">{order.items?.length || 0} item{order.items?.length === 1 ? "" : "s"} in this PO</p>
                      </div>
                      <div className="text-right space-y-2">
                        <div className="font-bold text-gray-900">Rs. {order.total_amount?.toLocaleString()}</div>
                        <Link
                          href={`/purchase-orders/${order.id}`}
                          className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                        >
                          Open
                        </Link>
                        {order.status !== "received" && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {order.status !== "sent" && (
                              <button
                                type="button"
                                onClick={() => updatePurchaseOrder(order.id, "sent")}
                                disabled={updatingOrderId === `sent-${order.id}`}
                                className="px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60 flex items-center"
                              >
                                {updatingOrderId === `sent-${order.id}` ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                                Mark Sent
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => updatePurchaseOrder(order.id, "receive")}
                              disabled={updatingOrderId === `receive-${order.id}`}
                              className="px-3 py-1.5 rounded-md border border-green-200 bg-green-50 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-60 flex items-center"
                            >
                              {updatingOrderId === `receive-${order.id}` ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                              Receive
                            </button>
                          </div>
                        )}
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
