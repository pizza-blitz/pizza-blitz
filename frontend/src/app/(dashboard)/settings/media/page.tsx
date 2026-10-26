"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Circle,
  Copy,
  Image as ImageIcon,
  Loader2,
  Search,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type MediaAsset = {
  id: number;
  name: string;
  url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  media_type: "image" | "video";
  poster_url?: string | null;
  duration_seconds?: number | null;
  caption_url?: string | null;
  caption_language?: string | null;
  width?: number | null;
  height?: number | null;
  tags: string[];
  uploaded_by?: string | null;
  created_at?: string | null;
};

const API = getApiUrl("/api/v1/restaurant/media/assets");
const STORAGE_API = getApiUrl("/api/v1/restaurant/media/storage-status");

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export default function MediaStudioPage() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [storage, setStorage] = useState<{
    backend: string;
    configured: boolean;
    missing_settings: string[];
    bucket?: string | null;
    public_base_url?: string | null;
    cdn_enabled: boolean;
  } | null>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordReady, setRecordReady] = useState<File | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [recordName, setRecordName] = useState("");
  const [trimAsset, setTrimAsset] = useState<MediaAsset | null>(null);
  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState("1");
  const [trimName, setTrimName] = useState("");
  const [trimBusy, setTrimBusy] = useState(false);
  const [trimError, setTrimError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(STORAGE_API, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        setStorage(data.storage);
      } catch {
        setStorage(null);
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(
      () => setRecordSeconds((value) => value + 1),
      1000
    );
    return () => window.clearInterval(timer);
  }, [recording]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  };

  const closeRecorder = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    stopCamera();
    setRecorderOpen(false);
    setRecording(false);
    setRecordReady(null);
    setRecordSeconds(0);
    setCameraError("");
    setRecordName("");
  };

  const openRecorder = async () => {
    setRecorderOpen(true);
    setRecordReady(null);
    setRecordSeconds(0);
    setCameraError("");
    setRecordName(`Reel ${new Date().toLocaleDateString("en-IN")}`);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError(
        "Camera/microphone permission was denied. Allow access and try again."
      );
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) {
      setCameraError("Start the camera first.");
      return;
    }
    const mimeType =
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
      ) || "";
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeType || "video/webm",
      });
      if (blob.size > 0) {
        setRecordReady(
          new File([blob], `reel-${Date.now()}.webm`, { type: "video/webm" })
        );
      }
      setRecording(false);
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setRecordSeconds(0);
    setRecording(true);
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  };

  const uploadRecording = async () => {
    if (!recordReady) return;
    setRecordBusy(true);
    setCameraError("");
    try {
      const body = new FormData();
      body.append("file", recordReady);
      body.append("name", recordName.trim() || "Recorded reel");
      body.append("tags", "studio,reel,recorded");
      const response = await fetch(API, {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Recorded reel upload failed.");
      setMessage(`Recorded ${data.asset.name} and added it to the library.`);
      await fetchAssets(query);
      closeRecorder();
    } catch (error) {
      setCameraError(
        error instanceof Error ? error.message : "Recorded reel upload failed."
      );
    } finally {
      setRecordBusy(false);
    }
  };

  const openTrim = (asset: MediaAsset) => {
    setTrimAsset(asset);
    setTrimStart("0");
    setTrimEnd(String(Math.min(asset.duration_seconds || 1, 180)));
    setTrimName(`${asset.name} (trim)`);
    setTrimError("");
  };

  const submitTrim = async () => {
    if (!trimAsset) return;
    setTrimBusy(true);
    setTrimError("");
    try {
      const response = await fetch(`${API}/${trimAsset.id}/trim`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_seconds: Number(trimStart),
          end_seconds: Number(trimEnd),
          name: trimName.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Clip trim failed.");
      setMessage(`Trimmed ${data.asset.name} into a new clip.`);
      setTrimAsset(null);
      await fetchAssets(query);
    } catch (error) {
      setTrimError(error instanceof Error ? error.message : "Clip trim failed.");
    } finally {
      setTrimBusy(false);
    }
  };

  const uploadCaption = async (asset: MediaAsset, file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("language", "en");
      const response = await fetch(`${API}/${asset.id}/caption`, {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Caption upload failed.");
      setMessage(`Captions added to ${asset.name}.`);
      await fetchAssets(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Caption upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const removeCaption = async (asset: MediaAsset) => {
    setBusy(true);
    try {
      const response = await fetch(`${API}/${asset.id}/caption`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Caption could not be removed.");
      setMessage(`Captions removed from ${asset.name}.`);
      await fetchAssets(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Caption could not be removed.");
    } finally {
      setBusy(false);
    }
  };

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
    if (!window.confirm(`Delete ${asset.name}? Media used by menu, social or ads cannot be deleted.`)) {
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
        throw new Error(data.detail || "Media could not be deleted.");
      }
      setMessage(`Deleted ${asset.name}.`);
      await fetchAssets(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Media could not be deleted.");
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
            One library for menu, landing, social posts and ad creatives. Images are optimised
            for the storefront; videos are transcoded to MP4 with a poster for reels and shorts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="media-record-open"
            onClick={() => void openRecorder()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300 disabled:opacity-50"
          >
            <Video className="h-4 w-4" /> Record reel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
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
            Add media
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {storage && (
        <div
          data-testid="media-storage-status"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-3 text-[10px] font-bold text-gray-500"
        >
          <span className="uppercase tracking-widest">Storage</span>
          <span className="rounded-full bg-gray-950 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
            {storage.backend === "s3" ? "S3 / CDN" : "Local disk"}
          </span>
          {storage.backend === "s3" && (
            <span>
              {storage.configured ? "configured" : `missing ${storage.missing_settings.join(", ")}`}
              {storage.public_base_url ? ` · ${storage.public_base_url}` : ""}
            </span>
          )}
          {storage.backend === "local" && (
            <span>Files are served from `/media`; set MEDIA_STORAGE_BACKEND=s3 for CDN delivery.</span>
          )}
        </div>
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
          {assets.length} assets · JPEG, PNG, WebP, MP4, MOV, WebM
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-8 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading media...
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <ImageIcon className="mx-auto h-9 w-9 text-gray-300" />
          <h2 className="mt-3 text-lg font-black text-gray-800">No media yet</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            Upload a product shot or a short reel to start the shared library.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white"
          >
            <Upload className="h-4 w-4" /> Add first media
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
              <div className="relative aspect-[4/3] bg-gray-100">
                {asset.media_type === "video" ? (
                  <video
                    src={asset.url}
                    poster={asset.poster_url || undefined}
                    controls
                    preload="metadata"
                    className="h-full w-full object-cover"
                  >
                    {asset.caption_url && (
                      <track
                        key={asset.caption_url}
                        kind="captions"
                        src={asset.caption_url}
                        srcLang={asset.caption_language || "en"}
                        label="Captions"
                        default
                      />
                    )}
                  </video>
                ) : (
                  <img
                    src={asset.url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                )}
                {asset.media_type === "video" && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
                    Reel · {formatDuration(asset.duration_seconds)}
                  </span>
                )}
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
                  {asset.media_type === "video" && (
                    <button
                      type="button"
                      data-testid={`media-trim-${asset.id}`}
                      onClick={() => openTrim(asset)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
                    >
                      Trim
                    </button>
                  )}
                  {asset.media_type === "video" && (
                    <label
                      data-testid={`media-caption-button-${asset.id}`}
                      className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
                      title={asset.caption_url ? "Replace captions" : "Add VTT/SRT captions"}
                    >
                      CC
                      <input
                        data-testid={`media-caption-input-${asset.id}`}
                        type="file"
                        accept=".vtt,.srt,text/vtt"
                        className="hidden"
                        onChange={(event) =>
                          void uploadCaption(
                            asset,
                            event.target.files?.[0] || null
                          )
                        }
                      />
                    </label>
                  )}
                  {asset.media_type === "video" && asset.caption_url && (
                    <button
                      type="button"
                      data-testid={`media-caption-remove-${asset.id}`}
                      aria-label={`Remove captions from ${asset.name}`}
                      onClick={() => void removeCaption(asset)}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-red-50 hover:text-red-600"
                    >
                      CC×
                    </button>
                  )}
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

      {recorderOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div
            data-testid="media-record-modal"
            className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                  In-browser capture
                </p>
                <h2 className="text-2xl font-black text-gray-950">Record a reel</h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  Record a short clip, then upload it for MP4 transcode and poster extraction.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close reel recorder"
                onClick={closeRecorder}
                className="text-gray-400 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl bg-gray-950">
              <video
                ref={previewRef}
                data-testid="media-record-preview"
                autoPlay
                muted
                playsInline
                className="aspect-video w-full object-cover"
              />
            </div>

            {cameraError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                {cameraError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!recording && !recordReady && (
                <button
                  type="button"
                  data-testid="media-record-start"
                  onClick={startRecording}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                >
                  <Circle className="h-3.5 w-3.5 fill-current" /> Start recording
                </button>
              )}
              {recording && (
                <>
                  <span className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
                    Recording {formatDuration(recordSeconds)}
                  </span>
                  <button
                    type="button"
                    data-testid="media-record-stop"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                </>
              )}
              {recordReady && (
                <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                    Clip ready · {formatBytes(recordReady.size)}
                  </p>
                  <button
                    type="button"
                    data-testid="media-record-upload"
                    onClick={() => void uploadRecording()}
                    disabled={recordBusy}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {recordBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload clip
                  </button>
                </div>
              )}
            </div>

            <label className="mt-3 block text-[9px] font-black uppercase tracking-widest text-gray-500">
              Clip name
              <input
                data-testid="media-record-name"
                value={recordName}
                onChange={(event) => setRecordName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <p className="mt-2 text-[10px] font-semibold text-gray-400">
              Camera frames stay in the browser until you press Upload clip.
            </p>
          </div>
        </div>
      )}
      {trimAsset && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div
            data-testid="media-trim-modal"
            className="w-full max-w-md rounded-2xl bg-white p-5"
          >
            <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">
              Video trim
            </p>
            <h2 className="text-xl font-black text-gray-950">{trimAsset.name}</h2>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              Keeps {(Number(trimEnd) - Number(trimStart)).toFixed(1)}s of the{" "}
              {(trimAsset.duration_seconds || 0).toFixed(1)}s clip and saves a new asset.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                Start (s)
                <input
                  data-testid="media-trim-start"
                  type="number"
                  min={0}
                  max={trimAsset.duration_seconds || 180}
                  step="0.1"
                  value={trimStart}
                  onChange={(event) => setTrimStart(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold"
                />
              </label>
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                End (s)
                <input
                  data-testid="media-trim-end"
                  type="number"
                  min={0.1}
                  max={trimAsset.duration_seconds || 180}
                  step="0.1"
                  value={trimEnd}
                  onChange={(event) => setTrimEnd(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold"
                />
              </label>
            </div>
            <label className="mt-3 block text-[9px] font-black uppercase tracking-widest text-gray-500">
              New clip name
              <input
                data-testid="media-trim-name"
                value={trimName}
                onChange={(event) => setTrimName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold"
              />
            </label>
            {trimError && (
              <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                {trimError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTrimAsset(null)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="media-trim-submit"
                onClick={() => void submitTrim()}
                disabled={trimBusy}
                className="rounded-lg bg-gray-950 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {trimBusy ? "Trimming..." : "Save trimmed clip"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
