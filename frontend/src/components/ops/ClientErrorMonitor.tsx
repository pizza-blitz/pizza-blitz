"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type ClientError = {
  id: number;
  message: string;
  url?: string | null;
  request_id?: string | null;
  created_at?: string | null;
};

export default function ClientErrorMonitor() {
  const [errors, setErrors] = useState<ClientError[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/ops/client-errors?limit=10"),
        { credentials: "include", cache: "no-store" }
      );
      if (response.ok) {
        const data = await response.json();
        setErrors(data.errors || []);
      }
    } catch {
      // The monitor is best-effort.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      data-testid="client-error-monitor"
      className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-500/10 text-red-300">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Client error monitoring
            </p>
            <p className="text-sm font-black text-white">
              {errors.length
                ? `${errors.length} recent browser error${errors.length === 1 ? "" : "s"}`
                : "No browser errors recorded"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300 hover:bg-white/5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="mt-4 space-y-2">
          {errors.slice(0, 3).map((error) => (
            <li
              key={error.id}
              className="rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-2"
            >
              <p className="text-xs font-bold text-red-200">{error.message}</p>
              <p className="mt-0.5 truncate text-[10px] font-semibold text-gray-500">
                {error.url || "Unknown page"}
                {error.request_id ? ` · ${error.request_id}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
