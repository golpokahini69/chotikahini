#!/usr/bin/env node
/**
 * Export the whole Supabase database to JSON files.
 *
 * This is a thin wrapper around the standalone toolkit in
 * `tools/db-toolkit/`. The toolkit is the canonical implementation —
 * it works with any Postgres or Supabase project, not just this one.
 *
 * USAGE
 * -----
 *   node scripts/export-supabase-data.mjs                     # → ./db-export
 *   node scripts/export-supabase-data.mjs --out=./my-backup   # custom folder
 *   node scripts/export-supabase-data.mjs --tables=users,stories
 *
 * The Supabase credentials come from .env.local, exactly as the app
 * reads them.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { runExport } = await import(
  path.join(__dirname, "..", "tools", "db-toolkit", "src", "export.mjs")
);

const { flags } = (await import(path.join(__dirname, "..", "tools", "db-toolkit", "src", "lib.mjs"))).parseArgs(
  process.argv.slice(2)
);

await runExport(flags, { startDir: path.join(__dirname, "..") });
