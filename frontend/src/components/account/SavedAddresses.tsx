"use client";

import { useEffect, useState } from "react";
import { MapPin, Plus, Star, Trash2 } from "lucide-react";

type SavedAddress = {
  id: number;
  label: string;
  address_line: string;
  zone_id?: number | null;
  is_default: boolean;
};

export default function SavedAddresses() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [label, setLabel] = useState("Home");
  const [addressLine, setAddressLine] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    try {
      const response = await fetch("/api/customer-addresses", {
        cache: "no-store",
      });
      if (response.status === 401) {
        setAddresses([]);
        return;
      }
      const data = await response.json().catch(() => []);
      if (response.ok && Array.isArray(data)) setAddresses(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addAddress = async () => {
    if (addressLine.trim().length < 6) {
      setMessage("Enter a complete delivery address.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/customer-addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || "Home",
          address_line: addressLine.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Address could not be saved.");
      setAddressLine("");
      setMessage("Address saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Address could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const makeDefault = async (address: SavedAddress) => {
    const response = await fetch(`/api/customer-addresses/${address.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (response.ok) await load();
  };

  const remove = async (address: SavedAddress) => {
    const response = await fetch(`/api/customer-addresses/${address.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setMessage("Address removed.");
      await load();
    }
  };

  return (
    <section
      data-testid="saved-addresses"
      className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-black text-gray-900">Saved addresses</h2>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Reuse delivery addresses at checkout without typing them again.
      </p>

      {message && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
          {message}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <p className="text-sm font-semibold text-gray-400">Loading addresses...</p>
        ) : addresses.length ? (
          addresses.map((address) => (
            <div
              key={address.id}
              data-testid={`saved-address-${address.id}`}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900">
                  {address.label}
                  {address.is_default ? (
                    <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-orange-700">
                      Default
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-gray-500">
                  {address.address_line}
                </p>
              </div>
              <div className="flex gap-1">
                {!address.is_default && (
                  <button
                    type="button"
                    onClick={() => makeDefault(address)}
                    aria-label={`Make ${address.label} the default address`}
                    className="grid h-10 w-10 place-items-center rounded-lg text-amber-600 hover:bg-amber-50"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(address)}
                  aria-label={`Delete ${address.label} address`}
                  className="grid h-10 w-10 place-items-center rounded-lg text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm font-semibold text-gray-400">
            No saved addresses yet.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-[110px_1fr_auto]">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Label
          <input
            aria-label="Address label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-orange-400"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Address
          <input
            aria-label="Saved address line"
            value={addressLine}
            onChange={(event) => setAddressLine(event.target.value)}
            placeholder="Flat, street, area, city"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
          />
        </label>
        <button
          type="button"
          onClick={addAddress}
          disabled={isSaving}
          className="mt-5 inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-gray-950 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Save
        </button>
      </div>
    </section>
  );
}
