"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Save,
  Send,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type PurchaseOrderLine = {
  inventory_item_id?: number;
  item_id?: number;
  name: string;
  unit?: string;
  quantity?: number;
  needed?: number;
  received_quantity?: number;
  unit_cost?: number;
  estimated_cost?: number;
  current_stock?: number;
  minimum_stock?: number;
};

type PurchaseOrder = {
  id: number;
  supplier_name: string;
  supplier_whatsapp?: string;
  items: PurchaseOrderLine[];
  total_amount: number;
  status: string;
  whatsapp_sent_at?: string;
  created_at: string;
};

function statusClass(status: string) {
  if (status === "received") return "bg-green-100 text-green-700";
  if (status === "sent") return "bg-blue-100 text-blue-700";
  return "bg-orange-100 text-orange-700";
}

function numericValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLine(line: PurchaseOrderLine): PurchaseOrderLine {
  const quantity = numericValue(line.quantity ?? line.needed);
  const receivedQuantity = numericValue(line.received_quantity, quantity);
  const unitCost = numericValue(line.unit_cost);
  return {
    ...line,
    quantity,
    needed: quantity,
    received_quantity: receivedQuantity,
    unit_cost: unitCost,
    estimated_cost: Number((receivedQuantity * unitCost).toFixed(2)),
  };
}

export default function PurchaseOrderDetail() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  const totalAmount = useMemo(
    () => lines.reduce((sum, line) => sum + numericValue(line.estimated_cost), 0),
    [lines]
  );

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/purchase-orders/${orderId}`));
      if (!response.ok) throw new Error("Purchase order not found.");
      const data = await response.json();
      setOrder(data);
      setLines((data.items || []).map(normalizeLine));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load purchase order.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateLine = (index: number, field: keyof PurchaseOrderLine, value: string) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = {
        ...line,
        [field]: field === "name" || field === "unit" ? value : numericValue(value),
      };
      return normalizeLine(next);
    }));
  };

  const saveReconciliation = async () => {
    setSaving("items");
    setMessage("");
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/purchase-orders/${orderId}/items`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines.map(normalizeLine) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save reconciliation.");
      setOrder(data.purchase_order);
      setLines((data.items || []).map(normalizeLine));
      setMessage(`Saved supplier bill reconciliation. New PO total is Rs. ${Number(data.total_amount || 0).toLocaleString()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save reconciliation.");
    } finally {
      setSaving("");
    }
  };

  const updateStatus = async (action: "sent" | "receive") => {
    setSaving(action);
    setMessage("");
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/purchase-orders/${orderId}/${action}`), {
        method: "PATCH",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not update purchase order.");
      setOrder(data.purchase_order);
      setLines((data.purchase_order.items || []).map(normalizeLine));
      const updatedCount = data.inventory_updates?.length || 0;
      const expenseAmount = Number(data.expense?.amount || 0);
      const vendorPriceCount = data.vendor_prices?.length || 0;
      setMessage(
        action === "receive"
          ? `Received PO-${orderId}; inventory updated for ${updatedCount} item${updatedCount === 1 ? "" : "s"}, expense posted for Rs. ${expenseAmount.toLocaleString()}, and ${vendorPriceCount} supplier price${vendorPriceCount === 1 ? "" : "s"} logged.`
          : `Marked PO-${orderId} as sent.`
      );
      if (action === "receive") router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update purchase order.");
    } finally {
      setSaving("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <Link href="/purchase-orders" className="inline-flex items-center text-sm font-bold text-orange-700">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to purchase orders
        </Link>
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 font-semibold text-red-700">
          {message || "Purchase order not found."}
        </div>
      </div>
    );
  }

  const canEdit = order.status !== "received";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/purchase-orders" className="inline-flex items-center text-sm font-bold text-orange-700 hover:text-orange-900">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to purchase orders
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">PO-{order.id}</h1>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(order.status)}`}>
              {order.status}
            </span>
          </div>
          <p className="mt-1 text-gray-500">
            {order.supplier_name} {order.supplier_whatsapp ? `+${order.supplier_whatsapp}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {canEdit && (
            <button
              type="button"
              onClick={saveReconciliation}
              disabled={saving !== ""}
              className="inline-flex items-center rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-60"
            >
              {saving === "items" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Bill
            </button>
          )}
          {order.status === "draft" && (
            <button
              type="button"
              onClick={() => updateStatus("sent")}
              disabled={saving !== ""}
              className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {saving === "sent" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Mark Sent
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => updateStatus("receive")}
              disabled={saving !== ""}
              className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-4 py-2 font-bold text-green-700 hover:bg-green-100 disabled:opacity-60"
            >
              {saving === "receive" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Receive Stock
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Supplier</p>
          <p className="mt-2 font-bold text-gray-900">{order.supplier_name}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Current Total</p>
          <p className="mt-2 text-2xl font-black text-gray-900">Rs. {totalAmount.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Created</p>
          <p className="mt-2 font-bold text-gray-900">{new Date(order.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-3">
          <h2 className="font-bold text-gray-900">Supplier Bill Reconciliation</h2>
          <p className="text-sm text-gray-500">Adjust received quantity and actual unit cost before receiving stock.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-white text-left text-xs font-bold uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Ordered</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Unit Cost</th>
                <th className="px-4 py-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, index) => (
                <tr key={`${line.name}-${index}`}>
                  <td className="px-4 py-3">
                    <div className="font-bold text-gray-900">{line.name}</div>
                    <div className="text-xs text-gray-400">{line.unit || "unit"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.quantity ?? 0}
                      onChange={(event) => updateLine(index, "quantity", event.target.value)}
                      disabled={!canEdit}
                      className="w-28 rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.received_quantity ?? line.quantity ?? 0}
                      onChange={(event) => updateLine(index, "received_quantity", event.target.value)}
                      disabled={!canEdit}
                      className="w-28 rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_cost ?? 0}
                      onChange={(event) => updateLine(index, "unit_cost", event.target.value)}
                      disabled={!canEdit}
                      className="w-28 rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-black text-gray-900">
                    Rs. {numericValue(line.estimated_cost).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
