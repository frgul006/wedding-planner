create or replace function public.mark_invite_opened(
  p_guest_id uuid,
  p_wedding_id uuid
)
returns void
language sql
set search_path = public
as $$
  update public.guests
  set invite_status = 'opened'
  where id = p_guest_id
    and wedding_id = p_wedding_id
    and deleted_at is null
    and invite_status = 'not replied';
$$;

revoke execute on function public.mark_invite_opened(uuid, uuid) from public;
grant execute on function public.mark_invite_opened(uuid, uuid) to service_role;
