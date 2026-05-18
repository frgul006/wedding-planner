create or replace function public.archive_guest_lifecycle(
  p_guest_id uuid,
  p_wedding_id uuid
)
returns table (
  archived_guest_id uuid,
  archived_guest_kind text,
  archived_guest_count integer,
  revoked_scoped_token_count integer
)
language plpgsql
set search_path = public
as $$
declare
  archived_at timestamptz := now();
  target_guest_id uuid;
  target_guest_kind text;
begin
  update public.guests
  set deleted_at = archived_at
  where id = p_guest_id
    and wedding_id = p_wedding_id
    and deleted_at is null
  returning id, guest_kind into target_guest_id, target_guest_kind;

  if not found then
    raise exception 'Guest not found or already archived' using errcode = 'P0002';
  end if;

  archived_guest_id := target_guest_id;
  archived_guest_kind := target_guest_kind;

  with tied_plus_ones as (
    update public.guests
    set deleted_at = archived_at
    where target_guest_kind = 'invited'
      and wedding_id = p_wedding_id
      and invited_guest_id = target_guest_id
      and guest_kind = 'plus_one'
      and rsvp_managed = true
      and deleted_at is null
    returning id
  ), archived_guests as (
    select target_guest_id as id
    union all
    select tied_plus_ones.id
    from tied_plus_ones
  ), revoked_scoped_tokens as (
    update public.invite_tokens
    set invalidated_at = archived_at,
        is_active = false,
        regenerated_at = archived_at
    where wedding_id = p_wedding_id
      and access_scope = 'scoped'
      and is_active = true
      and guest_id in (select archived_guests.id from archived_guests)
    returning id
  )
  select
    count(distinct archived_guests.id)::integer,
    count(distinct revoked_scoped_tokens.id)::integer
  into archived_guest_count, revoked_scoped_token_count
  from archived_guests
  left join revoked_scoped_tokens on true;

  return next;
end;
$$;

revoke execute on function public.archive_guest_lifecycle(uuid, uuid) from public;
grant execute on function public.archive_guest_lifecycle(uuid, uuid) to authenticated;
