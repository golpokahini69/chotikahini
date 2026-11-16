import Script from "next/script";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { getSiteConfig } from "@/lib/config";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-defaults";
import { buildExtensionScrubberScript } from "@/lib/extension-scrubber";

/**
 * The document shell for the admin panel.
 *
 * WHY THIS EXISTS:
 *   The admin routes live at `/admin/*`, which is a real path segment — not
 *   a route group. Next.js therefore has no root layout to inherit from
 *   there, and every layout in the tree MUST render `<html>` and `<body>`
 *   itself. The admin layout used to rely on the old `app/layout.tsx` for
 *   that; when the root layout was split into `app/(bn)/layout.tsx` and
 *   `app/(bn)/layout.tsx`, the admin segment was left with no document shell
 *   and Next.js started failing with "Missing required html tags".
 *
 * WHY IT ISN'T `RootShell`:
 *   The public shell carries site chrome that does not belong in the
 *   admin panel — the age gate, the announcement banner, the login popup,
 *   the presence heartbeat and the safe-mode toggle. The admin panel is
 *   already gated by its own server-side auth check, and the public chrome
 *   would sit on top of it.
 *
 *   What the admin DOES need is `ThemeProvider` (so `bg-surface`,
 *   `text-fg` and the dark-mode class work) and `AuthProvider` (every admin
 *   page calls `useAuth()`), plus the same theme-variable injection and the
 *   same dark-mode flash guard, so the admin never flashes white before
 *   hydrating.
 */

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-latin",
});

function ThemeStyles() {
  const site = getSiteConfig();
  const themeColors = site.themeColors || (DEFAULT_SITE_CONFIG as any).themeColors;
  const { light, dark } = themeColors;

  const cssVar = (prefix: string, map: Record<string, string>) =>
    Object.entries(map)
      .map(
        ([key, val]) =>
          `--color-${prefix}${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${val};`,
      )
      .join("\n    ");

  return (
    <style>{`
      :root {
        ${cssVar("", {
          surface: light.surface,
          "surface-alt": light.surfaceAlt,
          "surface-hover": light.surfaceHover,
          border: light.border,
          fg: light.fg,
          "fg-muted": light.fgMuted,
          "fg-subtle": light.fgSubtle,
          accent: light.accent,
          "accent-hover": light.accentHover,
        })}
        --color-prose-bg: ${light.surface};
        --scrollbar: ${light.border};
        --scrollbar-hover: ${light.fgSubtle};
      }
      .dark {
        ${cssVar("", {
          surface: dark.surface,
          "surface-alt": dark.surfaceAlt,
          "surface-hover": dark.surfaceHover,
          border: dark.border,
          fg: dark.fg,
          "fg-muted": dark.fgMuted,
          "fg-subtle": dark.fgSubtle,
          accent: dark.accent,
          "accent-hover": dark.accentHover,
        })}
        --color-prose-bg: ${dark.surface};
        --scrollbar: ${dark.border};
        --scrollbar-hover: ${dark.fgSubtle};
      }
    `}</style>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const site = getSiteConfig();
  const gaId = site.seo?.googleAnalyticsId;
  const gtmId = site.seo?.googleTagManagerId;

  return (
    <html lang="bn" className={inter.variable} suppressHydrationWarning>
      <head>
        <ThemeStyles />
        {/* Apply the saved theme before React hydrates, so the admin panel
            never flashes a white background on a dark-mode device. */}
        <script
          id="theme-init"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("chittakkho-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))){document.documentElement.classList.add("dark");}}catch(e){}})();`,
          }}
        />
        {/* Strip the `bis_skin_checked` attributes that browser dark-mode
            "skin" extensions stamp onto every element before React
            hydrates. Leaving them in place causes a hydration attribute
            mismatch that React cannot patch. See lib/extension-scrubber.ts. */}
        <script
          id="extension-attribute-scrubber"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: buildExtensionScrubberScript(),
          }}
        />
      </head>
      <body
        className="min-h-screen bg-surface font-latin text-fg antialiased"
        suppressHydrationWarning
      >
        {gaId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script
              id="google-analytics"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${gaId}');
                `,
              }}
            />
          </>
        ) : null}

        {gtmId ? (
          <Script
            id="google-tag-manager"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,s,'dataLayer',${gtmId});`,
            }}
          />
        ) : null}

        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
