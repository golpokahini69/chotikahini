#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// scripts/preview-og.ts — preview a share card locally.
//
// The OpenGraph card is rendered by a sharp → blur → composite →
// canvas → composite pipeline behind three route handlers. Judging
// how the card looks by reading that code is hopeless, and the card
// only appears in the wild — inside a social platform's timeline,
// where a change is slow to roll out and harder to undo.
//
// So this script fetches the card from the running dev server, saves
// it, and opens it. It fetches from the *live route* rather than
// re-implementing the renderer, which means the picture on your
// screen is byte-for-byte the picture a crawler gets.
//
// Usage:
//   npm run og:preview <slug>              a story card
//   npm run og:preview video <id>          a video card
//   npm run og:preview picture <id>        a picture card
//   npm run og:preview:grid <slug>         every blur level, side by side
//
//   npm run og:preview -- clear            drop the saved previews
//
// Options:
//   --blur <sigma>   render at a specific blur sigma (e.g. 60)
//   --scrim <0..1>   render at a specific scrim opacity (e.g. 0.3)
//   --base <url>     the dev server to talk to (default http://localhost:3000)
//
// Requires the dev server to be running:
//   npm run dev
//
// Server-only. Do not import from a Client Component.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const DEFAULT_BASE_URL = "http://localhost:3000";

/** Where the previews are written. */
const OUTPUT_DIR = "/tmp/og-preview";

interface Options {
  baseUrl: string;
  blur?: number;
  scrim?: number;
  grid: boolean;
  /** The slug or media id to render. */
  target?: string;
  /** Which kind of card: story | video | picture. */
  kind: "story" | "video" | "picture";
}

/**
 * Parse the command line.
 *
 * The first positional argument is the kind for media (`video`,
 * `picture`); anything else is treated as a story slug.
 */
function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: process.env.OG_BASE_URL || DEFAULT_BASE_URL,
    grid: false,
    kind: "story",
  };

  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--grid":
        options.grid = true;
        break;
      case "--blur": {
        const value = Number(argv[++index]);
        if (Number.isFinite(value)) options.blur = value;
        break;
      }
      case "--scrim": {
        const value = Number(argv[++index]);
        if (Number.isFinite(value)) options.scrim = value;
        break;
      }
      case "--base": {
        const value = argv[++index];
        if (value) options.baseUrl = value.replace(/\/$/, "");
        break;
      }
      default:
        positional.push(arg);
    }
  }

  if (positional[0] === "video" || positional[0] === "picture") {
    options.kind = positional[0];
    options.target = positional[1];
  } else {
    options.kind = "story";
    options.target = positional[0];
  }

  return options;
}

/**
 * Build the OG route path for the target.
 *
 * The `?v=` fingerprint is deliberately left off: the route recomputes
 * its own, and the parameter only controls the CDN cache key.
 */
function routePath(options: Options): string {
  const target = options.target || "";
  const base =
    options.kind === "story"
      ? `/api/og/post/${encodeURIComponent(target)}`
      : `/api/og/media/${options.kind}/${encodeURIComponent(target)}`;

  const query = new URLSearchParams();
  if (options.blur != null) query.set("blur", String(options.blur));
  if (options.scrim != null) query.set("scrim", String(options.scrim));

  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * Fetch an image from the dev server.
 *
 * A non-200 response usually means the slug does not exist, so the
 * body is passed through — the route's own error text says which.
 */
async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} from ${url}${body ? `\n${body}` : ""}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Open a file with the system's default image viewer. */
function open(filePath: string): void {
  execFile("open", [filePath], (error) => {
    if (error) {
      console.error(`Could not open ${filePath}: ${error.message}`);
    }
  });
}

/**
 * Write the bytes to the output directory and open them.
 *
 * The filename carries the blur and scrim so two runs at different
 * settings do not overwrite each other.
 */
function save(
  name: string,
  bytes: Buffer,
  suffix = "",
): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `${name}${suffix}.jpg`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

/**
 * Render the comparison grid by asking the debug route for it.
 *
 * The debug route renders every level through the same function the
 * real cards use, so the grid is the real card at every level.
 */
async function renderGrid(options: Options): Promise<void> {
  const query = new URLSearchParams();
  if (options.kind === "story") {
    query.set("slug", options.target || "");
  } else {
    query.set("kind", options.kind);
    query.set("id", options.target || "");
  }
  if (options.scrim != null) query.set("scrim", String(options.scrim));

  const url = `${options.baseUrl}/api/og/debug?${query.toString()}`;
  console.log(`→ ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url}\n${body}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, "og-blur-grid.png");
  fs.writeFileSync(filePath, bytes);
  console.log(`✓ ${filePath}`);
  open(filePath);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // `clear` just wipes the output folder.
  if (argv[0] === "clear") {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
      console.log(`✓ removed ${OUTPUT_DIR}`);
    } else {
      console.log(`nothing to clear at ${OUTPUT_DIR}`);
    }
    return;
  }

  const options = parseArgs(argv);

  if (!options.target) {
    console.error(
      "Usage: npm run og:preview <slug> | video <id> | picture <id>\n" +
        "       npm run og:preview:grid <slug>\n" +
        "       npm run og:preview -- clear",
    );
    process.exit(1);
  }

  if (options.grid) {
    await renderGrid(options);
    return;
  }

  const url = `${options.baseUrl}${routePath(options)}`;
  console.log(`→ ${url}`);

  const bytes = await fetchImage(url);

  // The card is a 1200×630 JPEG; a wrong content type here means the
  // route returned an error page rather than a card.
  if (bytes.subarray(0, 2).toString("latin1") !== "ÿØ") {
    console.error(
      `The server returned something that is not a JPEG:\n${bytes
        .subarray(0, 200)
        .toString("utf8")}`,
    );
    process.exit(1);
  }

  const suffix =
    options.blur != null || options.scrim != null
      ? `-b${options.blur ?? "d"}-s${options.scrim ?? "d"}`
      : "";

  const filePath = save(`${options.kind}-${options.target}`, bytes, suffix);
  console.log(`✓ ${filePath}  (${(bytes.length / 1024).toFixed(1)} KB)`);
  open(filePath);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  console.error(
    "\nIs the dev server running?  npm run dev\n" +
      "Is the slug correct?    The route 404s for an unknown story.",
  );
  process.exit(1);
});
