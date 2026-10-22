import { NextResponse } from "next/server";
import {
  CUSTOMER_COOKIE,
  createSessionToken,
  maxAgeForRole,
  verifySessionToken,
} from "@/lib/session";
import { getServerApiUrl } from "@/lib/server-api";

const CUSTOMER_API_COOKIE = "pb_customer_api_token";

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
  response.cookies.set({
    name: CUSTOMER_API_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function setApiTokenCookie(
  response: NextResponse,
  apiToken: string | undefined,
  maxAge: number
) {
  if (!apiToken) return;
  response.cookies.set({
    name: CUSTOMER_API_COOKIE,
    value: apiToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
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
  const otp = String(payload.otp || payload.code || "").trim();
  const proofOrderId = Number(
    String(payload.order_id || payload.orderId || payload.last_order_id || "").trim()
  );
  if (!phone) {
    return NextResponse.json(
      { detail: "Phone number is required." },
      { status: 422 }
    );
  }

  if (otp) {
    const verifyResponse = await fetch(
      getServerApiUrl("/api/v1/auth/customer/otp/verify"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp }),
        cache: "no-store",
      }
    );
    const verified = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok) {
      return NextResponse.json(
        { detail: verified.detail || "That verification code is not valid." },
        { status: verifyResponse.status }
      );
    }

    const verifiedPhone = String(verified.phone || phone);
    const maxAge = maxAgeForRole("customer");
    const token = await createSessionToken(
      {
        role: "customer",
        subject: `customer:${verifiedPhone}`,
        displayName: verified.display_name || "Pizza Guest",
        phone: verifiedPhone,
        email: verified.email || null,
      },
      maxAge
    );
    const response = NextResponse.json({
      ok: true,
      role: "customer",
      customer: {
        phone: verifiedPhone,
        name: verified.display_name || "Pizza Guest",
        email: verified.email || null,
      },
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
    setApiTokenCookie(response, verified.access_token, maxAge);
    return response;
  }

  if (!Number.isInteger(proofOrderId) || proofOrderId <= 0) {
    return NextResponse.json(
      { detail: "Enter the verification code or a recent order ID." },
      { status: 422 }
    );
  }

  const historyResponse = await fetch(
    getServerApiUrl(
      `/api/v1/restaurant/orders/customer-history/${encodeURIComponent(
        phone
      )}?order_id=${proofOrderId}`
    ),
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
  let apiToken = "";
  try {
    const apiLogin = await fetch(getServerApiUrl("/api/v1/auth/customer/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, order_id: proofOrderId }),
      cache: "no-store",
    });
    const apiSession = await apiLogin.json().catch(() => ({}));
    if (apiLogin.ok) apiToken = String(apiSession.access_token || "");
  } catch {
    apiToken = "";
  }
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
  setApiTokenCookie(response, apiToken, maxAge);
  return response;
}
