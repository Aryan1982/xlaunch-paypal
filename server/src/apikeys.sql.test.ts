import { readFileSync } from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

/** db/003_api_keys.sql against a real Postgres (PGlite), with auth.users stubbed. */

const MIGRATION = readFileSync(path.resolve(__dirname, "../db/003_api_keys.sql"), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users (id) values ('${USER}');
  `);
  await pg.exec(MIGRATION);
});

const insert = (hash: string) =>
  pg.query("insert into api_keys (user_id, name, prefix, key_hash) values ($1, 'cli', 'xl_abcdefg', $2) returning id", [USER, hash]);

describe("003_api_keys.sql", () => {
  it("runs twice without error (idempotent migration)", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });

  it("refuses two keys with the same hash", async () => {
    await insert("h1");
    await expect(insert("h1")).rejects.toThrow(/unique|duplicate/i);
  });

  it("removes a user's keys with the user", async () => {
    await insert("h1");
    await pg.exec(`delete from auth.users where id = '${USER}'`);
    expect((await pg.query("select count(*)::int as n from api_keys")).rows[0]).toEqual({ n: 0 });
  });

  it("keeps the table closed to the browser roles", async () => {
    const { rows } = await pg.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'api_keys'");
    expect(rows[0]?.relrowsecurity).toBe(true);
    const { rows: policies } = await pg.query("select policyname from pg_policies where tablename = 'api_keys'");
    expect(policies).toEqual([]);
  });
});
