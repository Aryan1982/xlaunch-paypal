import { readFileSync } from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * db/002_credits.sql against a real Postgres (PGlite, in-process). Only what
 * 002 needs from 001 and from Supabase is stubbed: auth.users, model_prices
 * and the anon/authenticated roles.
 */

const MIGRATION = readFileSync(path.resolve(__dirname, "../../db/002_credits.sql"), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users (id) values ('${USER}');
    create table public.user_plans (
      user_id uuid primary key, email text, plan text not null default 'beta',
      approved boolean not null default false, storage_mb integer not null default 300
    );
    insert into public.user_plans (user_id, email) values ('${USER}', 'a@b.co');
    create table public.model_prices (
      model text primary key, input numeric not null default 0, output numeric not null default 0,
      cache_read numeric, cache_write numeric, per_k_chars numeric, updated_at timestamptz not null default now()
    );
  `);
  await pg.exec(MIGRATION);
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await pg.query<Record<string, T>>(sql, params);
  return Object.values(rows[0]!)[0] as T;
};

const balances = async () =>
  (await pg.query<{ sub_credits: number; pack_credits: number }>("select sub_credits, pack_credits from credit_accounts where user_id = $1", [USER])).rows[0];

const grant = (sub: number, pack: number, cap: number | null, ref: string) =>
  one<number>("select credit_grant($1, $2, $3, $4, $5, 'test', null)", [USER, sub, pack, cap, ref]);
const spend = (amount: number, ref: string) =>
  one<{ ok: boolean; balance: number; duplicate?: boolean }>("select credit_spend($1, $2, $3, 'test', 'proj1')", [USER, amount, ref]);
const refund = (ref: string) => one<boolean>("select credit_refund($1, 'test')", [ref]);
const revoke = (ref: string) => one<boolean>("select credit_revoke($1, 'test')", [ref]);

describe("002_credits.sql", () => {
  it("runs twice without error (idempotent migration)", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });

  it("grants pack credits and records the grant once per ref", async () => {
    expect(await grant(0, 1400, null, "pay_1")).toBe(1400);
    expect(await grant(0, 1400, null, "pay_1")).toBe(1400);
    expect(await balances()).toEqual({ sub_credits: 0, pack_credits: 1400 });
  });

  it("rolls subscription credits over only up to the cap", async () => {
    await grant(2500, 0, 5000, "renew_1");
    await grant(2500, 0, 5000, "renew_2");
    expect(await grant(2500, 0, 5000, "renew_3")).toBe(5000);
    expect((await balances())?.sub_credits).toBe(5000);
    const { rows } = await pg.query<{ sub_delta: number }>("select sub_delta from credit_ledger where ref = 'renew_3'");
    expect(rows[0]?.sub_delta).toBe(0);
  });

  it("spends subscription credits before pack credits", async () => {
    await grant(500, 1000, null, "g");
    expect(await spend(600, "video:a")).toEqual({ ok: true, balance: 900 });
    expect(await balances()).toEqual({ sub_credits: 0, pack_credits: 900 });
  });

  it("refuses a spend larger than the balance and changes nothing", async () => {
    await grant(0, 500, null, "g");
    expect(await spend(600, "video:a")).toEqual({ ok: false, balance: 500 });
    expect(await balances()).toEqual({ sub_credits: 0, pack_credits: 500 });
  });

  it("never charges the same ref twice", async () => {
    await grant(0, 1000, null, "g");
    await spend(600, "video:a");
    expect(await spend(600, "video:a")).toMatchObject({ ok: true, duplicate: true, balance: 400 });
    expect((await balances())?.pack_credits).toBe(400);
  });

  it("refunds a spend to the balances it came from, once", async () => {
    await grant(500, 1000, null, "g");
    await spend(600, "video:a");
    expect(await refund("video:a")).toBe(true);
    expect(await refund("video:a")).toBe(false);
    expect(await balances()).toEqual({ sub_credits: 500, pack_credits: 1000 });
  });

  it("ignores a refund for a spend that never happened", async () => {
    expect(await refund("video:nope")).toBe(false);
  });

  it("revokes a refunded payment's credits, allowing a negative balance that blocks spending", async () => {
    await grant(0, 1400, null, "pay_1");
    await spend(1000, "video:a");
    expect(await revoke("pay_1")).toBe(true);
    expect(await revoke("pay_1")).toBe(false);
    expect((await balances())?.pack_credits).toBe(-1000);
    expect(await spend(1, "video:b")).toMatchObject({ ok: false });
  });

  it("entitles a paying user: approved, plan named only when given, storage only ever raised", async () => {
    const plan = async () =>
      (await pg.query<{ approved: boolean; plan: string; storage_mb: number }>("select approved, plan, storage_mb from user_plans where user_id = $1", [USER])).rows[0];
    await pg.query("select entitle_user($1, null, 1024)", [USER]);
    expect(await plan()).toEqual({ approved: true, plan: "beta", storage_mb: 1024 });
    await pg.query("select entitle_user($1, 'studio', 5120)", [USER]);
    expect(await plan()).toEqual({ approved: true, plan: "studio", storage_mb: 5120 });
    await pg.query("select entitle_user($1, null, 1024)", [USER]);
    expect(await plan()).toEqual({ approved: true, plan: "studio", storage_mb: 5120 });
  });

  it("seeds model prices", async () => {
    expect(Number(await one("select output from model_prices where model = 'claude-opus-5-5'"))).toBe(20);
    expect(Number(await one("select per_k_chars from model_prices where model = 'eleven_multilingual_v2'"))).toBe(0.1);
  });
});
