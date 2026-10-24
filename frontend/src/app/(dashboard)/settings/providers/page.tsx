"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type ProviderField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  value: string;
  configured: boolean;
};

type Provider = {
  provider: string;
  label: string;
  group: string;
  description: string;
  enabled: boolean;
  source: "custom" | "environment";
  has_custom: boolean;
  configured: boolean;
  missing: string[];
  fields: ProviderField[];
};

type Draft = { values: Record<string, string>; enabled: boolean };

const API = getApiUrl("/api/v1/restaurant/provider-settings");

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const applyProviders = (rows: Provider[]) => {
    setProviders(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((row) => [
          row.provider,
          {
            enabled: row.enabled,
            values: Object.fromEntries(
              row.fields.map((field) => [field.key, field.secret ? "" : field.value])
            ),
          },
        ])
      )
    );
  };

  const fetchProviders = async () => {
    try {
      const response = await fetch(`${API}/`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Providers failed to load.");
      applyProviders(data.providers || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Providers failed to load.");
    }
  };

  useEffect(() => {
    setHydrated(true);
    void fetchProviders();
  }, []);

  const updateDraft = (provider: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }));
  };

  const save = async (provider: Provider) => {
    const draft = drafts[provider.provider];
    if (!draft) return;
    setBusy(`save-${provider.provider}`);
    setMessage("");
    try {
      const response = await fetch(`${API}/${provider.provider}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          values: Object.fromEntries(
            Object.entries(draft.values).filter(([, value]) => value.trim())
          ),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Provider save failed.");
      setProviders((current) =>
        current.map((row) =>
          row.provider === provider.provider ? data.provider : row
        )
      );
      setDrafts((current) => ({
        ...current,
        [provider.provider]: {
          enabled: data.provider.enabled,
          values: Object.fromEntries(
            data.provider.fields.map((field: ProviderField) => [
              field.key,
              field.secret ? "" : field.value,
            ])
          ),
        },
      }));
      setMessage(`${provider.label} saved with encrypted credentials.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider save failed.");
    } finally {
      setBusy("");
    }
  };

  const validate = async (provider: Provider) => {
    setBusy(`validate-${provider.provider}`);
    try {
      const response = await fetch(`${API}/${provider.provider}/validate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Validation failed.");
      setMessage(
        data.valid
          ? `${provider.label}: ${data.detail}`
          : `${provider.label} is missing: ${data.missing.join(", ")}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setBusy("");
    }
  };

  const reset = async (provider: Provider) => {
    if (!window.confirm(`Reset ${provider.label} to environment variables?`)) return;
    setBusy(`reset-${provider.provider}`);
    try {
      const response = await fetch(`${API}/${provider.provider}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Reset failed.");
      await fetchProviders();
      setMessage(`${provider.label} reset to the environment fallback.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setBusy("");
    }
  };

  const groups = Array.from(new Set(providers.map((provider) => provider.group)));

  return (
    <div
      data-testid="providers-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
          Settings · integrations
        </p>
        <h1 className="text-3xl font-black text-gray-950">Providers</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Credentials are encrypted at rest and take effect immediately. Empty fields fall
          back to the environment, so existing deployments keep working.
        </p>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {providers.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-8 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading providers...
        </div>
      ) : (
        groups.map((group) => (
          <section key={group} className="space-y-3">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {group}
            </h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {providers
                .filter((provider) => provider.group === group)
                .map((provider) => {
                  const draft = drafts[provider.provider];
                  if (!draft) return null;
                  return (
                    <article
                      key={provider.provider}
                      data-testid={`provider-${provider.provider}`}
                      className="rounded-2xl border border-gray-100 bg-white p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-black text-gray-900">
                            <KeyRound className="h-4 w-4 text-orange-600" />
                            {provider.label}
                          </p>
                          <p className="mt-1 max-w-md text-xs font-semibold leading-5 text-gray-500">
                            {provider.description}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                            provider.configured
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {provider.configured ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {provider.configured ? "ready" : "needs setup"}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold text-gray-500">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 uppercase tracking-widest">
                          {provider.source === "custom"
                            ? "encrypted override"
                            : "environment"}
                        </span>
                        {provider.enabled ? (
                          <span className="text-emerald-700">enabled</span>
                        ) : (
                          <span className="text-amber-700">disabled</span>
                        )}
                      </div>

                      <div className="mt-4 space-y-3">
                        {provider.fields.map((field) => (
                          <label
                            key={field.key}
                            className="block text-[10px] font-black uppercase tracking-widest text-gray-500"
                          >
                            {field.label}
                            {field.required ? " *" : ""}
                            <input
                              type={field.secret ? "password" : "text"}
                              value={draft.values[field.key] || ""}
                              onChange={(event) =>
                                updateDraft(provider.provider, {
                                  values: {
                                    ...draft.values,
                                    [field.key]: event.target.value,
                                  },
                                })
                              }
                              placeholder={
                                field.secret && field.configured
                                  ? "Saved - leave blank to keep"
                                  : field.label
                              }
                              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
                            />
                          </label>
                        ))}
                      </div>

                      <label className="mt-3 flex items-center gap-2 text-xs font-bold text-gray-600">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(event) =>
                            updateDraft(provider.provider, { enabled: event.target.checked })
                          }
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Enable this provider
                      </label>

                      {provider.missing.length > 0 && (
                        <p className="mt-2 text-[10px] font-semibold text-amber-700">
                          Missing: {provider.missing.join(", ")}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`provider-save-${provider.provider}`}
                          onClick={() => void save(provider)}
                          disabled={busy === `save-${provider.provider}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          {busy === `save-${provider.provider}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => void validate(provider)}
                          disabled={busy === `validate-${provider.provider}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" /> Validate
                        </button>
                        {provider.has_custom && (
                          <button
                            type="button"
                            onClick={() => void reset(provider)}
                            disabled={busy === `reset-${provider.provider}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Reset
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ))
      )}

      <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-5 text-amber-900">
        Validation checks required fields only. It does not send a live SMS, email or
        social post; provider verification happens on the first real send. Use the
        provider test-send/readiness tools for a live check when credentials are active.
      </p>
    </div>
  );
}
