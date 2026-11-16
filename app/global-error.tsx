"use client";

// ─────────────────────────────────────────────────────────────
// Root error boundary — the last line of defence.
//
// Next.js 14 requires a `global-error.tsx` alongside `error.tsx`.
// Without it, any error that escapes the root layout makes the
// server respond with this stub:
//
//   <pre>missing required error components, refreshing...</pre>
//   <script>/* fetch(location.href) → location.reload(), every second */</script>
//
// That script reloads the page forever, so the visitor sees a page
// that never finishes loading — a silent, permanent outage with no
// error message and no way out. This boundary replaces that stub with
// a real screen: the message, a retry button, and the stack in the
// console for debugging.
//
// A global error boundary REPLACES the root layout, so it has to
// render its own <html> and <body>. It also runs when the root
// layout itself failed, which means it must not depend on anything
// the layout provides (theme context, providers, the global
// stylesheet) — hence the plain inline colours below.
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the dev console so the actual stack still helps in
    // debugging, but never let it break the page.
    // (Avoid console.error in production to keep browser tooling clean.)
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[global error boundary]", error);
    }
  }, [error]);

  const looksLikeExtension =
    typeof error?.message === "string" &&
    /(M_ID|chrome-extension|extension context)/i.test(error.message);

  return (
    <html lang="bn">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.5rem",
          background: "#fafafa",
          color: "#18181b",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif",
        }}
      >
        <div style={{ maxWidth: "28rem", width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            কিছু ভুল হয়েছে
          </h1>
          {looksLikeExtension ? (
            <p style={{ fontSize: "0.875rem", color: "#52525b", marginTop: "1rem" }}>
              এই ত্রুটিটি আপনার ব্রাউজারে থাকা একটি এক্সটেনশন (যেমন Grammarly
              অথবা ad-blocker) থেকে আসছে। অ্যাডমিন প্যানেল এক্সটেনশন অফ করে আবার
              চেষ্টা করুন অথবা Incognito Mode-এ লগইন করুন।
            </p>
          ) : (
            <p style={{ fontSize: "0.875rem", color: "#52525b", marginTop: "1rem" }}>
              পেজটি আবার লোড করুন। সমস্যা থাকলে আমাদের জানান।
            </p>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginTop: "1.5rem",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                borderRadius: "0.5rem",
                border: "1px solid #d4d4d8",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              আবার চেষ্টা করুন
            </button>
            <Link
              href="/"
              style={{
                borderRadius: "0.5rem",
                background: "#18181b",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#ffffff",
                textDecoration: "none",
              }}
            >
              হোম পেজে যান
            </Link>
          </div>
          {error?.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "#a1a1aa",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
