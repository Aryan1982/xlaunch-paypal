/**
 * Apply db/*.sql to a Postgres database, in order, each file once.
 *
 *   DATABASE_URL=postgresql://... npx tsx scripts/db/migrate.ts            # list what's pending
 *   DATABASE_URL=postgresql://... npx tsx scripts/db/migrate.ts --apply    # run it
 *   ... --mark-applied 001_init.sql   # record a file applied by hand earlier, without running it
 *
 * Applied files are recorded in public.schema_migrations. Each file runs in
 * its own transaction: it applies completely or not at all.
 *
 * The production project is refused unless --production is passed as well:
 * a migration aimed at the wrong database should take a deliberate act.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { Client } from "pg";

const PRODUCTION_REF = "gkliyuvotpjfejyiiftg";
const DB_DIR = path.resolve(__dirname, "../../db");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const production = args.includes("--production");
const markIndex = args.indexOf("--mark-applied");
const mark = markIndex >= 0 ? args[markIndex + 1] : undefined;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL.");
  const target = new URL(url);
  const isProduction = url.includes(PRODUCTION_REF);
  console.log(`Target: ${target.hostname} as ${decodeURIComponent(target.username)}${isProduction ? "  ← PRODUCTION" : ""}`);
  if (isProduction && (apply || mark) && !production) {
    throw new Error("This is the production database. Add --production to change it.");
  }

  const files = readdirSync(DB_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("alter table public.schema_migrations enable row level security");
    const done = new Set((await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name));

    if (mark) {
      if (!files.includes(mark)) throw new Error(`No such migration: ${mark}`);
      await client.query("insert into public.schema_migrations (name) values ($1) on conflict do nothing", [mark]);
      console.log(`Recorded ${mark} as applied (not run).`);
      return;
    }

    const pending = files.filter((f) => !done.has(f));
    for (const f of files) console.log(`  ${done.has(f) ? "applied" : "pending"}  ${f}`);
    if (!pending.length) return console.log("\nUp to date.");
    if (!apply) return console.log(`\n${pending.length} pending. Run again with --apply.`);

    for (const f of pending) {
      process.stdout.write(`\nApplying ${f} … `);
      await client.query("begin");
      try {
        await client.query(readFileSync(path.join(DB_DIR, f), "utf8"));
        await client.query("insert into public.schema_migrations (name) values ($1)", [f]);
        await client.query("commit");
        console.log("done");
      } catch (error) {
        await client.query("rollback");
        console.log("FAILED (rolled back)");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
