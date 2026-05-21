"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Printer,
  RefreshCw,
  ShoppingBag,
  Utensils,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");
const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu");

type MenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  is_available: boolean;
  quantity?: number;
};

type Table = {
  id: number;
  table_number: string;
  capacity: number;
  status: string;
  current_order_id?: number | null;
};

type Order = {
  id: number;
  order_type: string;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: Array<{ name: string; quantity: number; price: number }>;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  status: string;
  created_at?: string | null;
};

const emptyCustomer = {
  customer_name: "",
  customer_phone: "",
  payment_method: "cash",
  discount_amount: 0,
  notes: "",
};

export default function OrdersPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [formData, setFormData] = useState(emptyCustomer);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedItems = useMemo(
    () => menuItems.filter((item) => Number(item.quantity || 0) > 0),
    [menuItems]
  );
  const subtotal = selectedItems.reduce(
    (sum, item) => sum + Number(item.selling_price || 0) * Number(item.quantity || 0),
    0
  );
  const discount = Math.max(Number(formData.discount_amount || 0), 0);
  const taxableSubtotal = Math.max(subtotal - discount, 0);
  const tax = taxableSubtotal * 0.05;
  const total = taxableSubtotal + tax;
  const openOrders = orders.filter((order) => order.status !== "closed");
  const closedTotal = orders
    .filter((order) => order.status === "closed")
    .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [tablesRes, menuRes, todayRes] = await Promise.all([
      fetch(`${ORDERS_API}/tables`),
      fetch(MENU_API),
      fetch(`${ORDERS_API}/today`),
    ]);

    setTables(await tablesRes.json());
    const menu = await menuRes.json();
    setMenuItems(
      menu
        .filter((item: MenuItem) => item.is_available)
        .map((item: MenuItem) => ({ ...item, quantity: 0 }))
    );
    const today = await todayRes.json();
    setOrders(today.orders || []);
  };

  const resetOrderForm = () => {
    setFormData(emptyCustomer);
    setMenuItems((current) => current.map((item) => ({ ...item, quantity: 0 })));
  };

  const openOrderModal = (table?: Table) => {
    if (table?.status === "occupied") {
      setMessage(`Table ${table.table_number} already has order #${table.current_order_id}. Close it before starting another.`);
      return;
    }
    setSelectedTable(table?.table_number || null);
    resetOrderForm();
    setShowOrderModal(true);
    setMessage("");
  };

  const updateQuantity = (id: number, quantity: number) => {
    setMenuItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(quantity, 0) } : item
      )
    );
  };

  const createOrder = async () => {
    if (!selectedItems.length) {
      setMessage("Add at least one item before sending the order.");
      return;
    }

    setSaving(true);
    const response = await fetch(`${ORDERS_API}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: selectedTable ? "dine-in" : "takeaway",
        table_number: selectedTable,
        customer_name: formData.customer_name || null,
        customer_phone: formData.customer_phone || null,
        payment_method: formData.payment_method,
        discount_amount: discount,
        notes: formData.notes || null,
        items: selectedItems.map((item) => ({
          name: item.name,
          quantity: Number(item.quantity || 0),
          price: Number(item.selling_price || 0),
        })),
      }),
    });
    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not create order.");
      return;
    }

    setMessage(`Order #${data.order_id} sent to kitchen.`);
    setShowOrderModal(false);
    await fetchData();
  };

  const closeOrder = async (order: Order) => {
    const paymentMethod = order.payment_method || "cash";
    const response = await fetch(
      `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
      { method: "PATCH" }
    );
    const data = await response.json();
    setMessage(response.ok ? `Order #${order.id} closed.` : data.detail || "Could not close order.");
    await fetchData();
  };

  const generateInvoice = async (order: Order) => {
    const params = new URLSearchParams();
    if (order.customer_name) params.set("customer_name", order.customer_name);
    const response = await fetch(`${ORDERS_API}/${order.id}/invoice?${params.toString()}`, {
      method: "POST",
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? `Invoice ${data.invoice_number} generated for order #${order.id}.`
        : data.detail || "Could not generate invoice."
    );
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex flex-wrap justify-between gap-4 items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Counter POS
          </h1>
          <p className="text-sm text-gray-500 mt-3">
            Open orders: {openOrders.length} | Closed today: Rs {Math.round(closedTotal).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchData}
            className="bg-white/5 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-white/10 transition-all"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => openOrderModal()}
            className="bg-white text-black px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-500 hover:text-white transition-all shadow-lg active:scale-95"
          >
            <Plus className="w-5 h-5" /> Takeaway
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => openOrderModal(table)}
                className={`text-left group relative p-6 rounded-xl border transition-all duration-300 ${
                  table.status === "occupied"
                    ? "bg-orange-500/10 border-orange-500/30"
                    : "bg-[#1a1a1c] border-white/5 hover:border-orange-500/30 hover:bg-[#1e1e21]"
                }`}
              >
                <div className="flex justify-between items-start mb-5">
                  <span className={`text-4xl font-black ${table.status === "occupied" ? "text-orange-500" : "text-gray-700"}`}>
                    {table.table_number}
                  </span>
                  <div className={`p-2 rounded-xl ${table.status === "occupied" ? "bg-orange-500/20" : "bg-white/5"}`}>
                    <Utensils className={`w-5 h-5 ${table.status === "occupied" ? "text-orange-500" : "text-gray-500"}`} />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 tracking-widest uppercase">
                  <Users className="w-4 h-4" /> {table.capacity} Seater
                </div>

                <div className={`mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase ${table.status === "occupied" ? "text-orange-400" : "text-green-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${table.status === "occupied" ? "bg-orange-500 animate-pulse" : "bg-green-500"}`} />
                  {table.status}
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="xl:col-span-4 bg-[#1a1a1c] border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-400" /> Today Orders
            </h2>
            <span className="text-xs text-gray-500 font-bold">{orders.length} total</span>
          </div>
          <div className="space-y-3 max-h-[650px] overflow-y-auto pr-1">
            {orders.map((order) => (
              <div key={order.id} className="bg-black/25 rounded-xl border border-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">Order #{order.id}</p>
                    <p className="text-xs text-gray-500">
                      {order.table_number ? `Table ${order.table_number}` : "Takeaway"}
                      {order.customer_name ? ` | ${order.customer_name}` : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-black uppercase ${order.status === "closed" ? "text-green-400" : "text-orange-400"}`}>
                    {order.status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-gray-400">{order.items.length} item types</span>
                  <span className="font-black">Rs {Math.round(order.total_amount || 0).toLocaleString()}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => generateInvoice(order)}
                    className="rounded-lg bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10 flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4 h-4" /> Invoice
                  </button>
                  <button
                    onClick={() => closeOrder(order)}
                    disabled={order.status === "closed"}
                    className="rounded-lg bg-green-500/15 py-2 text-xs font-bold text-green-300 hover:bg-green-500/25 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Close
                  </button>
                </div>
              </div>
            ))}
            {!orders.length && (
              <div className="text-sm text-gray-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
                No orders yet today.
              </div>
            )}
          </div>
        </aside>
      </div>

      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl h-full bg-[#1a1a1c] border-l border-white/10 p-8 flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-orange-400">
                <ShoppingBag className="w-6 h-6" />
                {selectedTable ? `Table ${selectedTable}` : "Takeaway"} Order
              </h2>
              <button onClick={() => setShowOrderModal(false)} className="p-2 hover:bg-white/5 rounded-xl">
                <X />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <input
                type="text"
                placeholder="Customer name"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
              <input
                type="tel"
                placeholder="Customer phone"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="mixed">Mixed</option>
              </select>
              <input
                type="number"
                min="0"
                placeholder="Discount"
                value={formData.discount_amount}
                onChange={(e) => setFormData({ ...formData, discount_amount: Number(e.target.value) || 0 })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {menuItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-all">
                  <div>
                    <p className="font-bold">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {item.category} | Rs {Number(item.selling_price || 0).toLocaleString()}
                    </p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={item.quantity || 0}
                    onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10) || 0)}
                    className="w-20 bg-black/40 border border-white/10 p-2 rounded-xl text-center font-bold"
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl bg-black/30 border border-white/10 p-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>Rs {Math.round(subtotal).toLocaleString()}</span></div>
              <div className="flex justify-between text-gray-400"><span>Discount</span><span>Rs {Math.round(discount).toLocaleString()}</span></div>
              <div className="flex justify-between text-gray-400"><span>GST 5%</span><span>Rs {Math.round(tax).toLocaleString()}</span></div>
              <div className="flex justify-between text-xl font-black text-white pt-2 border-t border-white/10">
                <span>Total</span><span>Rs {Math.round(total).toLocaleString()}</span>
              </div>
            </div>

            <button
              onClick={createOrder}
              disabled={saving}
              className="mt-5 w-full bg-orange-500 p-4 rounded-xl font-bold text-lg hover:bg-orange-600 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Printer className="w-5 h-5" />
              {saving ? "Sending..." : "Send to Kitchen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
