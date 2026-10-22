"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Printer,
  ReceiptText,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
  selected_options?: {
    group_name?: string;
    option_name: string;
    price_delta: number;
  }[];
};

type Order = {
  id: number;
  date?: string | null;
  order_type: string;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: OrderItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  tip_amount?: number;
  refunded_amount?: number;
  delivery_fee?: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_reference?: string | null;
  status: string;
  notes?: string | null;
  scheduled_for?: string | null;
  scheduled_label?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
};

type Invoice = {
  invoice_number: string;
};

function money(value: number) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function titleCase(value?: string | null) {
  if (!value) return "Pending";
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function optionSummary(option: NonNullable<OrderItem["selected_options"]>[number]) {
  const delta = Number(option.price_delta || 0);
  const suffix = delta > 0 ? ` +Rs ${delta}` : "";
  return `${option.group_name || "Option"}: ${option.option_name}${suffix}`;
}

export default function ReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const orderId = params.orderId;
  const customerPhone = searchParams.get("phone") || "";
  const isCustomerReceipt = Boolean(customerPhone);
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);

  const cgst = useMemo(() => Number(order?.tax_amount || 0) / 2, [order?.tax_amount]);
  const sgst = useMemo(() => Number(order?.tax_amount || 0) / 2, [order?.tax_amount]);
  const couponNote = useMemo(() => {
    const note = order?.notes || "";
    const match = note.match(/Coupon:\s*([A-Z0-9_-]+)/i);
    return match ? match[1].toUpperCase() : "";
  }, [order?.notes]);

  useEffect(() => {
    fetchOrder();
  }, [orderId, customerPhone]);

  const fetchOrder = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const receiptEndpoint = isCustomerReceipt
        ? `${ORDERS_API}/customer-receipt/${orderId}?phone=${encodeURIComponent(customerPhone)}`
        : `${ORDERS_API}/${orderId}`;
      const response = await fetch(receiptEndpoint, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not load receipt.");
      setOrder(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load receipt.");
    } finally {
      setIsLoading(false);
    }
  };

  const generateInvoice = async () => {
    if (!order) return;
    setIsGeneratingInvoice(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (order.customer_name) params.set("customer_name", order.customer_name);
      const response = await fetch(`${ORDERS_API}/${order.id}/invoice?${params.toString()}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not generate invoice.");
      setInvoice(data);
      setMessage(`Invoice ${data.invoice_number} is ready.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate invoice.");
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex gap-2">
            {isCustomerReceipt ? (
              <>
                <Link
                  href={`/track?order=${orderId}&phone=${encodeURIComponent(customerPhone)}`}
                  className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
                >
                  <ArrowLeft className="h-4 w-4" /> Track Order
                </Link>
                <Link
                  href="/order"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
                >
                  Order Food
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/operations"
                  className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
                >
                  <ArrowLeft className="h-4 w-4" /> Operations
                </Link>
                <Link
                  href="/orders"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
                >
                  POS
                </Link>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {!isCustomerReceipt && (
              <button
                data-testid="receipt-generate-invoice"
                onClick={generateInvoice}
                disabled={!order || isGeneratingInvoice}
                className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {isGeneratingInvoice ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Invoice
              </button>
            )}
            <button
              data-testid="receipt-print-command"
              onClick={() => window.print()}
              disabled={!order}
              className="flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
          </div>
        </div>

        {message && (
          <div
            role="alert"
            data-testid="receipt-message"
            className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800 print:hidden"
          >
            {message}
          </div>
        )}

        {isLoading && (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Loading receipt
          </div>
        )}

        {!isLoading && order && (
          <main
            data-testid="customer-receipt-ticket"
            className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none"
          >
            <header className="border-b border-slate-200 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-red-700">
                    Pizza Blitz
                  </p>
                  <h1 className="mt-1 text-3xl font-black">Customer Receipt</h1>
                  <p className="mt-2 text-sm text-slate-500">
                    Fresh pizza, sides, drinks, and pickup/delivery orders.
                  </p>
                </div>
                <div className="text-right">
                  <ReceiptText className="ml-auto h-8 w-8 text-red-700" />
                  <p className="mt-3 text-sm font-bold text-slate-500">Bill No.</p>
                  <p className="text-xl font-black">PB-ORDER-{order.id}</p>
                </div>
              </div>
            </header>

            <section className="grid gap-4 border-b border-slate-200 py-5 sm:grid-cols-2">
              <ReceiptInfo label="Order" value={`#${order.id}`} />
              <ReceiptInfo label="Date" value={formatDate(order.created_at) || order.date || ""} />
              <ReceiptInfo label="Fulfillment" value={titleCase(order.order_type)} />
              {order.scheduled_label ? (
                <ReceiptInfo label="Scheduled For" value={order.scheduled_label} />
              ) : null}
              <ReceiptInfo label="Table" value={order.table_number || "Counter"} />
              <ReceiptInfo label="Customer" value={order.customer_name || "Walk-in Customer"} />
              <ReceiptInfo label="Phone" value={order.customer_phone || "Not provided"} />
              <ReceiptInfo label="Order Status" value={titleCase(order.status)} />
              <ReceiptInfo label="Payment Status" value={titleCase(order.payment_status)} />
              <ReceiptInfo label="Payment Method" value={titleCase(order.payment_method)} />
              <ReceiptInfo
                label="Payment Reference"
                value={order.payment_reference || order.payment_provider || "Not recorded"}
              />
            </section>

            <section className="py-5">
              <div className="grid grid-cols-[1fr_64px_90px_90px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-widest text-slate-500">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Amount</span>
              </div>
              <div className="divide-y divide-slate-100">
                {order.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="grid grid-cols-[1fr_64px_90px_90px] gap-3 py-3 text-sm"
                  >
                    <span className="font-bold">
                      {item.name}
                      {!!item.selected_options?.length && (
                        <span className="mt-1 block text-xs font-semibold text-slate-500">
                          {item.selected_options
                            .map(optionSummary)
                            .join(" | ")}
                        </span>
                      )}
                    </span>
                    <span className="text-right">{item.quantity}</span>
                    <span className="text-right">{money(item.price)}</span>
                    <span className="text-right font-bold">
                      {money(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ml-auto w-full max-w-sm space-y-2 border-t border-slate-200 pt-5 text-sm">
              <TotalRow label="Subtotal" value={money(order.subtotal)} />
              <TotalRow label={couponNote ? `Discount (${couponNote})` : "Discount"} value={money(order.discount_amount)} />
              <TotalRow label="CGST 2.5%" value={money(cgst)} />
              <TotalRow label="SGST 2.5%" value={money(sgst)} />
              {!!order.tip_amount && (
                <TotalRow label="Tip" value={money(order.tip_amount)} />
              )}
              {!!order.refunded_amount && (
                <TotalRow label="Refunded" value={`- ${money(order.refunded_amount)}`} />
              )}
              {!!order.delivery_fee && (
                <TotalRow label="Delivery" value={money(order.delivery_fee)} />
              )}
              <div className="flex justify-between border-t border-slate-200 pt-3 text-xl font-black">
                <span>Total</span>
                <span>{money(order.total_amount)}</span>
              </div>
            </section>

            {(order.notes || invoice) && (
              <section className="mt-6 rounded-md bg-slate-50 p-4 text-sm">
                {invoice && (
                  <p className="mb-2 flex items-center gap-2 font-black text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Tax invoice: {invoice.invoice_number}
                  </p>
                )}
                {order.notes && (
                  <>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                      Notes
                    </p>
                    <p className="mt-1 font-semibold text-slate-700">{order.notes}</p>
                  </>
                )}
              </section>
            )}

            <footer className="mt-8 border-t border-slate-200 pt-5 text-center text-sm font-semibold text-slate-500">
              Thank you for choosing Pizza Blitz.
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}

function ReceiptInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 break-words font-bold text-slate-950">{value}</p>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-700">
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
