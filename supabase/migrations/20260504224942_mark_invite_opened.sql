create or replace function public.mark_invite_opened(p_token_hash text)
returns table (
  opened_guest_id uuid,
  opened_wedding_id uuid,
  current_invite_status text
)
language plpgsql
set search_path = public
as $$
declare
  token_record record;
begin
  select invite_tokens.guest_id, invite_tokens.wedding_id
  into token_record
  from public.invite_tokens
  inner join public.guests
    on guests.id = invite_tokens.guest_id
    and guests.wedding_id = invite_tokens.wedding_id
  where invite_tokens.token_hash = p_token_hash
    and invite_tokens.is_active = true
    and guests.deleted_at is null;

  if not found then
    raise exception 'Invite token not valid' using errcode = 'P0002';
  end if;

  update public.guests
  set invite_status = 'opened'
  where id = token_record.guest_id
    and wedding_id = token_record.wedding_id
    and deleted_at is null
    and invite_status = 'not replied'
  returning invite_status into current_invite_status;

  if current_invite_status is null then
    select guests.invite_status
    into current_invite_status
    from public.guests
    where guests.id = token_record.guest_id
      and guests.wedding_id = token_record.wedding_id
      and guests.deleted_at is null;
  end if;

  if current_invite_status is null then
    raise exception 'Invite token not valid' using errcode = 'P0002';
  end if;

  opened_guest_id := token_record.guest_id;
  opened_wedding_id := token_record.wedding_id;
  return next;
end;
$$;

revoke execute on function public.mark_invite_opened(text) from public;
grant execute on function public.mark_invite_opened(text) to service_role;
