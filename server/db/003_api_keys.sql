-- API keys: how a program (the MCP server's clients, scripts) acts as a user.
--
-- Run after 002_credits.sql. Safe to run again (idempotent).
--
-- Only a SHA-256 hash of each key is stored; the key itself is shown to the
-- user once, when it is made. A revoked key keeps its row (for the record)
-- and stops working at once.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- the key's first characters, so a user can tell their keys apart
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user_active on public.api_keys (user_id) where revoked_at is null;

alter table public.api_keys enable row level security;
