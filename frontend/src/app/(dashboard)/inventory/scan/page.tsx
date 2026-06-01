"use client";
import { useState, useRef } from "react";
import { getApiUrl } from "@/lib/api";

export default function ScanBillPage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const handleFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      setCameraActive(true);
    }
  };

  const capturePhoto = () => {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current!.videoWidth;
    canvas.height = videoRef.current!.videoHeight;
    canvas.getContext("2d")!.drawImage(videoRef.current!, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        handleFile(file);
        (videoRef.current!.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        setCameraActive(false);
      }
    }, "image/jpeg");
  };

  const scanBill = async () => {
    if (!fileRef.current?.files?.[0] && !preview) return;
    setLoading(true);
    setError(null);
    const formData = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) formData.append("file", file);
    try {
      const res = await fetch(
        getApiUrl("/api/v1/restaurant/ocr/scan-bill"),
        { method: "POST", body: formData, credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Scan failed.");
      setResult(data);
    } catch (e) {
      setError("Scan failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">📷 Scan Bill / Invoice</h1>
      <div className="flex gap-4 mb-6">
        <button onClick={startCamera}
          className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold">
          Open Camera
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="bg-gray-700 text-white px-4 py-2 rounded-lg font-semibold">
          Upload Photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>
      {cameraActive && (
        <div className="mb-4">
          <video ref={videoRef} autoPlay className="w-full rounded-lg" />
          <button onClick={capturePhoto}
            className="mt-2 bg-green-600 text-white px-4 py-2 rounded-lg w-full">
            Capture Photo
          </button>
        </div>
      )}
      {preview && (
        <div className="mb-4">
          <img src={preview} className="w-full rounded-lg border" alt="Preview" />
          <button onClick={scanBill} disabled={loading}
            className="mt-3 bg-orange-500 text-white px-6 py-3 rounded-lg w-full font-bold text-lg">
            {loading ? "Scanning..." : "🔍 Scan Bill"}
          </button>
        </div>
      )}
      {error && <p className="text-red-500 mt-2">{error}</p>}
      {result && (
        <div className="mt-6 bg-gray-900 rounded-lg p-4">
          <h2 className="text-lg font-bold text-green-400 mb-3">
            ✅ {result.total_items_found} items extracted
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2">Qty</th>
                <th className="text-right py-2">Unit</th>
                <th className="text-right py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {result.extracted_items.map((item: any, i: number) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-2 capitalize">{item.item_name}</td>
                  <td className="text-right py-2">{item.quantity}</td>
                  <td className="text-right py-2">{item.unit}</td>
                  <td className="text-right py-2">₹{item.price_per_unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-green-400 mt-3 text-sm">
            ✅ Inventory updated for: {result.updated_inventory.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
