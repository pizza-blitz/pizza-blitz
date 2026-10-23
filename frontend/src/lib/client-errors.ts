import { getApiUrl } from "@/lib/api";

type ClientErrorInput = {
  message: string;
  stack?: string;
  url?: string;
};

export async function reportClientError(
  error: unknown,
  fallbackMessage = "Unexpected client error"
) {
  if (typeof window === "undefined") return;
  const input: ClientErrorInput = {
    message:
      error instanceof Error
        ? error.message
        : String(error || fallbackMessage),
    stack: error instanceof Error ? error.stack : undefined,
    url: window.location.href,
  };
  try {
    await fetch(getApiUrl("/api/v1/restaurant/ops/client-errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message.slice(0, 500),
        stack: (input.stack || "").slice(0, 5000),
        url: input.url?.slice(0, 500),
        user_agent: navigator.userAgent.slice(0, 500),
      }),
      keepalive: true,
    });
  } catch {
    // Monitoring must never throw inside an error boundary.
  }
}
