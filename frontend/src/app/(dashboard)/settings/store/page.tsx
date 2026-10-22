"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Clock,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  PauseCircle,
  Phone,
  Save,
  Store,
  Timer,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API = getApiUrl("/api/v1/restaurant/ops/store-profile");

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

type DayKey = (typeof DAYS)[number]["key"];
type HoursMode = "always" | "custom";

type StoreStatus = {
  state: "open" | "closed" | "paused";
  is_open: boolean;
  accepting_orders: boolean;
  message: string;
  next_opening: string | null;
  timezone: string;
};

type StoreProfileResponse = {
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  map_url: string | null;
  instagram_url: string | null;
  opening_hours: Record<string, { open: string; close: string } | null> | null;
  online_ordering_paused: boolean;
  pause_message: string | null;
  prep_time_minutes: number;
  status: StoreStatus;
  updated_at: string | null;
};

type HourRow = { enabled: boolean; open: string; close: string };

const DEFAULT_WINDOW = { open: "11:00", close: "23:00" };

function defaultRows(): Record<DayKey, HourRow> {
  return DAYS.reduce(
    (accumulator, day) => {
      accumulator[day.key] = { enabled: true, ...DEFAULT_WINDOW };
      return accumulator;
    },
    {} as Record<DayKey, HourRow>
  );
}

function rowsFromProfile(hours: StoreProfileResponse["opening_hours"]): Record<DayKey, HourRow> {
  const rows = DAYS.reduce(
    (accumulator, day) => {
      accumulator[day.key] = { enabled: false, ...DEFAULT_WINDOW };
      return accumulator;
    },
    {} as Record<DayKey, HourRow>
  );
  if (!hours) return rows;
  for (const day of DAYS) {
    const window = hours[day.key];
    if (window) {
      rows[day.key] = { enabled: true, open: window.open, close: window.close };
    }
  }
  return rows;
}

function formatHoursSummary(hours: StoreProfileResponse["opening_hours"]) {
  if (hours === null) return "Open 24/7 — hours have not been configured.";
  const enabled = DAYS.filter((day) => hours[day.key]);
  if (!enabled.length) return "Closed every day.";
  const first = hours[enabled[0].key];
  const uniform = enabled.every((day) => {
    const window = hours[day.key];
    return window && window.open === first?.open && window.close === first?.close;
  });
  if (uniform && enabled.length === 7) {
    return `Every day ${first?.open}–${first?.close}`;
  }
  return `${enabled.length} opening day${enabled.length === 1 ? "" : "s"} configured.`;
}

