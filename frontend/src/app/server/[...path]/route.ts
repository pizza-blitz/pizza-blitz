import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function getBackendBaseUrl() {
  const configured =
    process.env.PIZZA_BLITZ_BACKEND_URL ??
    process.env.BACKEND_URL ??
    process.env.INTERNAL_API_URL;

  if (configured && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/$/, "");
  }

  return "http://127.0.0.1:8010";
}

function getTargetUrl(request: NextRequest) {
  const backendPath = request.nextUrl.pathname.replace(/^\/server/, "") || "/";
  const target = new URL(backendPath, getBackendBaseUrl());
  target.search = request.nextUrl.search;
  return target;
}

function copyRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

function copyResponseHeaders(response: Response) {
  const headers = new Headers(response.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

async function proxyRequest(request: NextRequest) {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const backendResponse = await fetch(getTargetUrl(request), {
    method,
    headers: copyRequestHeaders(request),
    body,
    cache: "no-store",
    redirect: "follow",
  });

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: copyResponseHeaders(backendResponse),
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
