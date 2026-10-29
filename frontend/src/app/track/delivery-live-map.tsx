"use client";

import dynamic from "next/dynamic";

const LiveMapInner = dynamic(() => import("./delivery-live-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full animate-pulse place-items-center bg-slate-100 text-xs font-black uppercase tracking-widest text-slate-400">
      Loading rider map
    </div>
  ),
});

export type DeliveryLiveMapProps = {
  lat: number;
  lng: number;
  riderName: string;
  updatedLabel?: string;
};

/**
 * A keyless live map for the rider. OpenStreetMap tiles need no account, so
 * tracking works on day one without a Maps contract. The rider marker moves
 * when the dispatch app posts a new location; the transcript page polls and
 * re-renders this component with the latest coordinates.
 */
export default function DeliveryLiveMap({
  lat,
  lng,
  riderName,
  updatedLabel,
}: DeliveryLiveMapProps) {
  return (
    <div
      data-testid="track-live-map"
      className="relative mt-3 h-[280px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner"
    >
      <LiveMapInner
        lat={lat}
        lng={lng}
        riderName={riderName}
        updatedLabel={updatedLabel}
      />
      <span className="pointer-events-none absolute left-3 top-3 z-[500] inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Live rider location
      </span>
    </div>
  );
}
