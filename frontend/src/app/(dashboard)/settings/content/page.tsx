"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import MediaPicker from "@/components/media-picker";

type Content = {
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
  hero_image_url: string | null;
  story_title: string;
  story_body: string;
  story_image_url: string | null;
  category_images: Record<string, string>;
  updated_at?: string | null;
  customised?: boolean;
};

const API = getApiUrl("/api/v1/restaurant/storefront-content/");
const CATEGORY_KEYS = [
  "Pizza",
  "Sides",
  "Burgers",
  "Sandwiches",
  "Beverages",
  "Desserts",
];

export default function LandingContentPage() {
  const [content, setContent] = useState<Content | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void (async () => {
      try {
        const response = await fetch(API, { credentials: "include", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Landing content failed to load.");
        setContent(data.content);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Landing content failed to load.");
      }
    })();
  }, []);

  const update = (patch: Partial<Content>) => {
    if (!content) return;
    setContent({ ...content, ...patch });
  };

  const save = async () => {
    if (!content) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(API, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hero_title: content.hero_title,
          hero_highlight: content.hero_highlight,
          hero_subtitle: content.hero_subtitle,
          hero_image_url: content.hero_image_url || null,
          story_title: content.story_title,
          story_body: content.story_body,
          story_image_url: content.story_image_url || null,
          category_images: content.category_images,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Landing content could not be saved.");
      setContent(data.content);
      await fetch("/api/revalidate", { method: "POST", credentials: "include" });
      setMessage("Landing page saved. The storefront is refreshing now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Landing content could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Restore the original landing copy and imagery?")) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}reset`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Reset failed.");
      setContent(data.content);
      await fetch("/api/revalidate", { method: "POST", credentials: "include" });
      setMessage("Original landing content restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!content) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
        {message ? message : <><Loader2 className="h-5 w-5 animate-spin" /> Loading landing content...</>}
      </div>
    );
  }

  return (
    <div
      data-testid="landing-content-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Content · storefront
          </p>
          <h1 className="text-3xl font-black text-gray-950">Landing page</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Change the hero, kitchen story and category imagery without a code deploy.
            Images come from the shared Media Studio.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="landing-reset"
            onClick={() => void reset()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore defaults
          </button>
          <button
            type="button"
            data-testid="landing-save"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save landing page
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Sparkles className="h-4 w-4 text-orange-600" /> Hero
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_0.6fr]">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Headline
                <input
                  data-testid="landing-hero-title"
                  value={content.hero_title}
                  onChange={(event) => update({ hero_title: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Highlight
                <input
                  data-testid="landing-hero-highlight"
                  value={content.hero_highlight}
                  onChange={(event) => update({ hero_highlight: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-amber-700 outline-none focus:border-orange-400"
                />
              </label>
            </div>
            <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-gray-500">
              Subtitle
              <textarea
                data-testid="landing-hero-subtitle"
                value={content.hero_subtitle}
                onChange={(event) => update({ hero_subtitle: event.target.value })}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
              />
            </label>
            <div className="mt-4">
              <MediaPicker
                label="Hero image"
                value={content.hero_image_url || ""}
                onChange={(url) => update({ hero_image_url: url })}
                testId="landing-hero-image"
                helpText="Landscape image works best. Choose from Media Studio or upload."
              />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <ImageIcon className="h-4 w-4 text-orange-600" /> Kitchen story
            </p>
            <label className="mt-4 block text-[10px] font-black uppercase tracking-widest text-gray-500">
              Story headline
              <input
                data-testid="landing-story-title"
                value={content.story_title}
                onChange={(event) => update({ story_title: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
              />
            </label>
            <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-gray-500">
              Story paragraph
              <textarea
                data-testid="landing-story-body"
                value={content.story_body}
                onChange={(event) => update({ story_body: event.target.value })}
                rows={4}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-orange-400"
              />
            </label>
            <div className="mt-4">
              <MediaPicker
                label="Story image"
                value={content.story_image_url || ""}
                onChange={(url) => update({ story_image_url: url })}
                testId="landing-story-image"
                helpText="Kitchen or team photo. Choose from Media Studio or upload."
              />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Category imagery
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              Used by menu highlights when a dish has no photo of its own.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {CATEGORY_KEYS.map((category) => (
                <MediaPicker
                  key={category}
                  label={category}
                  value={content.category_images[category] || ""}
                  onChange={(url) =>
                    update({
                      category_images: { ...content.category_images, [category]: url },
                    })
                  }
                  testId={`landing-category-${category.toLowerCase()}`}
                  helpText=""
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            <div className="relative min-h-[280px] bg-gray-950 p-6 text-white">
              {content.hero_image_url ? (
                <img
                  src={content.hero_image_url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-40"
                />
              ) : null}
              <div className="relative">
                <p className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest">
                  <Sparkles className="h-3 w-3 text-amber-300" /> Fresh dough · fired to order
                </p>
                <h2 className="mt-5 text-3xl font-black leading-tight">
                  {content.hero_title}{" "}
                  <span className="text-amber-300">{content.hero_highlight}</span>
                </h2>
                <p className="mt-3 text-xs font-medium leading-5 text-white/75">
                  {content.hero_subtitle}
                </p>
                <span className="mt-5 inline-flex rounded-lg bg-red-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest">
                  Start your order
                </span>
              </div>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Live hero preview
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                The actual storefront also shows menu, offers, status and reviews.
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            <div className="relative h-44 bg-gray-100">
              {content.story_image_url ? (
                <img
                  src={content.story_image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">
                  The kitchen
                </p>
                <p className="text-sm font-black">{content.story_title}</p>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold leading-5 text-gray-500">
                {content.story_body}
              </p>
              <Link
                href="/"
                target="_blank"
                className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-orange-700"
              >
                Open storefront <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </section>

          <p className="text-[10px] font-semibold text-gray-400">
            {content.updated_at
              ? `Last saved ${new Date(content.updated_at).toLocaleString("en-IN")}`
              : "Using the built-in default content."}
          </p>
        </aside>
      </div>
    </div>
  );
}
