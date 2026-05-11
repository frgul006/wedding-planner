alter table public.photo_uploads
add column thumbnail_storage_path text,
add column thumbnail_mime_type text,
add column thumbnail_size_bytes bigint,
add column thumbnail_status text not null default 'unavailable' check (
  thumbnail_status in ('pending', 'ready', 'failed', 'unavailable')
),
add column thumbnail_verified_at timestamptz,
add column thumbnail_error text;

alter table public.photo_uploads
add constraint photo_uploads_thumbnail_storage_path_present check (
  thumbnail_storage_path is null
  or nullif(btrim(thumbnail_storage_path), '') is not null
),
add constraint photo_uploads_thumbnail_mime_type_allowed check (
  thumbnail_mime_type is null
  or thumbnail_mime_type in ('image/jpeg', 'image/png', 'image/webp')
),
add constraint photo_uploads_thumbnail_size_bytes_valid check (
  thumbnail_size_bytes is null
  or (thumbnail_size_bytes > 0 and thumbnail_size_bytes <= 2097152)
),
add constraint photo_uploads_thumbnail_ready_fields check (
  thumbnail_status <> 'ready'
  or (
    thumbnail_storage_path is not null
    and thumbnail_mime_type is not null
    and thumbnail_size_bytes is not null
    and thumbnail_verified_at is not null
    and thumbnail_error is null
  )
),
add constraint photo_uploads_thumbnail_pending_fields check (
  thumbnail_status <> 'pending'
  or (
    thumbnail_storage_path is not null
    and thumbnail_verified_at is null
    and thumbnail_error is null
  )
),
add constraint photo_uploads_thumbnail_failed_fields check (
  thumbnail_status <> 'failed'
  or (
    thumbnail_mime_type is null
    and thumbnail_size_bytes is null
    and thumbnail_verified_at is null
    and nullif(btrim(coalesce(thumbnail_error, '')), '') is not null
  )
),
add constraint photo_uploads_thumbnail_unavailable_fields check (
  thumbnail_status <> 'unavailable'
  or (
    thumbnail_storage_path is null
    and thumbnail_mime_type is null
    and thumbnail_size_bytes is null
    and thumbnail_verified_at is null
    and thumbnail_error is null
  )
);

create unique index photo_uploads_thumbnail_storage_path_key
on public.photo_uploads(thumbnail_storage_path)
where thumbnail_storage_path is not null;

create index photo_uploads_wedding_thumbnail_status_idx
on public.photo_uploads(wedding_id, thumbnail_status, created_at desc)
where deleted_at is null;

create index photo_uploads_public_gallery_idx
on public.photo_uploads(wedding_id, created_at desc)
where deleted_at is null
  and verification_status = 'verified'
  and moderation_status = 'approved';
