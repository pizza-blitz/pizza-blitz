"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { reportClientError } from "@/lib/client-errors";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(error, "Dashboard page error");
  }, [error]);

  return (
    <div
      data-testid="app-error-boundary"
      className="flex min-h-[60vh] items-center justify-center p-6"
    >
      <div className="w-full max-w-lg rounded-2xl border border-orange-100 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-orange-100 text-orange-700">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-black text-gray-950">
          Something went wrong on this page
        </h1>
        <p className="mt-2 text-sm font-semibold text-gray-500">
          The error has been recorded for the team. You can retry the page or go
          back to the dashboard.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700"
          >
            <Home className="h-4 w-4" /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
