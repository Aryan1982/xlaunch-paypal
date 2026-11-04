-- The whole funnel, from the first visit (usage/funnel.ts): steps the browser
-- sees before sign-in (visit, generate_clicked, signin_viewed) carry an
-- anonymous browser id, and a visit where it came from. A signed-in browser
-- sends the same id, which links a visitor to their account.
alter table public.funnel_events add column if not exists visitor text;
alter table public.funnel_events add column if not exists source text;
create index if not exists funnel_events_at on public.funnel_events (at desc);
create index if not exists funnel_events_visitor on public.funnel_events (visitor) where visitor is not null;

-- Each step per day, people counted by account, else by browser.
create or replace view public.funnel_daily as
  select date_trunc('day', at)::date as day, event, count(*) as events, count(distinct user_id) as users,
    count(distinct coalesce(user_id::text, visitor)) as people
  from public.funnel_events
  group by 1, 2;
revoke all on public.funnel_daily from anon, authenticated;
