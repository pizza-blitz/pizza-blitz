"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, AlertTriangle, RefreshCw, Upload, Save, CheckCircle2, History, TrendingUp, Camera, Sparkles, ShoppingCart } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

type InventoryItemRow = {
  id: number;
  name: string;
  category?: string;
  unit?: string;
  supplier_name?: string | null;
  current_stock: number;
  minimum_stock: number;
  cost_per_unit: number;
};

type LowStockItem = {
  id: number;
  name: string;
  unit?: string;
  supplier_name?: string | null;
  reorder_quantity?: number;
  estimated_cost?: number;
};

type LowStockSummary = {
  count: number;
  items: LowStockItem[];
  groups?: unknown[];
  total_estimated_cost: number;
};

type InventoryTransactionRow = {
  id: number;
  item_id: number;
  item_name?: string;
  item_unit?: string;
  transaction_type: string;
  notes?: string | null;
  created_at?: string;
  signed_quantity: number;
  total_cost?: number;
};

export default function Inventory() {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockSummary>({ count: 0, items: [], groups: [], total_estimated_cost: 0 });
  const [, setIsLoading] = useState(true);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isCreatingPO, setIsCreatingPO] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItemRow | null>(null);
  const [transactions, setTransactions] = useState<InventoryTransactionRow[]>([]);
  const [adjustmentType, setAdjustmentType] = useState<'purchase' | 'usage' | 'wastage'>('purchase');
  const [adjustmentQty, setAdjustmentQty] = useState("1");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "",
    unit: "kg",
    current_stock: "0",
    minimum_stock: "0",
    cost_per_unit: "0",
    supplier_name: "",
    supplier_whatsapp: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchItems(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchItems = async (signal?: AbortSignal) => {
    try {
      const [res, lowStockRes, transactionsRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/restaurant/inventory/items'), { signal, credentials: "include", cache: "no-store" }),
        fetch(getApiUrl('/api/v1/restaurant/inventory/low-stock'), { signal, credentials: "include", cache: "no-store" }),
        fetch(getApiUrl('/api/v1/restaurant/inventory/transactions?limit=12'), { signal, credentials: "include", cache: "no-store" }),
      ]);
      if (!res.ok || !lowStockRes.ok || !transactionsRes.ok) {
        throw new Error("Could not load inventory data.");
      }
      const [data, lowStockData, transactionData] = await Promise.all([
        res.json(),
        lowStockRes.json(),
        transactionsRes.json(),
      ]);
      setItems(Array.isArray(data) ? data : []);
      setLowStock(lowStockData && typeof lowStockData === "object" ? lowStockData : { count: 0, items: [], groups: [], total_estimated_cost: 0 });
      setTransactions(Array.isArray(transactionData) ? transactionData : []);
    } catch (err) {
      if (signal?.aborted) return;
      console.warn("Inventory data is temporarily unavailable", err);
      setItems([]);
      setLowStock({ count: 0, items: [], groups: [], total_estimated_cost: 0 });
      setTransactions([]);
      setMessage("Could not load inventory data.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  };

  const createPurchaseDrafts = async () => {
    setIsCreatingPO(true);
    setMessage("");
    try {
      const response = await fetch(getApiUrl('/api/v1/restaurant/purchase-orders/from-low-stock'), {
        method: 'POST',
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not create purchase order drafts.");
      setMessage(
        data.created
          ? `Created ${data.created} purchase order draft${data.created === 1 ? "" : "s"}.`
          : "No low-stock items need reorder drafts."
      );
      await fetchItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create purchase order drafts.");
    } finally {
      setIsCreatingPO(false);
    }
  };

  const handleAdjust = async () => {
    if (!selectedItem) return;
    const quantity = Number(adjustmentQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Enter a quantity greater than zero.");
      return;
    }

    setIsAdjusting(true);
    setMessage("");
    try {
      const response = await fetch(getApiUrl('/api/v1/restaurant/inventory/transaction'), {
        method: 'POST',
        credentials: "include",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: selectedItem.id,
          transaction_type: adjustmentType,
          quantity,
          unit_cost: adjustmentType === 'purchase' ? selectedItem.cost_per_unit : undefined,
          notes: adjustmentNotes || `Manual ${adjustmentType} adjustment`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not update stock.");
      setMessage(`${selectedItem.name} stock updated to ${data.new_stock} ${selectedItem.unit}.`);
      setAdjustmentQty("1");
      setAdjustmentNotes("");
      setSelectedItem(null);
      await fetchItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update stock.");
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleAddItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentStock = Number(newItem.current_stock);
    const minimumStock = Number(newItem.minimum_stock);
    const costPerUnit = Number(newItem.cost_per_unit);
    if (
      !newItem.name.trim() ||
      !Number.isFinite(currentStock) ||
      !Number.isFinite(minimumStock) ||
      !Number.isFinite(costPerUnit) ||
      currentStock < 0 ||
      minimumStock < 0 ||
      costPerUnit < 0
    ) {
      setMessage("Enter an item name and valid non-negative stock values.");
      return;
    }

    setIsAddingItem(true);
    setMessage("");
    try {
      const response = await fetch(getApiUrl('/api/v1/restaurant/inventory/items'), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newItem,
          name: newItem.name.trim(),
          category: newItem.category.trim() || "General",
          unit: newItem.unit.trim() || "unit",
          current_stock: currentStock,
          minimum_stock: minimumStock,
          cost_per_unit: costPerUnit,
          supplier_name: newItem.supplier_name.trim() || null,
          supplier_whatsapp: newItem.supplier_whatsapp.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not add inventory item.");
      setMessage(`${data.name} added to inventory.`);
      setNewItem({
        name: "",
        category: "",
        unit: "kg",
        current_stock: "0",
        minimum_stock: "0",
        cost_per_unit: "0",
        supplier_name: "",
        supplier_whatsapp: "",
      });
      setShowAddItem(false);
      await fetchItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add inventory item.");
    } finally {
      setIsAddingItem(false);
    }
  };

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredItems = normalizedSearchTerm
    ? items.filter((item) =>
        [item.name, item.category, item.supplier_name]
          .some((value) => String(value || "").toLowerCase().includes(normalizedSearchTerm))
      )
    : items;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-500 mt-1">Track stock levels, record purchases, and process invoices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory/scan"
            className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold inline-flex items-center gap-2"
          >
            <Camera className="h-4 w-4" />
            Scan Bill
          </Link>
           <button
             type="button"
             onClick={() => setShowAddItem((current) => !current)}
             className="bg-orange-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-orange-100 flex items-center hover:bg-orange-700 transition-all"
           >
             <Plus className="w-5 h-5 mr-2" /> Add Item
           </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
          {message}
        </div>
      )}

      {showAddItem && (
        <form onSubmit={handleAddItem} className="rounded-xl border border-orange-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-gray-900">Add Inventory Item</h2>
              <p className="mt-1 text-xs font-semibold text-gray-500">Create the stock record used by purchase orders and adjustments.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddItem(false)}
              className="text-xs font-black text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input required aria-label="Item name" value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="Item name" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Category" value={newItem.category} onChange={(event) => setNewItem({ ...newItem, category: event.target.value })} placeholder="Category" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input required aria-label="Unit" value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })} placeholder="Unit" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Supplier" value={newItem.supplier_name} onChange={(event) => setNewItem({ ...newItem, supplier_name: event.target.value })} placeholder="Supplier" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Current stock" type="number" min="0" step="0.01" value={newItem.current_stock} onChange={(event) => setNewItem({ ...newItem, current_stock: event.target.value })} placeholder="Current stock" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Minimum stock" type="number" min="0" step="0.01" value={newItem.minimum_stock} onChange={(event) => setNewItem({ ...newItem, minimum_stock: event.target.value })} placeholder="Minimum stock" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Cost per unit" type="number" min="0" step="0.01" value={newItem.cost_per_unit} onChange={(event) => setNewItem({ ...newItem, cost_per_unit: event.target.value })} placeholder="Cost per unit" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input aria-label="Supplier WhatsApp" value={newItem.supplier_whatsapp} onChange={(event) => setNewItem({ ...newItem, supplier_whatsapp: event.target.value })} placeholder="Supplier WhatsApp" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={isAddingItem} className="mt-4 inline-flex items-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-700 disabled:bg-gray-300">
            <Save className="mr-2 h-4 w-4" />
            {isAddingItem ? "Saving..." : "Save Item"}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Total Items</p>
          <p className="mt-2 text-2xl font-black text-gray-900">{items.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-red-500">Low Stock</p>
          <p className="mt-2 text-2xl font-black text-red-600">{lowStock.count || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Reorder Estimate</p>
          <p className="mt-2 text-2xl font-black text-gray-900">Rs {Math.round(lowStock.total_estimated_cost || 0).toLocaleString()}</p>
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
              aria-label="Search stock items"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-orange-500 outline-none transition-all"
            />
          </div>

          <div className="hidden bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden md:block">
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
                {filteredItems.map((item) => {
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
                          type="button"
                          aria-label={`Adjust stock for ${item.name}`}
                          title={`Adjust stock for ${item.name}`}
                          onClick={() => {
                            setSelectedItem(item);
                            setAdjustmentType('purchase');
                            setAdjustmentQty("1");
                            setAdjustmentNotes("");
                          }}
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

          <div data-testid="mobile-stock-list" className="space-y-3 md:hidden">
            {filteredItems.map((item) => {
              const isLow = item.current_stock < item.minimum_stock;
              return (
                <article
                  key={`mobile-${item.id}`}
                  className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.category}</p>
                    </div>
                    {isLow ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black text-red-600">
                        <AlertTriangle className="h-3 w-3" /> Low
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-black text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Healthy
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Current stock
                      </p>
                      <p className={`text-xl font-black ${isLow ? "text-red-600" : "text-gray-900"}`}>
                        {item.current_stock}
                        <span className="ml-1 text-xs font-bold text-gray-400">{item.unit}</span>
                      </p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        Minimum {item.minimum_stock} {item.unit}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Adjust stock for ${item.name}`}
                      onClick={() => {
                        setSelectedItem(item);
                        setAdjustmentType("purchase");
                        setAdjustmentQty("1");
                        setAdjustmentNotes("");
                      }}
                      className="inline-flex h-11 items-center gap-2 rounded-lg bg-orange-50 px-4 text-xs font-black text-orange-700 hover:bg-orange-100"
                    >
                      <RefreshCw className="h-4 w-4" /> Adjust
                    </button>
                  </div>
                </article>
              );
            })}
            {!filteredItems.length && (
              <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-400">
                No stock items match this search.
              </p>
            )}
          </div>
        </div>

        {/* Sidebar Tools */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center">
                  <AlertTriangle className="w-5 h-5 mr-2 text-red-600" />
                  Reorder Queue
                </h3>
                <p className="text-xs text-gray-500 mt-1">Generated from stock below minimum level.</p>
              </div>
              <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-black text-red-600">
                {lowStock.count || 0}
              </span>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {(lowStock.items || []).map((item) => (
                <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-bold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.supplier_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-red-600">
                        {item.reorder_quantity} {item.unit}
                      </p>
                      <p className="text-xs text-gray-500">Rs {Math.round(item.estimated_cost || 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!lowStock.count && (
                <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center text-sm font-semibold text-gray-500">
                  All items are above minimum stock.
                </div>
              )}
            </div>

            <button
              onClick={createPurchaseDrafts}
              disabled={isCreatingPO || !lowStock.count}
              className="mt-4 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-gray-300 flex items-center justify-center gap-2"
            >
              {isCreatingPO ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Create PO Drafts
            </button>
            <Link
              href="/purchase-orders"
              className="mt-3 block text-center text-xs font-black text-orange-700 hover:text-orange-900"
            >
              Open purchase orders
            </Link>
          </div>

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
                  {['purchase', 'usage', 'wastage'].map(type => (
                    <button 
                      key={type}
                      onClick={() => setAdjustmentType(type as 'purchase' | 'usage' | 'wastage')}
                      className={`py-2 text-xs font-bold rounded-lg border transition-all capitalize ${
                        adjustmentType === type
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-gray-200 hover:border-orange-500 hover:bg-orange-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase text-gray-400">Quantity</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={adjustmentQty}
                      onChange={(event) => setAdjustmentQty(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase text-gray-400">Unit</span>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-600">
                      {selectedItem.unit}
                    </div>
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-400">Notes</span>
                  <input
                    type="text"
                    value={adjustmentNotes}
                    onChange={(event) => setAdjustmentNotes(event.target.value)}
                    placeholder="Reason for adjustment"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-500"
                  />
                </label>
                <button
                  onClick={handleAdjust}
                  disabled={isAdjusting}
                  className="w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-black text-white hover:bg-orange-700 disabled:bg-gray-300 flex items-center justify-center gap-2"
                >
                  {isAdjusting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Adjustment
                </button>
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

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center">
              <History className="w-5 h-5 mr-2 text-gray-600" />
              Recent Stock Movements
            </h3>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-900">{transaction.item_name || `Item #${transaction.item_id}`}</p>
                      <p className="text-xs text-gray-500 capitalize">
                        {transaction.transaction_type} {transaction.notes ? `- ${transaction.notes}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-gray-400">
                        {transaction.created_at ? new Date(transaction.created_at).toLocaleString() : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-black ${transaction.signed_quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {transaction.signed_quantity >= 0 ? '+' : ''}{transaction.signed_quantity} {transaction.item_unit || ""}
                      </p>
                      <p className="text-xs text-gray-500">Rs {Math.round(transaction.total_cost || 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center text-sm font-semibold text-gray-500">
                  No stock movements recorded yet.
                </div>
              )}
            </div>
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
