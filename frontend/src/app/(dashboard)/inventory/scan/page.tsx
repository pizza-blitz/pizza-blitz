"use client";

import { useRef, useState } from "react";
import { Camera, CheckCircle2, Search, Upload } from "lucide-react";
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

export default function ScanBillPage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const handleFile = (file: File) => {
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const stopCamera = () => {
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
        setError(null);
      }
    } catch {
      setError("Camera access is not available. Upload a receipt photo instead.");
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
        setError("Camera capture failed. Try uploading a photo instead.");
        return;
      }
      handleFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      stopCamera();
    }, "image/jpeg");
  };

  const scanBill = async () => {
    if (!selectedFile) {
      setError("Choose or capture a bill photo first.");
      return;
    }
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/ocr/scan-bill"), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Scan failed.");
      setResult(data);
    } catch {
      setError("Scan failed. Please try again.");
    }
    setLoading(false);
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
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white"
        >
          <Camera className="h-4 w-4" />
          Open Camera
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 font-semibold text-white"
        >
          <Upload className="h-4 w-4" />
          Upload Photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
        />
      </div>

      {cameraActive ? (
        <div className="mb-4">
          <video ref={videoRef} autoPlay className="w-full rounded-lg" />
          <button
            type="button"
            onClick={capturePhoto}
            className="mt-2 w-full rounded-lg bg-green-600 px-4 py-2 text-white"
          >
            Capture Photo
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mb-4">
          <img src={preview} className="w-full rounded-lg border" alt="Receipt preview" />
          <button
            type="button"
            onClick={scanBill}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-6 py-3 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className="h-5 w-5" />
            {loading ? "Scanning..." : "Scan Bill"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-red-500">{error}</p> : null}

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
