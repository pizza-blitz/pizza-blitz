"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ImageIcon, Loader2, Search, Upload, X } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type MediaAsset = {
  id: number;
  name: string;
  url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  created_at?: string | null;
};

type MediaPickerProps = {
  label?: string;
  value: string;
  onChange: (url: string) => void;
  testId?: string;
  helpText?: string;
};

const API = getApiUrl("/api/v1/restaurant/media/assets");

export default function MediaPicker({
  label = "Image",
  value,
  onChange,
  testId = "media-picker",
  helpText = "Choose a shared image or upload a new one. JPEG, PNG or WebP up to 5 MB.",
}: MediaPickerProps) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const fetchAssets = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API}?q=${encodeURIComponent(search)}&limit=100`,
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Media library failed to load.");
      setAssets(data.assets || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Media library failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void fetchAssets(query), 180);
    return () => window.clearTimeout(timer);
  }, [fetchAssets, open, query]);

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", file.name.replace(/\.[^.]+$/, ""));
      const response = await fetch(API, {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed.");
      setAssets((current) => [data.asset, ...current]);
      onChange(data.asset.url);
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid={testId} className="space-y-1.5">
      <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
        {label}
        <div className="mt-1 flex gap-2">
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="/media/library/... or https://"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
          />
          <button
            type="button"
            data-testid={`${testId}-open`}
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Choose
          </button>
        </div>
      </label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
          <img src={value} alt="" className="h-12 w-12 rounded-md object-cover" />
          <p className="min-w-0 flex-1 truncate text-[10px] font-semibold text-gray-500">
            {value}
          </p>
        </div>
      ) : null}
      <p className="text-[10px] font-semibold text-gray-400">{helpText}</p>

      {open && (
        <div
          data-testid={`${testId}-dialog`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Media library"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  Shared media
                </p>
                <h2 className="text-2xl font-black text-gray-950">Media library</h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  One image library for menu, landing, social and ad creatives.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close media library"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search images or tags"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm font-semibold text-gray-700 outline-none focus:border-orange-400"
                />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => void upload(event.target.files?.[0] || null)}
                />
              </label>
            </div>

            {message && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                {message}
              </p>
            )}

            {loading ? (
              <div className="grid h-48 place-items-center text-sm font-bold text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : assets.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-10 text-center">
                <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm font-bold text-gray-500">No images yet.</p>
                <p className="text-xs font-semibold text-gray-400">Upload the first one above.</p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3 md:grid-cols-4">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    data-testid={`media-asset-${asset.id}`}
                    onClick={() => {
                      onChange(asset.url);
                      setOpen(false);
                    }}
                    className={`group overflow-hidden rounded-xl border text-left ${
                      value === asset.url
                        ? "border-orange-500 ring-2 ring-orange-200"
                        : "border-gray-100 hover:border-orange-300"
                    }`}
                  >
                    <div className="relative aspect-square bg-gray-100">
                      <img
                        src={asset.url}
                        alt={asset.name}
                        className="h-full w-full object-cover"
                      />
                      {value === asset.url && (
                        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-orange-600 text-white">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-[11px] font-black text-gray-800">
                        {asset.name}
                      </p>
                      <p className="truncate text-[9px] font-semibold text-gray-400">
                        {asset.tags.length ? asset.tags.join(" · ") : asset.file_name}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
