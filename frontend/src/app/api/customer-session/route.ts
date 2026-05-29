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

export async function GET(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_COOKIE}=`));
  const token = cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : undefined;
  const session = await verifySessionToken(token, "customer");
  if (!session) {
    return clearCustomerSession();
  }
  return NextResponse.json({ session });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const phone = String(payload.phone || "").trim();
  const proofOrderId = Number(
    String(payload.order_id || payload.orderId || payload.last_order_id || "").trim()
  );
  if (!phone) {
    return NextResponse.json(
      { detail: "Phone number is required." },
      { status: 422 }
    );
  }
  if (!Number.isInteger(proofOrderId) || proofOrderId <= 0) {
    return NextResponse.json(
      { detail: "Recent order ID is required to open customer order history." },
      { status: 422 }
    );
  }

  const historyResponse = await fetch(
    getServerApiUrl(`/api/v1/restaurant/orders/customer-history/${encodeURIComponent(phone)}`),
    { cache: "no-store" }
  );
  const history = await historyResponse.json().catch(() => ({}));
  if (!historyResponse.ok) {
    return NextResponse.json(
      { detail: history.detail || "No customer profile found for this phone number." },
      { status: historyResponse.status }
    );
  }

  const matchedOrder = Array.isArray(history.orders)
    ? history.orders.find((order: { id?: number }) => Number(order.id) === proofOrderId)
    : null;
  if (!matchedOrder) {
    return NextResponse.json(
      { detail: "Phone number and recent order ID do not match." },
      { status: 401 }
    );
  }

  const customer = history.customer || {};
  const maxAge = maxAgeForRole("customer");
  const token = await createSessionToken(
    {
      role: "customer",
      subject: `customer:${customer.phone || phone}`,
      displayName: customer.name || payload.name || "Pizza Guest",
      phone: customer.phone || phone,
      email: customer.email || payload.email || null,
    },
    maxAge
  );
  const response = NextResponse.json({
    ok: true,
    role: "customer",
    customer,
  });
  response.cookies.set({
    name: CUSTOMER_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}
