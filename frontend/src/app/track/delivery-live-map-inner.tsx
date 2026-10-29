"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

const riderIcon = L.divIcon({
  className: "blaze-rider-marker",
  html: '<span class="blaze-rider-ping"><span class="blaze-rider-core"></span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function FollowRider({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    const target = L.latLng(lat, lng);
    // Only recentre when the rider actually leaves the visible area, so a
    // customer zooming around is not yanked back every refresh.
    if (!map.getBounds().pad(-0.2).contains(target)) {
      map.setView(target, Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [lat, lng, map]);
  return null;
}

export default function DeliveryLiveMapInner({
  lat,
  lng,
  riderName,
  updatedLabel,
}: {
  lat: number;
  lng: number;
  riderName: string;
  updatedLabel?: string;
}) {
  const position = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  return (
    <MapContainer
      center={position}
      zoom={15}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={position} icon={riderIcon}>
        <Popup>
          <span className="text-xs font-black">{riderName}</span>
          {updatedLabel ? (
            <span className="block text-[11px] text-slate-500">{updatedLabel}</span>
          ) : null}
        </Popup>
      </Marker>
      <FollowRider lat={lat} lng={lng} />
    </MapContainer>
  );
}
