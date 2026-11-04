-- Credits and Dodo Payments billing.
--
-- Run after 001_init.sql. Safe to run again (idempotent).
--
-- Credits are the one currency the app and the MCP server spend. A user has
-- two balances:
--   sub_credits   granted by a subscription each billing period; roll over up
--                 to a cap (2x the period's grant). Spent first.
--   pack_credits  bought outright; never expire.
--
-- Every change is one credit_ledger row with a unique `ref`, so a retried
-- webhook or request can never grant or charge twice. All writes go through
-- the functions below (each one a single transaction with the account row
-- locked), never through table updates from the app.

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sub_credits integer not null default 0,
  pack_credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ref text not null unique,
  kind text not null check (kind in ('grant', 'spend', 'refund', 'adjust')),
  sub_delta integer not null default 0,
  pack_delta integer not null default 0,
  reason text not null,
  project_id text,
  dodo_ref text
);
create index if not exists credit_ledger_user_at on public.credit_ledger (user_id, at desc);

-- One row per Dodo subscription: who it belongs to (renewal payments carry
-- the subscription id, not always our checkout metadata) and its state.
create table if not exists public.subscriptions (
  dodo_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sku text not null,
  status text not null,
  next_billing_date timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user on public.subscriptions (user_id);
-- Dodo's customer id: opens the customer portal (change plan, cancel, invoices).
alter table public.subscriptions add column if not exists dodo_customer_id text;

-- Every webhook delivery received, by its webhook-id: duplicates are skipped.
create table if not exists public.billing_events (
  webhook_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

-- ---------------------------------------------------------------------------
-- Spend: sub_credits first, then pack_credits. Returns {ok, balance}; ok is
-- false (nothing changed) when the balance is short. A repeated ref returns
-- ok without charging again.
-- ---------------------------------------------------------------------------
create or replace function public.credit_spend(p_user uuid, p_amount integer, p_ref text, p_reason text, p_project text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.credit_accounts;
  take_sub integer;
begin
  if p_amount <= 0 then
    raise exception 'credit_spend: amount must be positive';
  end if;
  insert into public.credit_accounts (user_id) values (p_user) on conflict do nothing;
  select * into acct from public.credit_accounts where user_id = p_user for update;
  if exists (select 1 from public.credit_ledger where ref = p_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'balance', acct.sub_credits + acct.pack_credits);
  end if;
  if acct.sub_credits + acct.pack_credits < p_amount then
    return jsonb_build_object('ok', false, 'balance', acct.sub_credits + acct.pack_credits);
  end if;
  take_sub := least(greatest(acct.sub_credits, 0), p_amount);
  update public.credit_accounts
    set sub_credits = sub_credits - take_sub,
        pack_credits = pack_credits - (p_amount - take_sub),
        updated_at = now()
    where user_id = p_user;
  insert into public.credit_ledger (user_id, ref, kind, sub_delta, pack_delta, reason, project_id)
    values (p_user, p_ref, 'spend', -take_sub, -(p_amount - take_sub), p_reason, p_project);
  return jsonb_build_object('ok', true, 'balance', acct.sub_credits + acct.pack_credits - p_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund a spend: returns its credits to the balances they came from. Keyed
-- by the spend's ref (the refund's own ref is 'refund:' || ref), so a second
-- refund of the same spend is a no-op. Returns true when credits came back.
-- ---------------------------------------------------------------------------
create or replace function public.credit_refund(p_spend_ref text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  spent public.credit_ledger;
begin
  select * into spent from public.credit_ledger where ref = p_spend_ref and kind = 'spend';
  if not found then
    return false;
  end if;
  perform 1 from public.credit_accounts where user_id = spent.user_id for update;
  if exists (select 1 from public.credit_ledger where ref = 'refund:' || p_spend_ref) then
    return false;
  end if;
  update public.credit_accounts
    set sub_credits = sub_credits - spent.sub_delta,
        pack_credits = pack_credits - spent.pack_delta,
        updated_at = now()
    where user_id = spent.user_id;
  insert into public.credit_ledger (user_id, ref, kind, sub_delta, pack_delta, reason, project_id)
    values (spent.user_id, 'refund:' || p_spend_ref, 'refund', -spent.sub_delta, -spent.pack_delta, p_reason, spent.project_id);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant: add pack credits and/or subscription credits. Subscription credits
-- roll over up to p_sub_cap (null = no cap). The ledger records what was
-- actually added. A repeated ref grants nothing. Returns the new balance.
-- ---------------------------------------------------------------------------
create or replace function public.credit_grant(
  p_user uuid, p_sub integer, p_pack integer, p_sub_cap integer, p_ref text, p_reason text, p_dodo_ref text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.credit_accounts;
  add_sub integer;
begin
  insert into public.credit_accounts (user_id) values (p_user) on conflict do nothing;
  select * into acct from public.credit_accounts where user_id = p_user for update;
  if exists (select 1 from public.credit_ledger where ref = p_ref) then
    return acct.sub_credits + acct.pack_credits;
  end if;
  add_sub := p_sub;
  if p_sub_cap is not null then
    add_sub := greatest(0, least(p_sub, p_sub_cap - acct.sub_credits));
  end if;
  update public.credit_accounts
    set sub_credits = sub_credits + add_sub,
        pack_credits = pack_credits + p_pack,
        updated_at = now()
    where user_id = p_user;
  insert into public.credit_ledger (user_id, ref, kind, sub_delta, pack_delta, reason, dodo_ref)
    values (p_user, p_ref, 'grant', add_sub, p_pack, p_reason, p_dodo_ref);
  return acct.sub_credits + acct.pack_credits + add_sub + p_pack;
end;
$$;

-- ---------------------------------------------------------------------------
-- Take back what a grant added (Dodo refunded the payment). May leave a
-- balance negative: credits already spent are owed, and nothing more can be
-- spent until it is positive again. Idempotent per grant.
-- ---------------------------------------------------------------------------
create or replace function public.credit_revoke(p_grant_ref text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  granted public.credit_ledger;
begin
  select * into granted from public.credit_ledger where ref = p_grant_ref and kind = 'grant';
  if not found then
    return false;
  end if;
  perform 1 from public.credit_accounts where user_id = granted.user_id for update;
  if exists (select 1 from public.credit_ledger where ref = 'revoke:' || p_grant_ref) then
    return false;
  end if;
  update public.credit_accounts
    set sub_credits = sub_credits - granted.sub_delta,
        pack_credits = pack_credits - granted.pack_delta,
        updated_at = now()
    where user_id = granted.user_id;
  insert into public.credit_ledger (user_id, ref, kind, sub_delta, pack_delta, reason, dodo_ref)
    values (granted.user_id, 'revoke:' || p_grant_ref, 'adjust', -granted.sub_delta, -granted.pack_delta, p_reason, granted.dodo_ref);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- A paying customer: approved (no waitlist), their plan named when they
-- subscribe (null leaves it), and storage raised to at least p_storage_mb.
-- Never lowers storage: a pack bought on top of a plan keeps the plan's room.
-- ---------------------------------------------------------------------------
create or replace function public.entitle_user(p_user uuid, p_plan text, p_storage_mb integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_plans
    set approved = true,
        plan = coalesce(p_plan, plan),
        storage_mb = greatest(storage_mb, p_storage_mb)
    where user_id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- Model prices (USD per million tokens; per_k_chars for speech), verified
-- 11 Oct 2026. Claude cache writes are the 5-minute rate.
-- ---------------------------------------------------------------------------
insert into public.model_prices (model, input, output, cache_read, cache_write, per_k_chars) values
  ('claude-opus-5-5',      4.00, 20.00, 0.20,  5.00, null),
  ('claude-sonnet-5-5',    2.00, 10.00, 0.10,  2.50, null),
  ('claude-haiku-4-5',     1.00,  5.00, 0.10,  1.25, null),
  ('qwen3.8-flash',        0.15,  0.47, 0.016, null, null),
  ('glm-5.3-flash',        0.15,  0.50, 0.03,  null, null),
  ('glm-5.3',              1.40,  4.40, 0.26,  null, null),
  ('minimax-m3',           0.30,  1.20, 0.06,  null, null),
  ('kimi-k3',              3.00, 15.00, 0.30,  null, null),
  ('deepseek-v4.1-flash',  0.14,  0.28, 0.028, null, null),
  ('eleven_multilingual_v2', 0, 0, null, null, 0.10)
on conflict (model) do update
  set input = excluded.input, output = excluded.output, cache_read = excluded.cache_read,
      cache_write = excluded.cache_write, per_k_chars = excluded.per_k_chars, updated_at = now();

-- ---------------------------------------------------------------------------
-- Lock everything to the server.
-- ---------------------------------------------------------------------------
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;

revoke execute on function public.credit_spend(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.credit_refund(text, text) from public, anon, authenticated;
revoke execute on function public.credit_grant(uuid, integer, integer, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.credit_revoke(text, text) from public, anon, authenticated;
revoke execute on function public.entitle_user(uuid, text, integer) from public, anon, authenticated;
