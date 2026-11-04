-- A free preview for a new user: the film planned and its first scene
-- written before paying (billing/preview.ts). One per account, kept here so
-- deleting the project doesn't hand out another; a few per IP a day.
create table if not exists public.free_previews (
  user_id uuid primary key references auth.users (id) on delete cascade,
  project_id text not null,
  ip text,
  created_at timestamptz not null default now(),
  -- the one follow-up email about an unpaid preview
  emailed_at timestamptz
);
create index if not exists free_previews_ip on public.free_previews (ip, created_at desc);
create index if not exists free_previews_followup on public.free_previews (created_at) where emailed_at is null;
alter table public.free_previews enable row level security;

-- The funnel, one row per step (usage/funnel.ts): preview_started,
-- preview_ready, paywall_viewed, checkout_started, paid, render_started,
-- video_ready.
create table if not exists public.funnel_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null,
  user_id uuid,
  project_id text,
  model text
);
create index if not exists funnel_events_event_at on public.funnel_events (event, at desc);
alter table public.funnel_events enable row level security;

-- Each step per day: conversion is one query.
create or replace view public.funnel_daily as
  select date_trunc('day', at)::date as day, event, count(*) as events, count(distinct user_id) as users
  from public.funnel_events
  group by 1, 2;
revoke all on public.funnel_daily from anon, authenticated;
