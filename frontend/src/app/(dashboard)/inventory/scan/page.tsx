"use client";

import { useRef, useState } from "react";
import { AlertCircle, Camera, CheckCircle2, FileText, Loader2, Search, Upload, XCircle } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type ScanResult = {
  total_items_found: number;
  updated_inventory: string[];
  extracted_items: {
    item_name: string;
    quantity: number;
    unit: string;
    price_per_unit: number;
  }[];
};

type ScanStatus = {
  type: "success" | "error" | "loading" | "info";
  text: string;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ScanBillPage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setSelectedFile(null);
      setResult(null);
      setStatus({ type: "error", text: "Upload an image file for bill scanning." });
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setStatus({ type: "info", text: `${file.name} ready for bill scanning.` });
  };

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setStatus({ type: "info", text: "Selected bill photo cleared." });
    if (fileRef.current) fileRef.current.value = "";
  };

  const stopCamera = () => {
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ type: "error", text: "Camera access is not available. Upload a receipt photo instead." });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
        setStatus({ type: "info", text: "Camera is ready. Capture the bill photo when it is clear." });
      }
    } catch {
      setStatus({ type: "error", text: "Camera access is not available. Upload a receipt photo instead." });
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus({ type: "error", text: "Camera capture failed. Try uploading a photo instead." });
        return;
      }
      handleFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      stopCamera();
    }, "image/jpeg");
  };

  const scanBill = async () => {
    if (!selectedFile) {
      setStatus({ type: "error", text: "Choose or capture a bill photo first." });
      return;
    }
    setLoading(true);
    setStatus({ type: "loading", text: `Scanning ${selectedFile.name} and preparing inventory updates...` });
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/ocr/scan-bill"), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || data.message || "Scan failed.");
      setResult(data);
      const itemCount = Number(data.total_items_found || 0);
      const updateCount = Array.isArray(data.updated_inventory) ? data.updated_inventory.length : 0;
      setStatus({
        type: "success",
        text: `Scan complete: ${itemCount} item${itemCount === 1 ? "" : "s"} extracted, ${updateCount} inventory record${updateCount === 1 ? "" : "s"} updated.`,
      });
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "Scan failed. Please try again.";
      setStatus({ type: "error", text: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="inventory-scan-page" className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Camera className="h-6 w-6 text-orange-500" />
        Scan Bill / Invoice
      </h1>

      <div className="mb-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={startCamera}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
          Open Camera
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          Upload Photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Upload bill photo"
          className="hidden"
          onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
        />
      </div>

      {selectedFile ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-100 bg-orange-50 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-orange-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900">{selectedFile.name}</p>
              <p className="text-xs font-semibold text-gray-500">{formatBytes(selectedFile.size)} selected</p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearFile}
            disabled={loading}
            aria-label="Clear selected bill photo"
            className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            Clear
          </button>
        </div>
      ) : null}

      {cameraActive ? (
        <div className="mb-4">
          <video ref={videoRef} autoPlay className="w-full rounded-lg" />
          <button
            type="button"
            onClick={capturePhoto}
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-green-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Capture Photo
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mb-4">
          <img src={preview} className="w-full rounded-lg border" alt={`${selectedFile?.name || "Receipt"} preview`} />
          <button
            type="button"
            onClick={scanBill}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-6 py-3 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            {loading ? "Scanning..." : "Scan Bill"}
          </button>
        </div>
      ) : null}

      {status ? (
        <div
          role={status.type === "error" ? "alert" : "status"}
          className={`mt-2 flex items-center gap-2 rounded-lg border p-3 text-sm font-bold ${
            status.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : status.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : status.type === "loading"
                  ? "border-orange-200 bg-orange-50 text-orange-700"
                  : "border-gray-200 bg-gray-50 text-gray-600"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : status.type === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : status.type === "loading" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 shrink-0" />
          )}
          <span>{status.text}</span>
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 rounded-lg bg-gray-900 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            {result.total_items_found} items extracted
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 text-left">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit</th>
                <th className="py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {result.extracted_items.map((item, index) => (
                <tr key={`${item.item_name}-${index}`} className="border-b border-gray-800">
                  <td className="py-2 capitalize">{item.item_name}</td>
                  <td className="py-2 text-right">{item.quantity}</td>
                  <td className="py-2 text-right">{item.unit}</td>
                  <td className="py-2 text-right">Rs {item.price_per_unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Inventory updated for: {result.updated_inventory.join(", ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
