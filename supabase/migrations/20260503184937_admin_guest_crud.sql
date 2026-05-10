create table public.guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  notes text,
  invite_status text not null default 'not replied' check (
    invite_status in ('not replied', 'opened', 'rsvp yes', 'rsvp no', 'rsvp maybe')
  ),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  )
);

create index guests_wedding_id_idx on public.guests(wedding_id);
create index guests_not_deleted_idx on public.guests(wedding_id, full_name) where deleted_at is null;
create index guests_invite_status_idx on public.guests(wedding_id, invite_status) where deleted_at is null;

create trigger set_guests_updated_at
before update on public.guests
for each row
execute function public.set_updated_at();

create or replace function public.is_active_admin_for_wedding(target_wedding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where admin_profiles.wedding_id = target_wedding_id
      and admin_profiles.id = auth.uid()
      and admin_profiles.is_active = true
  );
$$;

alter table public.guests enable row level security;

create policy "Active admins can view guests for their wedding"
on public.guests
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create guests for their wedding"
on public.guests
for insert
to authenticated
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can update guests for their wedding"
on public.guests
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));
