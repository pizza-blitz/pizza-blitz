import { NextResponse } from "next/server";
import { getServerApiUrl } from "@/lib/server-api";

const CUSTOMER_API_COOKIE = "pb_customer_api_token";

function apiToken(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_API_COOKIE}=`));
  return cookie
    ? decodeURIComponent(cookie.split("=").slice(1).join("="))
    : "";
}

async function forward(request: Request, method: string, body?: unknown) {
  const token = apiToken(request);
  if (!token) {
    return NextResponse.json(
      { detail: "Sign in to manage saved addresses." },
      { status: 401 }
    );
  }
  const response = await fetch(
    getServerApiUrl("/api/v1/restaurant/customers/me/addresses"),
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }
  );
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return forward(request, "POST", body);
}
