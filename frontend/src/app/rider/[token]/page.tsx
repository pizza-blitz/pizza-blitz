"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  ChefHat,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const LOCATION_PUSH_INTERVAL_MS = 20000;

type RiderPayload = {
  assignment_id: number;
  status: string;
  assigned_to?: string | null;
  rider_phone?: string | null;
  order: {
    id: number;
    status: string;
    total_amount: number;
    payment_method?: string | null;
    payment_status?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    delivery_address?: string | null;
    delivery_zone?: string | null;
    items: {
      name: string;
      quantity: number;
      selected_options?: { group_name?: string; option_name?: string }[];
    }[];
  };
  location?: { lat: number; lng: number; updated_at?: string | null } | null;
  proof?: {
    type: string;
    reference: string;
    notes?: string | null;
    captured_at?: string | null;
  } | null;
  allowed_actions: string[];
};

export default function RiderPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [rider, setRider] = useState<RiderPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [proofType, setProofType] = useState("photo");
  const [proofReference, setProofReference] = useState("");
  const [proofNotes, setProofNotes] = useState("");
  const [failureNotes, setFailureNotes] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [autoSharing, setAutoSharing] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  const latestPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const sendingLocationRef = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/delivery/rider/${token}`),
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Rider link is not valid.");
      setRider(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rider link is not valid.");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (rider?.rider_phone) setContactPhone(rider.rider_phone);
  }, [rider?.rider_phone]);

  const haltAutoSharing = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    if (pushTimerRef.current != null) {
      window.clearInterval(pushTimerRef.current);
    }
    pushTimerRef.current = null;
    setAutoSharing(false);
  }, []);

  // Stop streaming as soon as the handoff is no longer live, and on unmount.
  useEffect(() => {
    if (rider && rider.status !== "out_for_delivery") haltAutoSharing();
  }, [rider?.status, haltAutoSharing, rider]);

  useEffect(() => () => haltAutoSharing(), [haltAutoSharing]);

  const pushLocation = useCallback(
    async (coords: { lat: number; lng: number }) => {
      if (!token || sendingLocationRef.current) return;
      sendingLocationRef.current = true;
      try {
        const response = await fetch(
          getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/location`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(coords),
          }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Location could not be shared.");
        }
        setRider((current) =>
          current ? { ...current, location: data.location } : current
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Location could not be shared."
        );
      } finally {
        sendingLocationRef.current = false;
      }
    },
    [token]
  );

  const startAutoSharing = useCallback(() => {
    if (!navigator.geolocation) {
      setMessage("Location is not available on this device.");
      return;
    }
    if (watchIdRef.current != null) return;
    setMessage("Allow location access. Keep this page open while you ride.");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        latestPositionRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        void pushLocation(latestPositionRef.current);
      },
      () => {
        haltAutoSharing();
        setMessage("Allow location access to share your live position.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    // The watch only fires when the device moves; this keeps the pin fresh
    // while the rider is waiting at a signal or a door.
    pushTimerRef.current = window.setInterval(() => {
      if (latestPositionRef.current) void pushLocation(latestPositionRef.current);
    }, LOCATION_PUSH_INTERVAL_MS);
    setAutoSharing(true);
    setMessage("");
  }, [haltAutoSharing, pushLocation]);

  const saveContact = async () => {
    if (!token) return;
    const digits = contactPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      setMessage("Enter a call-back number with 10 to 15 digits.");
      return;
    }
    setBusy("contact");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/contact`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: contactPhone }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Call-back number could not be saved.");
      }
      setRider(data);
      setMessage("Call-back number saved. The customer can call you during this delivery.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Call-back number could not be saved."
      );
    } finally {
      setBusy(null);
    }
  };

  const updateStatus = async (status: string, notes?: string) => {
    if (!token) return;
    setBusy(status);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/status`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, notes: notes || null }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Status could not be updated.");
      setRider(data);
      setMessage(status === "delivered" ? "Delivery completed." : "");
      setFailureNotes("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  const collectCash = async () => {
    if (!token) return;
    setBusy("cash");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/cash-collected`),
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Cash could not be recorded.");
      setRider(data);
      setMessage("Cash collected. The store sees this order as paid.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cash could not be recorded."
      );
    } finally {
      setBusy(null);
    }
  };

  const shareLocation = () => {    if (!token || !navigator.geolocation) {
      setMessage("Location is not available on this device.");
      return;
    }
    setBusy("location");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch(
            getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/location`),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              }),
            }
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || "Location could not be shared.");
          setRider(data);
          setMessage("Live location shared with the store and customer.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Location could not be shared.");
        } finally {
          setBusy(null);
        }
      },
      () => {
        setMessage("Allow location access to share your live position.");
        setBusy(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const captureProof = async () => {
    if (!token) return;
    if (proofReference.trim().length < 3) {
      setMessage("Add a proof reference (photo id, signature name, or OTP).");
      return;
    }
    setBusy("proof");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/delivery/rider/${token}/proof`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proof_type: proofType,
            reference: proofReference.trim(),
            notes: proofNotes.trim() || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Proof could not be saved.");
      setRider(data);
      setMessage("Proof of delivery captured. You can mark it delivered.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading delivery...
      </div>
    );
  }

  if (!rider) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div>
          <ShieldCheck className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="mt-3 text-xl font-black">Rider link unavailable</h1>
          <p className="mt-2 text-sm text-gray-400">{message || "This link is not valid."}</p>
        </div>
      </div>
    );
  }

  const order = rider.order;
  const timestamp = rider.location?.updated_at
    ? new Date(`${rider.location.updated_at}Z`).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const mapHref =
    rider.location?.lat != null && rider.location?.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${rider.location.lat},${rider.location.lng}`
      : order.delivery_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            order.delivery_address
          )}`
        : "";

  return (
    <main data-testid="rider-page" className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-black/50 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-black">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">
                Pizza Blitz Rider
              </p>
              <h1 className="text-lg font-black">Order #{order.id}</h1>
            </div>
          </div>
          <span
            data-testid="rider-status"
            className="rounded-full bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-orange-200"
          >
            {rider.status.replace(/_/g, " ")}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {message && (
          <div className="rounded-xl border border-orange-400/30 bg-orange-500/10 px-4 py-3 text-sm font-bold text-orange-100">
            {message}
          </div>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Deliver to
          </p>
          <p className="mt-2 flex items-start gap-2 text-lg font-black">
            <MapPin className="mt-1 h-5 w-5 shrink-0 text-orange-400" />
            {order.delivery_address || "Address on file"}
          </p>
          <p className="mt-1 text-xs font-semibold text-gray-400">
            {order.delivery_zone || "Delivery zone"} · {order.customer_name || "Customer"}
          </p>
          {order.customer_phone && (
            <a
              href={`tel:${order.customer_phone}`}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white"
            >
              <Phone className="h-4 w-4" /> {order.customer_phone}
            </a>
          )}
          {mapHref && (
            <a
              href={mapHref}
              target="_blank"
              rel="noreferrer"
              className="ml-2 mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white"
            >
              <Navigation className="h-4 w-4" /> Navigate
            </a>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Collect
            </p>
            <p className="text-xl font-black text-orange-300">
              Rs {Math.round(Number(order.total_amount || 0)).toLocaleString()}
            </p>
          </div>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-gray-400">
            {order.payment_method || "cash"} · {order.payment_status || "pending"}
          </p>
          {(order.payment_method || "cash").toLowerCase() === "cash" &&
            (order.payment_status || "").toLowerCase() !== "paid" &&
            (rider.status === "out_for_delivery" || rider.status === "delivered") && (
              <button
                type="button"
                data-testid="rider-cash-collected"
                onClick={() => void collectCash()}
                disabled={busy === "cash"}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-3 text-xs font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {busy === "cash" ? "Recording" : "Cash collected from customer"}
              </button>
            )}
          <ul className="mt-3 space-y-2 border-t border-white/10 pt-3">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                <span className="font-bold">
                  {item.quantity} × {item.name}
                  {item.selected_options?.length ? (
                    <span className="ml-2 text-xs font-semibold text-gray-400">
                      {item.selected_options
                        .map((option) =>
                          [option.group_name, option.option_name].filter(Boolean).join(": ")
                        )
                        .join(" | ")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Live location
            </p>
            <span className="text-xs font-semibold text-gray-400">
              {timestamp ? `Updated ${timestamp}` : "Not shared yet"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="rider-location"
              onClick={shareLocation}
              disabled={busy === "location"}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-black disabled:opacity-50"
            >
              <Navigation className="h-4 w-4" />
              {busy === "location" ? "Sharing" : "Share once"}
            </button>
            {rider.status === "out_for_delivery" && (
              <button
                type="button"
                data-testid="rider-auto-location"
                onClick={autoSharing ? haltAutoSharing : startAutoSharing}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black uppercase tracking-widest ${
                  autoSharing
                    ? "bg-emerald-500 text-black"
                    : "bg-white/10 text-white"
                }`}
              >
                <span className="relative flex h-2 w-2">
                  {autoSharing && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black/40" />
                  )}
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      autoSharing ? "bg-black" : "bg-emerald-400"
                    }`}
                  />
                </span>
                {autoSharing ? "Live · stop sharing" : "Go live (auto)"}
              </button>
            )}
          </div>
          {autoSharing && (
            <p
              data-testid="rider-live-badge"
              className="mt-2 text-[11px] font-bold uppercase tracking-widest text-emerald-300"
            >
              Live · sending every {LOCATION_PUSH_INTERVAL_MS / 1000}s · keep this
              page open
            </p>
          )}

          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Call-back number
            </p>
            <p className="mt-1 text-[11px] font-semibold text-gray-400">
              Shared with this customer only while you are delivering.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                data-testid="rider-phone"
                aria-label="Call-back number"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="Your mobile number"
                inputMode="tel"
                autoComplete="tel"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-gray-500"
              />
              <button
                type="button"
                data-testid="rider-phone-save"
                onClick={() => void saveContact()}
                disabled={busy === "contact"}
                className="rounded-lg bg-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy === "contact" ? "Saving" : "Save"}
              </button>
            </div>
          </div>
        </section>

        {rider.status === "assigned" && (
          <button
            type="button"
            data-testid="rider-start"
            onClick={() => void updateStatus("out_for_delivery")}
            disabled={busy === "out_for_delivery"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-4 text-sm font-black uppercase tracking-widest text-black disabled:opacity-50"
          >
            <ChefHat className="h-5 w-5" /> Start delivery
          </button>
        )}

        {rider.status === "out_for_delivery" && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Proof of delivery
            </p>
            {rider.proof ? (
              <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-200">
                {rider.proof.type.toUpperCase()} · {rider.proof.reference}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    data-testid="rider-proof-type"
                    aria-label="Proof type"
                    value={proofType}
                    onChange={(event) => setProofType(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-bold text-white"
                  >
                    <option value="photo">Photo</option>
                    <option value="signature">Signature</option>
                    <option value="otp">OTP</option>
                  </select>
                  <input
                    data-testid="rider-proof-reference"
                    aria-label="Proof reference"
                    value={proofReference}
                    onChange={(event) => setProofReference(event.target.value)}
                    placeholder="Photo id / name / OTP"
                    className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-gray-500"
                  />
                </div>
                <input
                  aria-label="Proof notes"
                  value={proofNotes}
                  onChange={(event) => setProofNotes(event.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-gray-500"
                />
                <button
                  type="button"
                  data-testid="rider-proof-submit"
                  onClick={captureProof}
                  disabled={busy === "proof"}
                  className="w-full rounded-lg bg-white/10 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  {busy === "proof" ? "Saving" : "Save proof"}
                </button>
              </div>
            )}

            {rider.proof && (
              <button
                type="button"
                data-testid="rider-deliver"
                onClick={() => void updateStatus("delivered")}
                disabled={busy === "delivered"}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-4 text-sm font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                <CheckCircle2 className="h-5 w-5" /> Mark delivered
              </button>
            )}

            <div className="mt-4 border-t border-white/10 pt-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Report a problem
                <input
                  aria-label="Failure notes"
                  value={failureNotes}
                  onChange={(event) => setFailureNotes(event.target.value)}
                  placeholder="Customer unreachable, wrong address..."
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-gray-500"
                />
              </label>
              <button
                type="button"
                data-testid="rider-fail"
                onClick={() => void updateStatus("failed", failureNotes)}
                disabled={busy === "failed"}
                className="mt-2 w-full rounded-lg border border-red-400/30 py-2.5 text-xs font-black uppercase tracking-widest text-red-200 disabled:opacity-50"
              >
                Mark failed
              </button>
            </div>
          </section>
        )}

        {rider.status === "delivered" && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
            <p className="mt-2 text-lg font-black text-emerald-200">Delivered</p>
            <p className="text-xs font-semibold text-emerald-200/80">
              {(order.payment_status || "").toLowerCase() === "paid"
                ? "Proof captured and payment settled. The store can close the order."
                : "Proof captured. The store will close the order after payment."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
