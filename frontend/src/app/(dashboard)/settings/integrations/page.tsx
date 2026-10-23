"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Loader2,
  Plug,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Platform = { key: string; label: string };

type Integration = {
  id: number;
  platform: string;
  platform_label: string;
  store_id: number;
  store_name?: string | null;
  display_name: string;
  is_active: boolean;
  auto_accept: boolean;
  webhook_url: string;
  webhook_token: string;
  outbound_url?: string | null;
  outbound_secret?: string | null;
  outbound_enabled?: boolean;
  menu_sync_url?: string | null;
  menu_sync_enabled?: boolean;
  orders_count: number;
  last_order_at?: string | null;
};

type Store = { id: number; name: string; code: string; is_active: boolean };

export default function IntegrationsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [platform, setPlatform] = useState("swiggy");
  const [storeId, setStoreId] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [outboundDrafts, setOutboundDrafts] = useState<
    Record<number, { url: string; enabled: boolean }>
  >({});
  const [menuDrafts, setMenuDrafts] = useState<
    Record<number, { url: string; enabled: boolean }>
  >({});

  const load = useCallback(async () => {
    const [integrationResponse, storeResponse] = await Promise.all([
      fetch(getApiUrl("/api/v1/restaurant/integrations/aggregators/"), {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(getApiUrl("/api/v1/restaurant/stores/"), {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    const integrationData = await integrationResponse.json().catch(() => ({}));
    const storeData = await storeResponse.json().catch(() => ({}));
    if (integrationResponse.ok) {
      setPlatforms(integrationData.platforms || []);
      const rows: Integration[] = integrationData.integrations || [];
      setIntegrations(rows);
      setOutboundDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            { url: row.outbound_url || "", enabled: Boolean(row.outbound_enabled) },
          ])
        )
      );
      setMenuDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            { url: row.menu_sync_url || "", enabled: Boolean(row.menu_sync_enabled) },
          ])
        )
      );
    } else {
      setMessage(integrationData.detail || "Integrations could not be loaded.");
    }
    if (storeResponse.ok) {
      const activeStores = (storeData.stores || []).filter(
        (store: Store) => store.is_active
      );
      setStores(activeStores);
      if (activeStores.length && !activeStores.some((store: Store) => store.id === storeId)) {
        setStoreId(activeStores[0].id);
      }
    }
  }, [storeId]);

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy("connect");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/integrations/aggregators/"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, store_id: storeId }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Integration could not be created.");
      setMessage(`${data.platform_label} connected for ${data.store_name}.`);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Integration could not be created."
      );
    } finally {
      setBusy("");
    }
  };

  const update = async (integration: Integration, changes: Record<string, unknown>) => {
    setBusy(`integration-${integration.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/integrations/aggregators/${integration.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Integration could not be updated.");
      setMessage(`${data.platform_label} is now ${data.is_active ? "active" : "paused"}.`);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Integration could not be updated."
      );
    } finally {
      setBusy("");
    }
  };

  const rotate = async (integration: Integration) => {
    setBusy(`integration-${integration.id}`);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/integrations/aggregators/${integration.id}/rotate-token`
        ),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Token could not be rotated.");
      setMessage(`New webhook token generated for ${data.platform_label}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token could not be rotated.");
    } finally {
      setBusy("");
    }
  };

  const saveMenuSync = async (integration: Integration) => {
    const draft = menuDrafts[integration.id] || {
      url: integration.menu_sync_url || "",
      enabled: Boolean(integration.menu_sync_enabled),
    };
    setBusy(`menu-${integration.id}`);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/integrations/aggregators/${integration.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menu_sync_url: draft.url.trim() || null,
            menu_sync_enabled: draft.enabled,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Menu sync could not be saved.");
      setMessage(
        data.menu_sync_enabled
          ? `Menu sync enabled for ${data.platform_label}.`
          : `Menu sync disabled for ${data.platform_label}.`
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Menu sync could not be saved."
      );
    } finally {
      setBusy("");
    }
  };

  const pushMenu = async (integration: Integration) => {
    setBusy(`menu-${integration.id}`);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/integrations/aggregators/${integration.id}/menu-sync`
        ),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Menu push failed.");
      setMessage(
        data.status === "sent"
          ? `Menu sent to ${integration.platform_label} (${data.item_count} items).`
          : `Menu push failed: ${data.error || "partner rejected the payload"}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Menu push failed.");
    } finally {
      setBusy("");
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setMessage("Clipboard is not available in this browser.");
    }
  };

  const saveOutbound = async (integration: Integration) => {
    const draft = outboundDrafts[integration.id] || {
      url: integration.outbound_url || "",
      enabled: Boolean(integration.outbound_enabled),
    };
    setBusy(`outbound-${integration.id}`);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/integrations/aggregators/${integration.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outbound_url: draft.url.trim() || null,
            outbound_enabled: draft.enabled,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Status sync could not be saved.");
      setMessage(
        data.outbound_enabled
          ? `Status sync enabled for ${data.platform_label}.`
          : `Status sync disabled for ${data.platform_label}.`
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Status sync could not be saved."
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div
      data-testid="integrations-page"
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
            <Plug className="h-7 w-7 text-orange-600" /> Aggregator integrations
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Receive Swiggy, Zomato, Uber Eats and DoorDash orders through a token-scoped webhook.
          </p>
        </div>
        <button
          type="button"
          data-testid="integrations-refresh"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-600">
          <Link2 className="h-4 w-4" /> Connect a platform
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Platform
            <select
              data-testid="aggregator-platform"
              aria-label="Aggregator platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
            >
              {platforms.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Store
            <select
              data-testid="aggregator-store"
              aria-label="Aggregator store"
              value={storeId}
              onChange={(event) => setStoreId(Number(event.target.value))}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="connect-aggregator"
            onClick={connect}
            disabled={busy === "connect"}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-orange-600 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {busy === "connect" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            Connect
          </button>
        </div>
        <p className="mt-2 text-[11px] font-semibold text-gray-500">
          Connect is idempotent per platform/store. The webhook token can be rotated at any time.
        </p>
      </section>

      <section className="space-y-3">
        {integrations.length ? (
          integrations.map((integration) => (
            <div
              key={integration.id}
              data-testid={`integration-card-${integration.id}`}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-black text-gray-950">
                    {integration.platform_label}
                    <span
                      className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                        integration.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {integration.is_active ? "Active" : "Paused"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs font-semibold text-gray-500">
                    {integration.display_name}
                    {integration.store_name ? ` · ${integration.store_name}` : ""} ·{" "}
                    {integration.orders_count} order
                    {integration.orders_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    data-testid={`integration-toggle-${integration.id}`}
                    onClick={() =>
                      void update(integration, { is_active: !integration.is_active })
                    }
                    disabled={busy === `integration-${integration.id}`}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-50"
                  >
                    {integration.is_active ? "Pause" : "Activate"}
                  </button>
                  <button
                    type="button"
                    data-testid={`integration-rotate-${integration.id}`}
                    onClick={() => void rotate(integration)}
                    disabled={busy === `integration-${integration.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Token
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Webhook URL
                  <div className="mt-1 flex gap-1">
                    <input
                      data-testid={`integration-url-${integration.id}`}
                      readOnly
                      value={integration.webhook_url}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[11px] font-bold text-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() => void copy(`url-${integration.id}`, integration.webhook_url)}
                      aria-label="Copy webhook URL"
                      className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200 text-gray-600"
                    >
                      {copied === `url-${integration.id}` ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </label>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Webhook token
                  <div className="mt-1 flex gap-1">
                    <input
                      data-testid={`integration-token-${integration.id}`}
                      readOnly
                      type={revealed.includes(integration.id) ? "text" : "password"}
                      value={integration.webhook_token}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[11px] font-bold text-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRevealed((current) =>
                          current.includes(integration.id)
                            ? current.filter((id) => id !== integration.id)
                            : [...current, integration.id]
                        )
                      }
                      className="rounded-lg border border-gray-200 px-2 text-[9px] font-black uppercase tracking-widest text-gray-600"
                    >
                      {revealed.includes(integration.id) ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copy(`token-${integration.id}`, integration.webhook_token)
                      }
                      aria-label="Copy webhook token"
                      className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200 text-gray-600"
                    >
                      {copied === `token-${integration.id}` ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </label>
              </div>

              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
                <ShieldCheck className="h-3.5 w-3.5" /> POST JSON with the
                X-Aggregator-Token header. Duplicate external_order_id values return
                the original order.
              </p>

              <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Outbound status sync
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 ${
                      integration.outbound_enabled
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {integration.outbound_enabled ? "On" : "Off"}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    data-testid={`integration-outbound-url-${integration.id}`}
                    aria-label="Outbound status URL"
                    value={
                      outboundDrafts[integration.id]?.url ?? integration.outbound_url ?? ""
                    }
                    onChange={(event) =>
                      setOutboundDrafts((current) => ({
                        ...current,
                        [integration.id]: {
                          url: event.target.value,
                          enabled:
                            current[integration.id]?.enabled ??
                            Boolean(integration.outbound_enabled),
                        },
                      }))
                    }
                    placeholder="https://partner.example.com/hooks/order-status"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] font-bold text-gray-700"
                  />
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    <input
                      type="checkbox"
                      checked={
                        outboundDrafts[integration.id]?.enabled ??
                        Boolean(integration.outbound_enabled)
                      }
                      onChange={(event) =>
                        setOutboundDrafts((current) => ({
                          ...current,
                          [integration.id]: {
                            url:
                              current[integration.id]?.url ??
                              integration.outbound_url ??
                              "",
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    data-testid={`integration-outbound-save-${integration.id}`}
                    onClick={() => void saveOutbound(integration)}
                    disabled={busy === `outbound-${integration.id}`}
                    className="rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    Save sync
                  </button>
                </div>
                {integration.outbound_secret && (
                  <p className="mt-2 truncate font-mono text-[10px] font-bold text-gray-400">
                    Signing secret: {integration.outbound_secret}
                  </p>
                )}
              </div>

              <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Outbound menu sync
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 ${
                      integration.menu_sync_enabled
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {integration.menu_sync_enabled ? "On" : "Off"}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    data-testid={`integration-menu-url-${integration.id}`}
                    aria-label="Menu sync URL"
                    value={menuDrafts[integration.id]?.url ?? integration.menu_sync_url ?? ""}
                    onChange={(event) =>
                      setMenuDrafts((current) => ({
                        ...current,
                        [integration.id]: {
                          url: event.target.value,
                          enabled:
                            current[integration.id]?.enabled ??
                            Boolean(integration.menu_sync_enabled),
                        },
                      }))
                    }
                    placeholder="https://partner.example.com/hooks/menu"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] font-bold text-gray-700"
                  />
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    <input
                      type="checkbox"
                      checked={
                        menuDrafts[integration.id]?.enabled ??
                        Boolean(integration.menu_sync_enabled)
                      }
                      onChange={(event) =>
                        setMenuDrafts((current) => ({
                          ...current,
                          [integration.id]: {
                            url:
                              current[integration.id]?.url ??
                              integration.menu_sync_url ??
                              "",
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    data-testid={`integration-menu-save-${integration.id}`}
                    onClick={() => void saveMenuSync(integration)}
                    disabled={busy === `menu-${integration.id}`}
                    className="rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    Save menu
                  </button>
                  <button
                    type="button"
                    data-testid={`integration-menu-push-${integration.id}`}
                    onClick={() => void pushMenu(integration)}
                    disabled={
                      busy === `menu-${integration.id}` ||
                      !integration.menu_sync_enabled
                    }
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-40"
                  >
                    Push menu
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm font-semibold text-gray-400">
            No aggregator connected yet.
          </p>
        )}
      </section>
    </div>
  );
}
