/** @type {import('next').NextConfig} */
const csp = [
  `default-src 'self' https:`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https: https://a.magsrv.com https://s.magsrv.com https://syndication.exoclick.com https://*.magsrv.com https://*.highperformanceformat.com https://*.highrevenueformat.com https://pl30572939.effectivecpmnetwork.com https://pl30572938.effectivecpmnetwork.com https://www.effectivecpmnetwork.com`,
  `style-src 'self' 'unsafe-inline' https:`,
  `img-src 'self' https: data: blob:`,
  `font-src 'self' https: data:`,
  `connect-src 'self' https: wss:`,
  `frame-src 'self' https: https://a.magsrv.com https://s.magsrv.com https://syndication.exoclick.com https://*.magsrv.com https://*.highperformanceformat.com https://*.highrevenueformat.com https://pl30572939.effectivecpmnetwork.com https://pl30572938.effectivecpmnetwork.com https://www.effectivecpmnetwork.com`,
  `frame-ancestors 'self'`,
  `media-src 'self' https: blob:`,
  `worker-src 'self' https: blob:`,
  `form-action 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
].join("; ");

const nextConfig = {
  // Vercel-friendly production settings
  poweredByHeader: false,
  compress: true,
  // Build output directory. The default `.next` is what Vercel expects — it
  // looks for `.next/routes-manifest.json` by that exact path and aborts the
  // deploy with NEXT_NO_ROUTES_MANIFEST when it is missing. So the output
  // directory is opt-in, never automatic.
  //
  // Set NEXT_DIST_DIR only when a local `next dev` has to keep running while
  // you build, since `next dev` owns `.next` and would otherwise clobber the
  // build output:
  //
  //   NEXT_DIST_DIR=.next-build npm run build
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    // Serve modern formats where the browser supports them and keep the
    // optimized result at the CDN edge for a month. Every unique image/size
    // pair otherwise costs a transform (CPU) on the first request after the
    // default 60s TTL expires.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2678400, // 31 days
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  webpack(config) {
    // pdfjs-dist's Node build requires the native `canvas` module for NodeCanvasFactory.
    // Text extraction runs only in the browser (lib/file-import.ts), so stub it out.
    config.resolve.alias.canvas = false;
    return config;
  },
  async redirects() {
    // Old domains redirect to the canonical chotikahini.vercel.app
    return [
      {
        source: "/en",
        destination: "/",
        permanent: true,
      },
      {
        source: "/en/:path*",
        destination: "/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "golopokahini.lol" }],
        destination: "https://chotikahini.vercel.app/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.golopokahini.lol" }],
        destination: "https://chotikahini.vercel.app/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/cover_pic/:path*",
        destination: "/images/Cover_pic/:path*",
      },
      {
        source: "/images/cover_pic/:path*",
        destination: "/images/Cover_pic/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/sitemap.xml",
        headers: [
          { key: "Content-Type", value: "application/xml; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/rss.xml",
        headers: [
          { key: "Content-Type", value: "application/xml; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/rss-pictures.xml",
        headers: [
          { key: "Content-Type", value: "application/xml; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
        ],
      },
      {
        // robots.txt is read on every crawl, so it must be cheap to fetch and
        // must never be served stale from a cache that is out of date.
        source: "/robots.txt",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  experimental: {
    // Cap the number of parallel static-generation workers. Each worker loads
    // the whole app + Supabase SDK, so the default of 4 can exhaust memory on
    // smaller machines and the build gets OOM-killed mid-write (which surfaces
    // as bogus "Cannot find module" / ENOENT errors).
    cpus: 2,
    // Rewrite barrel-file imports to per-module imports so the client bundle
    // only ships the icons that are actually used.
    optimizePackageImports: ["lucide-react"],
  },
  // Next 16 moved these out of `experimental`.
  outputFileTracingIncludes: {
    '/**/*': ['./content/**/*'],
    '/api/og/home': [
      './public/fonts/NotoSansBengali.ttf',
      './public/images/Cover_pic/52964258_014_da43.jpg',
    ],
    '/api/og/post/[identifier]': ['./public/fonts/NotoSansBengali.ttf'],
  },
  // Server-only packages are required at runtime, not bundled into the
  // serverless function — keeps the server bundle small and deploy fast.
  serverExternalPackages: [
    "bcryptjs",
    "jose",
    "gray-matter",
    "reading-time",
    "@napi-rs/canvas",
  ],
};

module.exports = nextConfig;
