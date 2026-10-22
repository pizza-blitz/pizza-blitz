import { NextResponse } from "next/server";
import { getServerApiUrl } from "@/lib/server-api";

const CUSTOMER_API_COOKIE = "pb_customer_api_token";

export async function GET(request: Request) {
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
      { detail: "Sign in to see your loyalty points." },
      { status: 401 }
    );
  }
  const response = await fetch(
    getServerApiUrl("/api/v1/restaurant/customers/me/loyalty"),
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
