import { NextResponse } from "next/server";
import { getServerApiUrl } from "@/lib/server-api";

const CUSTOMER_API_COOKIE = "pb_customer_api_token";

export async function POST(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_API_COOKIE}=`));
  const token = cookie
    ? decodeURIComponent(cookie.split("=").slice(1).join("="))
    : "";
  if (!token) {
    return NextResponse.json(
      { detail: "Sign in to redeem points." },
      { status: 401 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const response = await fetch(
    getServerApiUrl("/api/v1/restaurant/customers/me/loyalty/redemptions"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
