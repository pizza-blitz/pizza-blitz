import { NextResponse } from "next/server";
import {
  CUSTOMER_COOKIE,
  createSessionToken,
  maxAgeForRole,
  verifySessionToken,
} from "@/lib/session";
import { getServerApiUrl } from "@/lib/server-api";

function clearCustomerSession(status = 401) {
  const response = NextResponse.json(
    { detail: "Customer session is required." },
    { status }
  );
  response.cookies.set({
    name: CUSTOMER_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function customerToken(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : undefined;
}

export async function PATCH(request: Request) {
  const token = customerToken(request);
  const session = await verifySessionToken(token, "customer");
  if (!session || !token) {
    return clearCustomerSession();
  }

  const payload = await request.json().catch(() => ({}));
  const response = await fetch(getServerApiUrl("/api/v1/restaurant/customers/profile"), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      opt_in_marketing:
        typeof payload.opt_in_marketing === "boolean" ? payload.opt_in_marketing : undefined,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { detail: data.detail || "Could not update customer profile." },
      { status: response.status }
    );
  }

  const maxAge = maxAgeForRole("customer");
  const refreshedToken = await createSessionToken(
    {
      role: "customer",
      subject: `customer:${data.phone || session.phone}`,
      displayName: data.name || session.displayName || "Pizza Guest",
      phone: data.phone || session.phone,
      email: data.email || null,
    },
    maxAge
  );
  const nextResponse = NextResponse.json({ customer: data });
  nextResponse.cookies.set({
    name: CUSTOMER_COOKIE,
    value: refreshedToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return nextResponse;
}
