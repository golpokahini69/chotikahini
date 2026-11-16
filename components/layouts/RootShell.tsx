import Script from "next/script";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getSiteConfig } from "@/lib/config";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-defaults";
import { AuthProvider } from "@/contexts/AuthContext";
import { AgeGateShell } from "@/components/AgeGateShell";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { LoginModalPopup } from "@/components/LoginModalPopup";
import { PresenceHeartbeat } from "@/components/PresenceHeartbeat";
import { AuthorPromptToast } from "@/components/AuthorPromptToast";
import { SafeModeToggle } from "@/components/SafeModeToggle";
import { buildExtensionScrubberScript } from "@/lib/extension-scrubber";

/**
 * Latin UI font, self-hosted by next/font at build time (no external
 * request, no layout shift). Deliberately NOT applied to <body> in the
 * Bangla locale — that keeps `font-bengali` in charge of the Bangla UI copy,
 * which is the bulk of this site. Inter is opted into by Latin-only surfaces
 * (video titles, metadata, admin tables) via the `font-latin` utility.
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
      .map(([key, val]) => `--color-${prefix}${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${val};`)
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

/**
 * The document shell for the Bangla public site.
 */
export function RootShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = getSiteConfig();
  const gaId = site.seo?.googleAnalyticsId;
  const gtmId = site.seo?.googleTagManagerId;
  return (
    <html
      lang="bn"
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <ThemeStyles />
        {/* Prevent theme flash — apply dark class before React hydrates */}
        <script
          id="theme-init"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("chittakkho-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.classList.add("dark");}}catch(e){}})();`,
          }}
        />
        {/* Ad-safe document.write guard */}
        <script
          id="doc-write-guard"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var dw=document.write.bind(document);document.write=function(c){try{if(document.readyState==="loading"){dw(c);}}catch(e){}};document.writeln=function(c){try{if(document.readyState==="loading"){dw(c+"\n");}}catch(e){}};}catch(e){}try{window.addEventListener("unhandledrejection",function(e){if(e&&e.reason&&e.reason.message&&e.reason.message.indexOf("M_ID")!==-1){e.preventDefault();e.stopPropagation();}});}catch(e){}})();`,
          }}
        />
        {/*
          Strip the `bis_skin_checked` attributes that browser dark-mode
          "skin" extensions stamp onto every element before React
          hydrates. Leaving them in place causes a hydration attribute
          mismatch that React cannot patch. See lib/extension-scrubber.ts.
        */}
        <script
          id="extension-attribute-scrubber"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: buildExtensionScrubberScript(),
          }}
        />
        {/* Google Search Console verification — direct fallback */}
        {site.seo?.googleSearchConsole && (
          <meta
            name="google-site-verification"
            content={site.seo.googleSearchConsole}
          />
        )}
        {/*
          `og:rating` has to be emitted by hand: Next.js 14's typed
          `openGraph` generator drops keys it does not know about, and its
          `other` map always renders `name=`, never `property=`. Emitting
          it here puts it on every page of the site in one place.

          The value is the site's honest content rating. It used to be
          hardcoded to "general" — a false claim on an explicit-story
          site, and one of the signals Facebook's classifier reads.
        */}
        <meta property="og:rating" content={site.seo?.rating || "adult"} />
      </head>
      <body
        className="flex min-h-screen flex-col font-bengali"
        suppressHydrationWarning
      >
        {/* Google Analytics */}
        {gaId && (
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
        )}

        {/* Google Tag Manager */}
        {gtmId && (
          <Script
            id="google-tag-manager"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                })(window,document,'script','dataLayer','${gtmId}');
              `,
            }}
          />
        )}

        {/* ExoClick Ad Provider for Video Slider and popup ads */}
        <Script
          src="https://a.magsrv.com/ad-provider.js"
          strategy="afterInteractive"
        />

        <ThemeProvider>
          <AuthProvider>
            <PresenceHeartbeat />
            <AgeGateShell />
            <AnnouncementBanner />
            <LoginModalPopup siteTitle={site.title} />
            <AuthorPromptToast />
            <SafeModeToggle />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
