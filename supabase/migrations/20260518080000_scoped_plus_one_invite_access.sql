-- Enable scoped Invite access for Plus-one Guests.

comment on column public.invite_tokens.access_scope is
  'Invite access scope. Full grants Invited Guest RSVP-capable access; scoped grants Plus-one Guest non-RSVP Invite and Wedding hub access.';

create or replace function public.enforce_invite_token_access_scope_guest_kind()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  token_guest_kind text;
begin
  select guest_kind
  into token_guest_kind
  from public.guests
  where id = new.guest_id
    and wedding_id = new.wedding_id;

  if new.access_scope = 'full' and token_guest_kind is distinct from 'invited' then
    raise exception 'Full Invite tokens require an Invited Guest' using errcode = '23514';
  end if;

  if new.access_scope = 'scoped' and token_guest_kind is distinct from 'plus_one' then
    raise exception 'Scoped Invite tokens require a Plus-one Guest' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_invite_token_access_scope_guest_kind on public.invite_tokens;
create trigger enforce_invite_token_access_scope_guest_kind
before insert or update of access_scope, guest_id, wedding_id
on public.invite_tokens
for each row
execute function public.enforce_invite_token_access_scope_guest_kind();

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
    and guest_kind in ('invited', 'plus_one')
    and invite_status = 'not replied';
$$;

revoke execute on function public.mark_invite_opened(uuid, uuid) from public;
grant execute on function public.mark_invite_opened(uuid, uuid) to service_role;
