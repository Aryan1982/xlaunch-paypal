-- Users who may make any number of free previews (the team, testers): set
-- from Accessboard's Previews page. They skip the one-per-account and
-- per-IP limits of billing/preview.ts.
alter table public.user_plans add column if not exists unlimited_previews boolean not null default false;
