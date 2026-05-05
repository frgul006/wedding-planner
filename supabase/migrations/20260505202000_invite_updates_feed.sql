create table public.wedding_updates (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  title text not null check (nullif(btrim(title), '') is not null),
  message text not null check (nullif(btrim(message), '') is not null),
  link_url text check (
    link_url is null
    or link_url ~* '^https?://'
  ),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by_admin_id uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wedding_updates_wedding_status_updated_idx
on public.wedding_updates(wedding_id, status, updated_at desc);

create index wedding_updates_wedding_updated_idx
on public.wedding_updates(wedding_id, updated_at desc);

create trigger set_wedding_updates_updated_at
before update on public.wedding_updates
for each row
execute function public.set_updated_at();

alter table public.wedding_updates enable row level security;

create policy "Active admins can view wedding updates for their wedding"
on public.wedding_updates
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create wedding updates for their wedding"
on public.wedding_updates
for insert
to authenticated
with check (
  public.is_active_admin_for_wedding(wedding_id)
  and created_by_admin_id = auth.uid()
);

create policy "Active admins can update wedding updates for their wedding"
on public.wedding_updates
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can delete wedding updates for their wedding"
on public.wedding_updates
for delete
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));
