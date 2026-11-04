-- XLaunch private beta: accounts, projects, usage ledger, storage caps.
--
-- Only the API server talks to these tables (with the secret key). RLS is on
-- with no policies, so the publishable key used by browsers can read or
-- write nothing here.

-- ---------------------------------------------------------------------------
-- Accounts: a plan row per user. Unapproved rows are the waitlist.
-- ---------------------------------------------------------------------------

create table if not exists public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null default 'beta',
  approved boolean not null default false,
  is_admin boolean not null default false,
  videos_per_month integer not null default 3,
  tokens_per_month bigint not null default 3000000,
  storage_mb integer not null default 300,
  created_at timestamptz not null default now()
);

-- Emails approved before they sign up (the invite list).
create table if not exists public.invites (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- Admin emails: approved and admin on first sign-in.
create table if not exists public.admins (
  email text primary key
);

-- New auth user -> plan row (approved when invited or an admin).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean := exists (select 1 from public.admins a where lower(a.email) = lower(new.email));
  invited boolean := exists (select 1 from public.invites i where lower(i.email) = lower(new.email));
begin
  insert into public.user_plans (user_id, email, approved, is_admin)
  values (new.id, coalesce(new.email, ''), is_admin or invited, is_admin)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects: the whole project document lives in `data`; a few columns are
-- lifted out for listing and ownership.
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  title text not null,
  stage text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Usage ledger: one row per model call, speech take, and video started.
-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  project_id text,
  kind text not null check (kind in ('llm', 'tts', 'video')),
  purpose text not null default '',
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  tts_chars integer not null default 0,
  cost_usd numeric(12, 6),
  estimated boolean not null default false,
  ok boolean not null default true,
  ms integer not null default 0
);
create index if not exists usage_events_user_at on public.usage_events (user_id, at);
create index if not exists usage_events_project on public.usage_events (project_id);

-- USD per million tokens; speech models: per 1,000 characters.
create table if not exists public.model_prices (
  model text primary key,
  input numeric not null default 0,
  output numeric not null default 0,
  cache_read numeric,
  cache_write numeric,
  per_k_chars numeric,
  updated_at timestamptz not null default now()
);

-- This calendar month (UTC) per user: what quotas are checked against.
create or replace view public.usage_this_month with (security_invoker = true) as
select
  u.user_id,
  coalesce(sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens), 0)::bigint as tokens,
  coalesce(sum(u.cost_usd), 0)::numeric(12, 4) as cost_usd,
  count(*) filter (where u.kind = 'video')::integer as videos
from public.usage_events u
where u.at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by u.user_id;

-- ---------------------------------------------------------------------------
-- Object storage (Cloudflare R2) and the caps that keep us on the free tier.
-- ---------------------------------------------------------------------------

create table if not exists public.stored_objects (
  key text primary key,
  project_id text,
  user_id uuid references auth.users (id) on delete set null,
  bytes bigint not null,
  updated_at timestamptz not null default now()
);
create index if not exists stored_objects_project on public.stored_objects (project_id);
create index if not exists stored_objects_user on public.stored_objects (user_id);

-- Billable R2 operations per month: class A (writes, lists), class B (reads).
create table if not exists public.storage_ops (
  month text primary key,
  class_a bigint not null default 0,
  class_b bigint not null default 0
);

create or replace function public.add_storage_ops(p_month text, p_a bigint, p_b bigint)
returns public.storage_ops
language sql
security definer
set search_path = public
as $$
  insert into public.storage_ops (month, class_a, class_b)
  values (p_month, p_a, p_b)
  on conflict (month) do update
    set class_a = public.storage_ops.class_a + excluded.class_a,
        class_b = public.storage_ops.class_b + excluded.class_b
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Lock everything to the server.
-- ---------------------------------------------------------------------------

alter table public.user_plans enable row level security;
alter table public.invites enable row level security;
alter table public.admins enable row level security;
alter table public.projects enable row level security;
alter table public.usage_events enable row level security;
alter table public.model_prices enable row level security;
alter table public.stored_objects enable row level security;
alter table public.storage_ops enable row level security;

revoke all on public.usage_this_month from anon, authenticated;
revoke execute on function public.add_storage_ops(text, bigint, bigint) from public, anon, authenticated;

insert into public.admins (email) values ('aryanthakore24@gmail.com') on conflict do nothing;
