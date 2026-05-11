insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'wedding-photos',
  'wedding-photos',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.weddings
add column photo_upload_requires_review boolean not null default false;

alter table public.weddings
alter column allow_anonymous_hub_upload set default true;

alter table public.guest_navigation_sessions
add constraint guest_navigation_sessions_id_wedding_id_unique unique (id, wedding_id);

create table public.photo_uploads (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  session_id uuid,
  guest_id uuid,
  storage_path text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  note text,
  verification_status text not null default 'pending' check (
    verification_status in ('pending', 'verified', 'rejected')
  ),
  verified_at timestamptz,
  rejected_at timestamptz,
  verification_error text,
  moderation_status text not null default 'pending' check (
    moderation_status in ('pending', 'approved', 'hidden')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint photo_uploads_session_wedding_fk
    foreign key (session_id, wedding_id)
    references public.guest_navigation_sessions(id, wedding_id)
    on delete set null (session_id),
  constraint photo_uploads_guest_wedding_fk
    foreign key (guest_id, wedding_id)
    references public.guests(id, wedding_id)
    on delete set null (guest_id),
  constraint photo_uploads_storage_path_present check (
    nullif(btrim(storage_path), '') is not null
  ),
  constraint photo_uploads_original_filename_present check (
    original_filename is null
    or nullif(btrim(original_filename), '') is not null
  ),
  constraint photo_uploads_mime_type_allowed check (
    mime_type is null
    or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
  ),
  constraint photo_uploads_size_bytes_valid check (
    size_bytes is null
    or (size_bytes > 0 and size_bytes <= 52428800)
  ),
  constraint photo_uploads_verified_fields check (
    verification_status <> 'verified'
    or (
      verified_at is not null
      and rejected_at is null
      and mime_type is not null
      and size_bytes is not null
    )
  ),
  constraint photo_uploads_rejected_fields check (
    verification_status <> 'rejected'
    or (rejected_at is not null and verified_at is null)
  ),
  constraint photo_uploads_pending_fields check (
    verification_status <> 'pending'
    or (verified_at is null and rejected_at is null)
  )
);

create unique index photo_uploads_storage_path_key
on public.photo_uploads(storage_path);

create index photo_uploads_wedding_created_idx
on public.photo_uploads(wedding_id, created_at desc)
where deleted_at is null;

create index photo_uploads_wedding_verification_idx
on public.photo_uploads(wedding_id, verification_status, created_at desc)
where deleted_at is null;

create index photo_uploads_wedding_moderation_idx
on public.photo_uploads(wedding_id, moderation_status, created_at desc)
where deleted_at is null;

create index photo_uploads_guest_idx
on public.photo_uploads(guest_id)
where guest_id is not null;

create index photo_uploads_session_idx
on public.photo_uploads(session_id)
where session_id is not null;

create trigger set_photo_uploads_updated_at
before update on public.photo_uploads
for each row
execute function public.set_updated_at();

alter table public.photo_uploads enable row level security;

create policy "Active admins can view photo uploads for their wedding"
on public.photo_uploads
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create photo uploads for their wedding"
on public.photo_uploads
for insert
to authenticated
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can update photo uploads for their wedding"
on public.photo_uploads
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can delete photo uploads for their wedding"
on public.photo_uploads
for delete
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));
