#!/usr/bin/env node
/**
 * Load an exported JSON dump back into a Postgres database.
 *
 * This is a thin wrapper around the standalone toolkit in
 * `tools/db-toolkit/`. The toolkit is the canonical implementation —
 * it works with any Postgres or Supabase project, not just this one.
 *
 * USAGE
 * -----
 *   node scripts/import-supabase-data.mjs --url=<conn-string>
 *   node scripts/import-supabase-data.mjs --url=<conn-string> --in=./db-export
 *   node scripts/import-supabase-data.mjs --url=<conn-string> --truncate
 *   node scripts/import-supabase-data.mjs --url=<conn-string> --dry-run
 *
 * The connection string can also come from DATABASE_URL.
 *
 *   --truncate   empty each table before loading. Use this when the target
 *                already holds data and you want the dump to be the whole
 *                story. WITHOUT this flag an existing row with the same
 *                primary key is left alone.
 *   --dry-run    report what would be loaded without writing anything.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toolkit = path.join(__dirname, "..", "tools", "db-toolkit", "src");

const { parseArgs } = await import(path.join(toolkit, "lib.mjs"));
const { runImport } = await import(path.join(toolkit, "import.mjs"));

const { flags } = parseArgs(process.argv.slice(2));

await runImport(flags);
