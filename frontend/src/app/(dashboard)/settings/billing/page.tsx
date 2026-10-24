"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Receipt, Save } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type BillingSettings = {
  tax_rate: number;
  tax_label: string;
  invoice_footer: string | null;
  tip_presets: number[];
  updated_at?: string | null;
};

const API = getApiUrl("/api/v1/restaurant/billing-settings/");
const money = (value: number) =>
  `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function BillingSettingsPage() {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [tipPresets, setTipPresets] = useState("0, 5, 10, 15");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void (async () => {
      try {
        const response = await fetch(API, { credentials: "include", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Billing settings failed to load.");
        setSettings(data.settings);
        setTipPresets((data.settings.tip_presets || []).join(", "));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Billing settings failed to load.");
      }
    })();
  }, []);

  const preview = useMemo(() => {
    const subtotal = 500;
    const tax = Math.round(subtotal * ((settings?.tax_rate || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [settings?.tax_rate]);

  const save = async () => {
    if (!settings) return;
    const presets = tipPresets
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(API, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tax_rate: Number(settings.tax_rate),
          tax_label: settings.tax_label,
          invoice_footer: settings.invoice_footer || null,
          tip_presets: presets,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Billing settings could not be saved.");
      setSettings(data.settings);
      setTipPresets((data.settings.tip_presets || []).join(", "));
      setMessage("Billing settings saved. New orders use the updated tax rate.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Billing settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
        {message ? message : <><Loader2 className="h-5 w-5 animate-spin" /> Loading billing settings...</>}
      </div>
    );
  }

  return (
    <div
      data-testid="billing-settings-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Settings · money
          </p>
          <h1 className="text-3xl font-black text-gray-950">Tax &amp; billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Change the tax rate, invoice footer and customer tip presets without a code deploy.
            Existing orders keep the tax that was charged when they were created.
          </p>
        </div>
        <button
          type="button"
          data-testid="billing-save"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save billing settings
        </button>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Receipt className="h-4 w-4 text-orange-600" /> Tax
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Tax rate (%)
              <input
                data-testid="billing-tax-rate"
                type="number"
                min={0}
                max={28}
                step="0.01"
                value={settings.tax_rate}
                onChange={(event) =>
                  setSettings({ ...settings, tax_rate: Number(event.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-orange-400"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Tax label
              <input
                data-testid="billing-tax-label"
                value={settings.tax_label}
                onChange={(event) => setSettings({ ...settings, tax_label: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
              />
            </label>
          </div>
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] font-semibold leading-5 text-gray-500">
            Invoices split the collected tax evenly into CGST and SGST. A 5% rate becomes
            2.5% + 2.5%; a 12% rate becomes 6% + 6%. The public checkout, POS counter and
            order desk all read this setting.
          </p>

          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
            Invoice footer
            <input
              data-testid="billing-invoice-footer"
              value={settings.invoice_footer || ""}
              onChange={(event) =>
                setSettings({ ...settings, invoice_footer: event.target.value })
              }
              placeholder="e.g. Thank you for ordering from Pizza Blitz."
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
            />
          </label>

          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
            Tip presets (%)
            <input
              data-testid="billing-tip-presets"
              value={tipPresets}
              onChange={(event) => setTipPresets(event.target.value)}
              placeholder="0, 5, 10, 15"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
            />
          </label>
          <p className="text-[10px] font-semibold text-gray-400">
            Comma-separated percentages. The customer checkout shows these buttons; it
            still allows a custom amount.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Example order
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span className="font-bold text-gray-900">{money(preview.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>
                  {settings.tax_label || "Tax"} {settings.tax_rate}%
                </span>
                <span className="font-bold text-gray-900">{money(preview.tax)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2 text-base">
                <span className="font-black text-gray-900">Total</span>
                <span className="font-black text-orange-700">{money(preview.total)}</span>
              </div>
            </div>
            <p className="mt-4 text-[10px] font-semibold text-gray-400">
              Estimate only. Delivery fees, discounts and tips are applied at checkout.
            </p>
          </section>

          <section className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
              Compliance note
            </p>
            <p className="mt-1 text-xs font-semibold leading-5 text-amber-900">
              Confirm the rate and invoice footer with your accountant. Historic invoices
              are not rewritten; a rate change only affects new orders.
            </p>
          </section>

          <p className="text-[10px] font-semibold text-gray-400">
            {settings.updated_at
              ? `Last saved ${new Date(settings.updated_at).toLocaleString("en-IN")}`
              : "Using the default 5% GST configuration."}
          </p>
        </aside>
      </div>
    </div>
  );
}
