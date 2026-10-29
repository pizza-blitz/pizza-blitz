import { NextResponse } from "next/server";

import { CUSTOMER_COOKIE, verifySessionToken } from "@/lib/session";
import { getServerApiUrl } from "@/lib/server-api";

const CHAT_URL = getServerApiUrl("/api/v1/restaurant/assistant/chat");
const MEMORY_URL = getServerApiUrl("/api/v1/restaurant/assistant/memory");

export const dynamic = "force-dynamic";
export const maxDuration = 25;

function emptyMemory() {
  return {
    known: false,
    display_name: null,
    allergies: [],
    dietary_preferences: [],
    usual_fulfillment: null,
    last_order_summary: null,
  };
}

function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.Cookie = cookie;
  // Keep the backend rate limiter keyed on the visitor rather than on this
  // server. Vercel sets the header; locally the backend falls back to the
  // socket address.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) headers["x-forwarded-for"] = forwarded;
  return headers;
}

async function relay(
  request: Request,
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: string
) {
  const response = await fetch(url, {
    method,
    headers: forwardedHeaders(request),
    body,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

/** The concierge's memory, readable only through the signed customer cookie. */
export async function GET(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_COOKIE}=`));
  const token = cookie
    ? decodeURIComponent(cookie.split("=").slice(1).join("="))
    : undefined;
  const session = await verifySessionToken(token, "customer");
  if (!session) {
    return NextResponse.json({ linked: false, memory: emptyMemory() });
  }
  try {
    const response = await fetch(MEMORY_URL, {
      headers: forwardedHeaders(request),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ linked: false, memory: emptyMemory() });
    }
    const data = await response.json();
    return NextResponse.json({
      linked: true,
      phone: data.phone,
      memory: data.memory || emptyMemory(),
    });
  } catch {
    return NextResponse.json({ linked: false, memory: emptyMemory() });
  }
}

/** Chat, with the customer cookie attached so the backend can recall memory. */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    return await relay(request, CHAT_URL, "POST", body);
  } catch {
    return NextResponse.json(
      { detail: "The kitchen connection is unavailable right now." },
      { status: 503 }
    );
  }
}

export async function PUT(request: Request) {
  const body = await request.text();
  try {
    return await relay(request, MEMORY_URL, "PUT", body);
  } catch {
    return NextResponse.json(
      { detail: "Saved preferences are unavailable right now." },
      { status: 503 }
    );
  }
}

/** Withdrawing consent deletes the stored row on the backend. */
export async function DELETE(request: Request) {
  try {
    return await relay(request, MEMORY_URL, "DELETE");
  } catch {
    return NextResponse.json(
      { detail: "Saved preferences are unavailable right now." },
      { status: 503 }
    );
  }
}
