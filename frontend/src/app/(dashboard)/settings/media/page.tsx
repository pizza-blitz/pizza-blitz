"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type MediaAsset = {
  id: number;
  name: string;
  url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  uploaded_by?: string | null;
  created_at?: string | null;
};

const API = getApiUrl("/api/v1/restaurant/media/assets");

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function MediaStudioPage() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API}?q=${encodeURIComponent(search)}&limit=200`,
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
    const timer = window.setTimeout(() => void fetchAssets(query), 180);
    return () => window.clearTimeout(timer);
  }, [fetchAssets, query]);

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", file.name.replace(/\.[^.]+$/, ""));
      body.append("tags", "studio");
      const response = await fetch(API, {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed.");
      setMessage(`Added ${data.asset.name} to the library.`);
      await fetchAssets(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete ${asset.name}? Images used by menu, social or ads cannot be deleted.`)) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API}/${asset.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Image could not be deleted.");
      }
      setMessage(`Deleted ${asset.name}.`);
      await fetchAssets(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (asset: MediaAsset) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopied(asset.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setMessage("Copy failed. Select the URL manually.");
    }
  };

  return (
    <div
      data-testid="media-library-page"
      data-hydrated={!loading ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Content · shared assets
          </p>
          <h1 className="text-3xl font-black text-gray-950">Media Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            One image library for the menu, landing page, social posts and ad creatives.
            Upload once, then choose it anywhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void upload(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            data-testid="media-upload-button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Add image
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, filename or tag"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm font-semibold text-gray-700 outline-none focus:border-orange-400"
          />
        </label>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {assets.length} assets · JPEG, PNG, WebP · max 5 MB
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-8 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading media...
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <ImageIcon className="mx-auto h-9 w-9 text-gray-300" />
          <h2 className="mt-3 text-lg font-black text-gray-800">No images yet</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            Upload a product shot to start the shared library.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white"
          >
            <Upload className="h-4 w-4" /> Add first image
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <article
              key={asset.id}
              data-testid={`media-library-asset-${asset.id}`}
              className="overflow-hidden rounded-2xl border border-gray-100 bg-white"
            >
              <div className="aspect-[4/3] bg-gray-100">
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="space-y-2 p-3">
                <div>
                  <p className="truncate text-sm font-black text-gray-900">{asset.name}</p>
                  <p className="truncate text-[10px] font-semibold text-gray-400">
                    {asset.file_name} · {formatBytes(asset.size_bytes)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copyUrl(asset)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
                  >
                    {copied === asset.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied === asset.id ? "Copied" : "URL"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${asset.name}`}
                    onClick={() => void remove(asset)}
                    disabled={busy}
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
