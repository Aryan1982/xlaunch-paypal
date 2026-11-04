-- Showcase: the example videos on the home and login pages, managed from the
-- Accessboard CMS. Files live in R2 (showcase/<id>.mp4, showcase/<id>.jpg),
-- recorded in stored_objects under project_id 'showcase' like every other file.
-- Server-only: row level security is on with no policies (the API reads it with
-- the secret key and serves the files itself).

create table if not exists public.showcase_videos (
  id text primary key,
  title text not null,
  mode text not null default '2d' check (mode in ('2d', '3d')),
  width integer not null,
  height integer not null,
  seconds numeric(8, 2) not null,
  video_key text not null,
  poster_key text not null,
  bytes bigint not null default 0,
  on_home boolean not null default false,
  on_login boolean not null default false,
  -- smaller first; ties newest first
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists showcase_videos_home on public.showcase_videos (on_home, mode, position);
create index if not exists showcase_videos_login on public.showcase_videos (on_login, position);

alter table public.showcase_videos enable row level security;
