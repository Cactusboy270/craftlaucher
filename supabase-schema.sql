create table if not exists public.admins (
  uuid text primary key,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.published_instances (
  id text primary key,
  name text not null,
  version text not null,
  mod_loader text,
  release_type text default 'release',
  ram text default '6G',
  icon text,
  imported_from text,
  published_by_admin boolean not null default true,
  published_by_uuid text,
  game_dir text,
  mods_path text,
  java_path text,
  window_width integer default 1280,
  window_height integer default 720,
  custom_jvm_args text default '',
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.published_instances enable row level security;

drop policy if exists "public read admins" on public.admins;
create policy "public read admins"
on public.admins
for select
using (true);

drop policy if exists "public read published instances" on public.published_instances;
create policy "public read published instances"
on public.published_instances
for select
using (true);

insert into public.admins (uuid, enabled)
values ('8a501859-8fb7-443f-ab18-0909b41b3275', true)
on conflict (uuid) do update set enabled = excluded.enabled;
