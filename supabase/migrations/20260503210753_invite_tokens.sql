alter table public.guests
add constraint guests_id_wedding_id_unique unique (id, wedding_id);

create table public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  guest_id uuid not null,
  token_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  regenerated_at timestamptz,
  invalidated_at timestamptz,
  constraint invite_tokens_guest_wedding_fk
    foreign key (guest_id, wedding_id)
    references public.guests(id, wedding_id)
    on delete cascade,
  constraint invite_tokens_token_hash_length check (char_length(token_hash) = 64),
  constraint invite_tokens_inactive_invalidated check (
    is_active = true or invalidated_at is not null
  )
);

create unique index invite_tokens_token_hash_key on public.invite_tokens(token_hash);
create unique index invite_tokens_one_active_per_guest_idx
on public.invite_tokens(guest_id)
where is_active = true;
create index invite_tokens_wedding_guest_idx on public.invite_tokens(wedding_id, guest_id);

alter table public.invite_tokens enable row level security;

create policy "Active admins can view invite tokens for their wedding"
on public.invite_tokens
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create invite tokens for their wedding"
on public.invite_tokens
for insert
to authenticated
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can update invite tokens for their wedding"
on public.invite_tokens
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can delete invite tokens for their wedding"
on public.invite_tokens
for delete
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));
