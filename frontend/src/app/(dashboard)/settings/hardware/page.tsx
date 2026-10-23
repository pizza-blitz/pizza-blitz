"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Monitor,
  Printer,
  Save,
  Wallet,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Store = { id: number; name: string; code: string; is_active: boolean };

type Hardware = {
  store_id: number;
  store_name: string;
  printer_name: string;
  paper_width_mm: number;
  auto_print: boolean;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  cash_drawer_enabled: boolean;
  drawer_pin: string;
  customer_display_url?: string | null;
  configured: boolean;
  updated_at?: string | null;
  readiness: {
    browser_printer: boolean;
    thermal_printer_configured: boolean;
    cash_drawer_configured: boolean;
    customer_display_configured: boolean;
    escpos_agent_required: boolean;
  };
};

type PrintJob = {
  job_id: string;
  printer_name: string;
  paper_width_mm: number;
  text: string;
  html: string;
};

export default function HardwarePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(1);
  const [config, setConfig] = useState<Hardware | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<PrintJob | null>(null);
  const [drawerResult, setDrawerResult] = useState<{
    esc_pos_hex: string;
    note: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async (selected: number) => {
    const [storeResponse, configResponse] = await Promise.all([
      fetch(getApiUrl("/api/v1/restaurant/stores/"), {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(getApiUrl(`/api/v1/restaurant/hardware/${selected}`), {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    const storeData = await storeResponse.json().catch(() => ({}));
    if (storeResponse.ok) {
      const rows: Store[] = storeData.stores || [];
      setStores(rows);
      if (rows.length && !rows.some((row) => row.id === selected)) {
        setStoreId(rows[0].id);
      }
    }
    const configData = await configResponse.json().catch(() => ({}));
    if (configResponse.ok) {
      setConfig(configData);
    } else {
      setMessage(configData.detail || "Hardware settings could not be loaded.");
    }
  }, []);

  useEffect(() => {
    setHydrated(true);
    void load(storeId);
  }, [load, storeId]);

  const save = async () => {
    if (!config) return;
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hardware/${storeId}`),
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            printer_name: config.printer_name,
            paper_width_mm: Number(config.paper_width_mm),
            auto_print: config.auto_print,
            receipt_header: config.receipt_header,
            receipt_footer: config.receipt_footer,
            cash_drawer_enabled: config.cash_drawer_enabled,
            drawer_pin: config.drawer_pin,
            customer_display_url: config.customer_display_url || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Hardware settings could not be saved.");
      setConfig(data);
      setMessage("Hardware settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hardware settings could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const testPrint = async () => {
    setBusy("print");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hardware/${storeId}/test-print`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Test print failed.");
      setPreview(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test print failed.");
    } finally {
      setBusy("");
    }
  };

  const openDrawer = async () => {
    setBusy("drawer");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hardware/${storeId}/drawer-pulse`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Drawer pulse failed.");
      setDrawerResult(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Drawer pulse failed.");
    } finally {
      setBusy("");
    }
  };

  const copyCommand = async () => {
    if (!drawerResult) return;
    await navigator.clipboard.writeText(drawerResult.esc_pos_hex);
    setMessage("ESC/POS command copied.");
  };

  return (
    <div
      data-testid="hardware-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-gray-950">
            <Printer className="h-7 w-7 text-orange-600" /> POS hardware
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Browser printing, ESC/POS drawer pulse and a customer-display screen.
          </p>
        </div>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Store
          <select
            data-testid="hardware-store"
            value={storeId}
            onChange={(event) => setStoreId(Number(event.target.value))}
            className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      {config && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Browser printer",
                ready: config.readiness.browser_printer,
                detail: "Print dialog on the POS",
              },
              {
                label: "Thermal printer",
                ready: config.readiness.thermal_printer_configured,
                detail: config.printer_name,
              },
              {
                label: "Cash drawer",
                ready: config.readiness.cash_drawer_configured,
                detail: config.cash_drawer_enabled
                  ? `Pin ${config.drawer_pin}`
                  : "Not enabled",
              },
              {
                label: "Customer display",
                ready: config.readiness.customer_display_configured,
                detail: config.customer_display_url || "Not configured",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-100 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {item.label}
                </p>
                <p
                  className={`mt-1 flex items-center gap-1.5 text-sm font-black ${
                    item.ready ? "text-emerald-700" : "text-gray-500"
                  }`}
                >
                  <CheckCircle2 className={`h-4 w-4 ${item.ready ? "" : "opacity-30"}`} />
                  {item.ready ? "Ready" : "Setup"}
                </p>
                <p className="mt-1 truncate text-[11px] font-semibold text-gray-500">
                  {item.detail}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
              Printer & drawer settings
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Printer name
                <input
                  data-testid="hardware-printer-name"
                  value={config.printer_name}
                  onChange={(event) =>
                    setConfig({ ...config, printer_name: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Paper width
                <select
                  data-testid="hardware-paper-width"
                  value={config.paper_width_mm}
                  onChange={(event) =>
                    setConfig({ ...config, paper_width_mm: Number(event.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value={58}>58 mm</option>
                  <option value={80}>80 mm</option>
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Drawer pin
                <select
                  data-testid="hardware-drawer-pin"
                  value={config.drawer_pin}
                  onChange={(event) =>
                    setConfig({ ...config, drawer_pin: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900"
                >
                  {["0", "1", "2", "3", "4", "5", "6", "7"].map((pin) => (
                    <option key={pin} value={pin}>
                      Pin {pin}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Receipt header
                <input
                  value={config.receipt_header || ""}
                  onChange={(event) =>
                    setConfig({ ...config, receipt_header: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Receipt footer
                <input
                  value={config.receipt_footer || ""}
                  onChange={(event) =>
                    setConfig({ ...config, receipt_footer: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Customer display URL
                <input
                  data-testid="hardware-display-url"
                  value={config.customer_display_url || ""}
                  onChange={(event) =>
                    setConfig({ ...config, customer_display_url: event.target.value })
                  }
                  placeholder="http://127.0.0.1:3011/..."
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={config.auto_print}
                  onChange={(event) =>
                    setConfig({ ...config, auto_print: event.target.checked })
                  }
                />
                Auto-print after payment
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <input
                  data-testid="hardware-drawer-enabled"
                  type="checkbox"
                  checked={config.cash_drawer_enabled}
                  onChange={(event) =>
                    setConfig({ ...config, cash_drawer_enabled: event.target.checked })
                  }
                />
                Cash drawer connected
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="hardware-save"
                onClick={save}
                disabled={busy === "save"}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {busy === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save hardware
              </button>
              <button
                type="button"
                data-testid="hardware-test-print"
                onClick={testPrint}
                disabled={busy === "print"}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" /> Test print
              </button>
              <button
                type="button"
                data-testid="hardware-drawer-open"
                onClick={openDrawer}
                disabled={busy === "drawer"}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300 disabled:opacity-50"
              >
                <Wallet className="h-4 w-4" /> Open drawer
              </button>
              {config.customer_display_url && (
                <a
                  href={config.customer_display_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300"
                >
                  <Monitor className="h-4 w-4" /> Open customer display
                </a>
              )}
            </div>
            <p className="mt-3 text-[11px] font-semibold text-gray-400">
              Browser print works immediately. Thermal printers and cash drawers need a
              local ESC/POS bridge; the drawer command below is the exact byte sequence
              to send.
            </p>
          </section>

          {drawerResult && (
            <section
              data-testid="hardware-drawer-result"
              className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"
            >
              <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
                Drawer pulse ready
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-white px-3 py-2 font-mono text-sm font-bold text-gray-900">
                  {drawerResult.esc_pos_hex}
                </code>
                <button
                  type="button"
                  onClick={copyCommand}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-800"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-emerald-800">
                {drawerResult.note}
              </p>
            </section>
          )}
        </>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            data-testid="hardware-print-preview"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-gray-900 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-black">Test print preview</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-xs font-black uppercase tracking-widest text-gray-400"
              >
                Close
              </button>
            </div>
            <div
              className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"
              style={{ maxWidth: `${preview.paper_width_mm}mm` }}
            >
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5">
                {preview.text}
              </pre>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="mt-3 w-full rounded-lg bg-gray-950 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
            >
              Open browser print
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
