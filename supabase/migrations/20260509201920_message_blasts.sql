create table public.message_blasts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  title text check (title is null or nullif(btrim(title), '') is not null),
  body text not null check (nullif(btrim(body), '') is not null),
  audience text not null check (audience in ('all', 'rsvp yes', 'rsvp no', 'rsvp maybe')),
  send_status text not null default 'queued' check (send_status in ('queued', 'sent', 'partial', 'failed')),
  created_by_admin_id uuid not null references public.admin_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint message_blasts_id_wedding_id_unique unique (id, wedding_id)
);

create index message_blasts_wedding_created_idx
on public.message_blasts(wedding_id, created_at desc);

create index message_blasts_wedding_status_idx
on public.message_blasts(wedding_id, send_status);

create table public.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  message_blast_id uuid not null,
  guest_id uuid not null,
  phone text not null check (phone ~ '^[+][1-9][0-9]{7,14}$'),
  provider_message_id text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed')),
  error_text text,
  created_at timestamptz not null default now(),
  constraint message_deliveries_blast_wedding_fk
    foreign key (message_blast_id, wedding_id)
    references public.message_blasts(id, wedding_id)
    on delete cascade,
  constraint message_deliveries_guest_wedding_fk
    foreign key (guest_id, wedding_id)
    references public.guests(id, wedding_id)
    on delete cascade
);

create index message_deliveries_blast_idx
on public.message_deliveries(message_blast_id);

create index message_deliveries_guest_idx
on public.message_deliveries(guest_id);

create index message_deliveries_wedding_status_idx
on public.message_deliveries(wedding_id, delivery_status);

alter table public.message_blasts enable row level security;
alter table public.message_deliveries enable row level security;

create policy "Active admins can view message blasts for their wedding"
on public.message_blasts
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create message blasts for their wedding"
on public.message_blasts
for insert
to authenticated
with check (
  public.is_active_admin_for_wedding(wedding_id)
  and created_by_admin_id = auth.uid()
);

create policy "Active admins can update message blasts for their wedding"
on public.message_blasts
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can view message deliveries for their wedding"
on public.message_deliveries
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create message deliveries for their wedding"
on public.message_deliveries
for insert
to authenticated
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can update message deliveries for their wedding"
on public.message_deliveries
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));
