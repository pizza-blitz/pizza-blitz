"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

export type DispatchRider = {
  orderId: number;
  name: string;
  status: string;
  phone?: string | null;
  lat: number;
  lng: number;
  updatedLabel: string;
  stale: boolean;
};

const liveIcon = L.divIcon({
  className: "dispatch-rider-marker",
  html: '<span class="dispatch-rider-dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const staleIcon = L.divIcon({
  className: "dispatch-rider-marker dispatch-rider-marker-stale",
  html: '<span class="dispatch-rider-dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function FitRiders({ riders }: { riders: DispatchRider[] }) {
  const map = useMap();
  // Only refit when the cast of riders changes. Coordinates move every few
  // seconds, and refitting on each fix would drag the dispatcher's view away
  // from whichever rider they are watching.
  const key = riders
    .map((rider) => rider.orderId)
    .sort((a, b) => a - b)
    .join(",");
  const ridersRef = useRef(riders);
  ridersRef.current = riders;

  useEffect(() => {
    const current = ridersRef.current;
    if (!current.length) return;
    if (current.length === 1) {
      map.setView([current[0].lat, current[0].lng], 14, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(
      current.map((rider) => [rider.lat, rider.lng] as [number, number])
    );
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
  }, [key, map]);

  return null;
}

export default function DispatchLiveMapInner({ riders }: { riders: DispatchRider[] }) {
  const first = riders[0];
  return (
    <MapContainer
      center={[first.lat, first.lng]}
      zoom={14}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {riders.map((rider) => (
        <Marker
          key={rider.orderId}
          position={[rider.lat, rider.lng]}
          icon={rider.stale ? staleIcon : liveIcon}
        >
          <Popup>
            <span className="text-xs font-black">{rider.name}</span>
            <span className="block text-[11px] text-slate-600">
              Order #{rider.orderId} · {statusLabel(rider.status)}
            </span>
            <span className="block text-[11px] text-slate-500">{rider.updatedLabel}</span>
          </Popup>
        </Marker>
      ))}
      <FitRiders riders={riders} />
    </MapContainer>
  );
}
