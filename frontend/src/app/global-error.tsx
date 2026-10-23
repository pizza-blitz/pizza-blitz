"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(error, "Global application error");
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0b",
          color: "#fff",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <p
            style={{
              color: "#fb923c",
              fontWeight: 900,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            Pizza Blitz
          </p>
          <h1 style={{ fontSize: 28, margin: "12px 0 8px" }}>
            The app hit an unexpected error
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6 }}>
            The team has been notified with a reference. Try reloading, or come
            back in a moment.
          </p>
          {error.digest && (
            <p
              style={{
                color: "#71717a",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "12px 20px",
              borderRadius: 10,
              border: 0,
              background: "#f97316",
              color: "#000",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Reload the app
          </button>
        </div>
      </body>
    </html>
  );
}
