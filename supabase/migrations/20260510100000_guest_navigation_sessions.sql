create table public.guest_navigation_sessions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  guest_id uuid,
  invite_token_id uuid references public.invite_tokens(id) on delete set null,
  cookie_hash text not null,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb,
  constraint guest_navigation_sessions_guest_wedding_fk
    foreign key (guest_id, wedding_id)
    references public.guests(id, wedding_id)
    on delete cascade,
  constraint guest_navigation_sessions_cookie_hash_length check (char_length(cookie_hash) = 64),
  constraint guest_navigation_sessions_metadata_object check (
    metadata is null or jsonb_typeof(metadata) = 'object'
  ),
  constraint guest_navigation_sessions_identity_check check (
    (is_anonymous = true and guest_id is null and invite_token_id is null)
    or (is_anonymous = false and guest_id is not null)
  )
);

create unique index guest_navigation_sessions_cookie_hash_key
on public.guest_navigation_sessions(cookie_hash);

create index guest_navigation_sessions_wedding_guest_idx
on public.guest_navigation_sessions(wedding_id, guest_id);

create index guest_navigation_sessions_invite_token_idx
on public.guest_navigation_sessions(invite_token_id)
where invite_token_id is not null;

create index guest_navigation_sessions_expires_idx
on public.guest_navigation_sessions(expires_at)
where expires_at is not null;

alter table public.guest_navigation_sessions enable row level security;

create policy "Admins can view guest nav sessions"
on public.guest_navigation_sessions
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));
