"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type TwoFactorStatus = {
  enabled: boolean;
  confirmed_at?: string | null;
  recovery_codes_remaining: number;
  role?: string;
  subject?: string;
};

type PermissionItem = {
  key: string;
  label: string;
  group: string;
  description: string;
  enabled: boolean;
  overridden?: boolean;
};

type SetupData = {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account: string;
  digits: number;
  period_seconds: number;
};

export default function SecuritySettingsPage() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const loadStatus = async () => {
    const response = await fetch(getApiUrl("/api/v1/auth/2fa/status"), {
      credentials: "include",
      cache: "no-store",
    });
    if (response.ok) setStatus(await response.json());
  };

  const loadPermissions = async () => {
    const response = await fetch(getApiUrl("/api/v1/auth/permissions"), {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();
    const items: PermissionItem[] = data.permissions || [];
    setPermissions(items);
    setSelectedPermissions(
      items.filter((item) => item.enabled).map((item) => item.key)
    );
  };

  useEffect(() => {
    setHydrated(true);
    void loadStatus();
    void loadPermissions();
  }, []);

  const startSetup = async () => {
    setBusy("setup");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/auth/2fa/setup"), {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Setup could not start.");
      setSetup(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup could not start.");
    } finally {
      setBusy("");
    }
  };

  const confirmSetup = async () => {
    setBusy("confirm");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/auth/2fa/confirm"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Code could not be confirmed.");
      setRecoveryCodes(data.recovery_codes || []);
      setSetup(null);
      setCode("");
      setMessage("Two-factor authentication is on.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Code could not be confirmed.");
    } finally {
      setBusy("");
    }
  };

  const disable = async () => {
    setBusy("disable");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/auth/2fa/disable"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Two-factor could not be disabled.");
      setDisableCode("");
      setRecoveryCodes([]);
      setMessage("Two-factor authentication is off.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Two-factor could not be disabled.");
    } finally {
      setBusy("");
    }
  };

  const savePermissions = async () => {
    setBusy("permissions");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/auth/permissions/staff"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: selectedPermissions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Permissions could not be saved.");
      setPermissions(data.permissions || []);
      setMessage("Staff permissions saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permissions could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const copySecret = async () => {
    if (!setup) return;
    await navigator.clipboard.writeText(setup.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const groups = Array.from(new Set(permissions.map((item) => item.group)));

  return (
    <div
      data-testid="security-page"
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
          <h1 className="mt-2 text-3xl font-black text-gray-950">Security & access</h1>
          <p className="mt-1 text-sm text-gray-500">
            Two-factor authentication for this account and granular permissions for counter staff.
          </p>
        </div>
        <span className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
          {status?.subject || "Signed in"}
        </span>
      </div>

      {message && (
        <div
          data-testid="security-message"
          className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900"
        >
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-100 text-orange-700">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-black text-gray-950">Two-factor authentication</h2>
              <p className="text-sm text-gray-500">
                Require a 6-digit authenticator code after your password.
              </p>
            </div>
          </div>
          <span
            data-testid="security-2fa-status"
            className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              status?.enabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {status?.enabled ? "Enabled" : "Not enabled"}
          </span>
        </div>

        {status?.enabled ? (
          <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <p className="text-sm font-bold text-emerald-900">
              Authenticator is protecting this account.
            </p>
            <p className="mt-1 text-xs font-semibold text-emerald-800">
              Recovery codes remaining: {status.recovery_codes_remaining}
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Code to disable
                <input
                  data-testid="security-disable-code"
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                  placeholder="000000 or recovery code"
                  className="mt-1 w-56 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900"
                />
              </label>
              <button
                type="button"
                data-testid="security-disable"
                onClick={disable}
                disabled={busy === "disable" || disableCode.trim().length < 3}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <ShieldOff className="h-4 w-4" /> Disable 2FA
              </button>
            </div>
          </div>
        ) : setup ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px]">
            <div>
              <p className="text-sm font-bold text-gray-900">
                Add this account to Google Authenticator, 1Password, or Authy.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <code
                  data-testid="security-2fa-secret"
                  className="flex-1 break-all font-mono text-xs font-bold text-gray-800"
                >
                  {setup.secret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  aria-label="Copy authenticator secret"
                  className="grid h-8 w-8 place-items-center rounded-md bg-white text-gray-600"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <a
                href={setup.otpauth_uri}
                className="mt-2 inline-block text-[11px] font-bold text-orange-700 underline"
              >
                Open in authenticator app
              </a>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Enter the 6-digit code
                  <input
                    data-testid="security-2fa-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    placeholder="000000"
                    className="mt-1 w-44 rounded-lg border border-gray-200 px-3 py-2.5 text-center text-lg font-black tracking-[0.2em] text-gray-900"
                  />
                </label>
                <button
                  type="button"
                  data-testid="security-2fa-confirm"
                  onClick={confirmSetup}
                  disabled={busy === "confirm" || code.trim().length < 6}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-950 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {busy === "confirm" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Smartphone className="h-4 w-4" />
                  )}
                  Confirm and enable
                </button>
              </div>
            </div>
            <div className="rounded-xl bg-gray-950 p-4 text-white">
              <KeyRound className="h-5 w-5 text-orange-400" />
              <p className="mt-2 text-sm font-black">Recovery codes</p>
              <p className="mt-1 text-xs text-gray-400">
                You will get 8 one-time codes after confirming. Store them somewhere safe.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="security-2fa-start"
              onClick={startSetup}
              disabled={busy === "setup"}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
            >
              <LockKeyhole className="h-4 w-4" /> Enable 2FA
            </button>
            <p className="text-xs font-semibold text-gray-500">
              You will need an authenticator app. SMS is not used for admin codes.
            </p>
          </div>
        )}

        {recoveryCodes.length > 0 && (
          <div
            data-testid="security-recovery-codes"
            className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
          >
            <p className="text-sm font-black text-amber-900">
              Save these recovery codes now. They will not be shown again.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {recoveryCodes.map((recoveryCode) => (
                <code
                  key={recoveryCode}
                  className="rounded-md bg-white px-2 py-1.5 text-center font-mono text-xs font-bold text-gray-800"
                >
                  {recoveryCode}
                </code>
              ))}
            </div>
          </div>
        )}
      </section>

      {permissions.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-gray-950">Counter staff permissions</h2>
              <p className="text-sm text-gray-500">
                Admins always have full access. Toggle what staff can do; changes apply on their next request.
              </p>
            </div>
            <button
              type="button"
              data-testid="save-permissions"
              onClick={savePermissions}
              disabled={busy === "permissions"}
              className="rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {busy === "permissions" ? "Saving" : "Save permissions"}
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {groups.map((group) => (
              <div key={group}>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {group}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {permissions
                    .filter((item) => item.group === group)
                    .map((item) => {
                      const active = selectedPermissions.includes(item.key);
                      return (
                        <label
                          key={item.key}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 ${
                            active ? "border-orange-200 bg-orange-50/60" : "border-gray-100 bg-gray-50/60"
                          }`}
                        >
                          <input
                            data-testid={`staff-permission-${item.key}`}
                            type="checkbox"
                            checked={active}
                            onChange={() =>
                              setSelectedPermissions((current) =>
                                current.includes(item.key)
                                  ? current.filter((key) => key !== item.key)
                                  : [...current, item.key]
                              )
                            }
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-black text-gray-900">
                              {item.label}
                            </span>
                            <span className="block text-xs font-semibold text-gray-500">
                              {item.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
