#!/usr/bin/env node
/**
 * Turn an exported dataset into ONE sql file.
 *
 * This is a thin wrapper around the standalone toolkit in
 * `tools/db-toolkit/`. The toolkit is the canonical implementation —
 * it works with any Postgres or Supabase project, not just this one.
 *
 * USAGE
 * -----
 *   node scripts/seed-sql.mjs                       # → ./db-export/seed.sql
 *   node scripts/seed-sql.mjs --in=./db-export
 *   node scripts/seed-sql.mjs --out-file=./seed.sql
 *   node scripts/seed-sql.mjs --truncate
 *
 * The result is a plain .sql file that Postgres understands natively:
 *
 *   psql "$DATABASE_URL" -f db-export/seed.sql
 *
 * or paste it into the Supabase SQL Editor.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toolkit = path.join(__dirname, "..", "tools", "db-toolkit", "src");

const { parseArgs } = await import(path.join(toolkit, "lib.mjs"));
const { runSeedSql } = await import(path.join(toolkit, "seed.mjs"));

const { flags } = parseArgs(process.argv.slice(2));

await runSeedSql(flags);
