create extension if not exists pgcrypto;

create table public.weddings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  wedding_date timestamptz,
  venue_name text,
  venue_address text,
  google_maps_url text,
  time_plan jsonb not null default '[]'::jsonb,
  policy text,
  gift_info text,
  spotify_playlist_url text,
  allow_anonymous_hub_upload boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'admin' check (role = 'admin'),
  is_active boolean not null default true,
  invited_by_admin_id uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index admin_profiles_wedding_id_idx on public.admin_profiles(wedding_id);
create index admin_profiles_active_admin_idx on public.admin_profiles(id) where is_active;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_weddings_updated_at
before update on public.weddings
for each row
execute function public.set_updated_at();

create trigger set_admin_profiles_updated_at
before update on public.admin_profiles
for each row
execute function public.set_updated_at();

alter table public.weddings enable row level security;
alter table public.admin_profiles enable row level security;

create policy "Admins can view their own profile"
on public.admin_profiles
for select
to authenticated
using (id = auth.uid());

create policy "Admins can view their wedding"
on public.weddings
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_profiles
    where admin_profiles.wedding_id = weddings.id
      and admin_profiles.id = auth.uid()
      and admin_profiles.is_active = true
  )
);

create policy "Admins can update their wedding"
on public.weddings
for update
to authenticated
using (
  exists (
    select 1
    from public.admin_profiles
    where admin_profiles.wedding_id = weddings.id
      and admin_profiles.id = auth.uid()
      and admin_profiles.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.admin_profiles
    where admin_profiles.wedding_id = weddings.id
      and admin_profiles.id = auth.uid()
      and admin_profiles.is_active = true
  )
);