export default function StoreProfilePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(
    null
  );
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [name, setName] = useState("Pizza Blitz");
  const [tagline, setTagline] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [prepTime, setPrepTime] = useState("25");
  const [hoursMode, setHoursMode] = useState<HoursMode>("always");
  const [rows, setRows] = useState<Record<DayKey, HourRow>>(defaultRows);
  const [paused, setPaused] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");

  const load = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const response = await fetch(API, { credentials: "include", cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as StoreProfileResponse & {
        detail?: string;
      };
      if (!response.ok) throw new Error(data.detail || "Could not load the store profile.");
      setName(data.name || "Pizza Blitz");
      setTagline(data.tagline || "");
      setPhone(data.phone || "");
      setEmail(data.email || "");
      setAddressLine(data.address_line || "");
      setMapUrl(data.map_url || "");
      setInstagramUrl(data.instagram_url || "");
      setPrepTime(String(data.prep_time_minutes ?? 25));
      setHoursMode(data.opening_hours === null ? "always" : "custom");
      setRows(rowsFromProfile(data.opening_hours));
      setPaused(Boolean(data.online_ordering_paused));
      setPauseMessage(data.pause_message || "");
      setStatus(data.status);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not load the store profile.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (day: DayKey, patch: Partial<HourRow>) => {
    setRows((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
  };

  const selectHoursMode = (mode: HoursMode) => {
    if (mode === "custom" && hoursMode === "always") {
      setRows((current) => {
        if (DAYS.some((day) => current[day.key].enabled)) return current;
        return DAYS.reduce(
          (accumulator, day) => {
            accumulator[day.key] = { enabled: true, ...DEFAULT_WINDOW };
            return accumulator;
          },
          {} as Record<DayKey, HourRow>
        );
      });
    }
    setHoursMode(mode);
  };

  const save = async () => {
    if (!name.trim()) {
      setMessage({ tone: "error", text: "Store name is required." });
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const openingHours =
        hoursMode === "always"
          ? null
          : DAYS.reduce<Record<string, { open: string; close: string }>>((accumulator, day) => {
              const row = rows[day.key];
              if (row.enabled) {
                accumulator[day.key] = { open: row.open, close: row.close };
              }
              return accumulator;
            }, {});

      const response = await fetch(API, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          tagline: tagline.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address_line: addressLine.trim() || null,
          map_url: mapUrl.trim() || null,
          instagram_url: instagramUrl.trim() || null,
          opening_hours: openingHours,
          online_ordering_paused: paused,
          pause_message: pauseMessage.trim() || null,
          prep_time_minutes: Number.isFinite(Number(prepTime)) ? Number(prepTime) : 25,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not save the store profile.");
      setStatus(data.status);
      setHoursMode(data.opening_hours === null ? "always" : "custom");
      setRows(rowsFromProfile(data.opening_hours));
      setMessage({ tone: "success", text: "Store profile saved. The public site uses it immediately." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save the store profile.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const statusTone =
    status?.state === "open"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status?.state === "paused"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-gray-50 text-gray-700";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight text-gray-950">
            <Store className="h-7 w-7 text-orange-600" /> Store profile
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500">
            This information drives the public landing page, opening-hours status, and whether online
            ordering is accepted.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || isLoading}
          data-testid="store-profile-save"
          className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-5 py-3 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? "Saving" : "Save changes"}
        </button>
      </div>

      {message && (
        <div
          data-testid="store-profile-message"
          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-8 text-sm font-semibold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading store profile...
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">
                Store identity
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-gray-600">
                  Store name
                  <input
                    aria-label="Store name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Tagline
                  <input
                    aria-label="Store tagline"
                    value={tagline}
                    onChange={(event) => setTagline(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Phone
                  <input
                    aria-label="Store phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 ..."
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Support email
                  <input
                    aria-label="Store email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600 sm:col-span-2">
                  Address
                  <input
                    aria-label="Store address"
                    value={addressLine}
                    onChange={(event) => setAddressLine(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Map link
                  <input
                    aria-label="Map link"
                    value={mapUrl}
                    onChange={(event) => setMapUrl(event.target.value)}
                    placeholder="https://maps.google.com/..."
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Instagram
                  <input
                    aria-label="Instagram link"
                    value={instagramUrl}
                    onChange={(event) => setInstagramUrl(event.target.value)}
                    placeholder="https://instagram.com/..."
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-5">
              <div className={`rounded-2xl border p-5 ${statusTone}`} data-testid="store-status-card">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-black uppercase tracking-widest">Online ordering</h2>
                  {status?.state === "open" ? (
                    <BadgeCheck className="h-5 w-5" />
                  ) : status?.state === "paused" ? (
                    <PauseCircle className="h-5 w-5" />
                  ) : (
                    <Clock className="h-5 w-5" />
                  )}
                </div>
                <p className="mt-3 text-2xl font-black capitalize">{status?.state || "unknown"}</p>
                <p className="mt-1 text-sm font-semibold">{status?.message}</p>
                {status?.next_opening ? (
                  <p className="mt-2 text-xs font-bold uppercase tracking-widest opacity-70">
                    Next opening: {status.next_opening}
                  </p>
                ) : null}
                <p className="mt-2 text-[10px] font-bold uppercase tracking-widest opacity-60">
                  Timezone: {status?.timezone}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <label className="flex items-start gap-3 text-sm font-bold text-amber-950">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(event) => setPaused(event.target.checked)}
                    aria-label="Pause online ordering"
                    className="mt-1 h-4 w-4"
                  />
                  Pause online ordering now
                </label>
                <input
                  aria-label="Pause message"
                  value={pauseMessage}
                  onChange={(event) => setPauseMessage(event.target.value)}
                  placeholder="Message shown to customers while paused"
                  className="mt-3 w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm font-semibold text-amber-950 outline-none focus:border-amber-400"
                />
                <label className="mt-4 block text-xs font-bold text-amber-900">
                  <span className="flex items-center gap-2">
                    <Timer className="h-3.5 w-3.5" /> Prep time (minutes)
                  </span>
                  <input
                    aria-label="Prep time minutes"
                    type="number"
                    min={0}
                    max={240}
                    value={prepTime}
                    onChange={(event) => setPrepTime(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm font-semibold text-amber-950 outline-none focus:border-amber-400"
                  />
                </label>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">
                  Opening hours
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  {formatHoursSummary(
                    hoursMode === "always"
                      ? null
                      : DAYS.reduce<Record<string, { open: string; close: string }>>(
                          (accumulator, day) => {
                            const row = rows[day.key];
                            if (row.enabled) {
                              accumulator[day.key] = { open: row.open, close: row.close };
                            }
                            return accumulator;
                          },
                          {}
                        )
                  )}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {(["always", "custom"] as HoursMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => selectHoursMode(mode)}
                    className={`rounded-md px-3 py-2 text-xs font-black uppercase tracking-widest ${
                      hoursMode === mode
                        ? "bg-gray-950 text-white"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {mode === "always" ? "24/7" : "Custom hours"}
                  </button>
                ))}
              </div>
            </div>

            {hoursMode === "custom" ? (
              <div className="mt-5 space-y-2">
                {DAYS.map((day) => {
                  const row = rows[day.key];
                  return (
                    <div
                      key={day.key}
                      className="grid grid-cols-1 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 sm:grid-cols-[120px_1fr_1fr_110px]"
                    >
                      <p className="text-sm font-black text-gray-900">{day.label}</p>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Opens
                        <input
                          aria-label={`${day.label} opening time`}
                          type="time"
                          value={row.open}
                          disabled={!row.enabled}
                          onChange={(event) => updateRow(day.key, { open: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-900 disabled:opacity-40"
                        />
                      </label>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Closes
                        <input
                          aria-label={`${day.label} closing time`}
                          type="time"
                          value={row.close}
                          disabled={!row.enabled}
                          onChange={(event) => updateRow(day.key, { close: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-900 disabled:opacity-40"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          aria-label={`${day.label} open`}
                          onChange={(event) => updateRow(day.key, { enabled: event.target.checked })}
                          className="h-4 w-4"
                        />
                        Open
                      </label>
                    </div>
                  );
                })}
                <p className="text-[11px] font-semibold text-gray-400">
                  Overnight windows are allowed (for example 22:00–02:00). Unconfigured hours mean the
                  store accepts orders 24/7.
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm font-semibold text-gray-500">
                Online ordering stays open around the clock. Switch to custom hours to set a weekly
                schedule.
              </div>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: Phone, label: "Phone", value: phone || "Not set" },
              { icon: Mail, label: "Email", value: email || "Not set" },
              { icon: MapPin, label: "Address", value: addressLine || "Not set" },
              { icon: Instagram, label: "Instagram", value: instagramUrl || "Not set" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-gray-100 bg-white p-4">
                  <Icon className="h-4 w-4 text-orange-600" />
                  <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {item.label}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-bold text-gray-800">{item.value}</p>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
