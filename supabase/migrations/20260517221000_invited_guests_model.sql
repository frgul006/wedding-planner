-- Split durable RSVP status from Invite opened activity for Invited Guests.

alter table public.guests
  add column guest_kind text not null default 'invited',
  add column rsvp_status text not null default 'not replied';

comment on column public.guests.guest_kind is
  'Durable Guest kind. Existing roster Guests are Invited Guests with full Invite access.';
comment on column public.guests.invite_status is
  'Opened-Invite activity only: not replied until first valid Invite open, then opened.';
comment on column public.guests.rsvp_status is
  'Dedicated RSVP status, separate from opened-Invite activity.';

update public.guests
set rsvp_status = invite_status
where invite_status in ('rsvp yes', 'rsvp no', 'rsvp maybe');

update public.guests
set invite_status = 'opened'
where invite_status in ('rsvp yes', 'rsvp no', 'rsvp maybe');

alter table public.guests
  drop constraint if exists guests_invite_status_check,
  add constraint guests_guest_kind_check
    check (guest_kind in ('invited')),
  add constraint guests_invite_status_check
    check (invite_status in ('not replied', 'opened')),
  add constraint guests_rsvp_status_check
    check (rsvp_status in ('not replied', 'rsvp yes', 'rsvp no', 'rsvp maybe'));

create index guests_guest_kind_idx
on public.guests(wedding_id, guest_kind)
where deleted_at is null;

create index guests_rsvp_status_idx
on public.guests(wedding_id, rsvp_status)
where deleted_at is null;

alter table public.invite_tokens
  add column access_scope text not null default 'full',
  add constraint invite_tokens_access_scope_check
    check (access_scope in ('full'));

comment on column public.invite_tokens.access_scope is
  'Invite access scope. Existing active Invite tokens default to full Invite access.';

create index invite_tokens_access_scope_idx
on public.invite_tokens(wedding_id, access_scope)
where is_active = true;

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
    and guest_kind = 'invited'
    and invite_status = 'not replied';
$$;

revoke execute on function public.mark_invite_opened(uuid, uuid) from public;
grant execute on function public.mark_invite_opened(uuid, uuid) to service_role;

create or replace function public.submit_rsvp_response(
  p_token_hash text,
  p_attendance text,
  p_extra_guests integer,
  p_food_preference text,
  p_allergy_notes text,
  p_phone text,
  p_sms_opt_in boolean,
  p_plus_one_name text default null,
  p_plus_one_email text default null,
  p_plus_one_phone text default null,
  p_plus_one_food_preference text default null,
  p_plus_one_allergy_notes text default null,
  p_plus_one_sms_opt_in boolean default false
)
returns table (
  submitted_guest_id uuid,
  submitted_wedding_id uuid,
  updated_invite_status text
)
language plpgsql
set search_path = public
as $$
declare
  token_record record;
  submitted_at timestamptz := now();
  normalized_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  normalized_sms_opt_in boolean := coalesce(p_sms_opt_in, false);
  normalized_plus_one_name text := nullif(btrim(coalesce(p_plus_one_name, '')), '');
  normalized_plus_one_email text := nullif(btrim(coalesce(p_plus_one_email, '')), '');
  normalized_plus_one_phone text := nullif(btrim(coalesce(p_plus_one_phone, '')), '');
  normalized_plus_one_food_preference text := nullif(btrim(coalesce(p_plus_one_food_preference, '')), '');
  normalized_plus_one_allergy_notes text := nullif(btrim(coalesce(p_plus_one_allergy_notes, '')), '');
  normalized_plus_one_sms_opt_in boolean := coalesce(p_plus_one_sms_opt_in, false);
  plus_one_requested boolean := false;
begin
  if p_attendance not in ('yes', 'no', 'maybe') then
    raise exception 'Invalid attendance' using errcode = '22023';
  end if;

  if p_extra_guests is null or p_extra_guests not in (0, 1) then
    raise exception 'Invalid extra guest count' using errcode = '22023';
  end if;

  plus_one_requested := p_extra_guests > 0;

  if normalized_phone is not null and normalized_phone !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone' using errcode = '22023';
  end if;

  if normalized_plus_one_phone is not null
    and normalized_plus_one_phone !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception 'Invalid plus-one phone' using errcode = '22023';
  end if;

  if normalized_plus_one_sms_opt_in = true and normalized_plus_one_phone is null then
    raise exception 'Plus-one SMS consent requires phone' using errcode = '22023';
  end if;

  select invite_tokens.id,
    invite_tokens.guest_id,
    invite_tokens.wedding_id,
    guests.plus_one_allowed
  into token_record
  from public.invite_tokens
  inner join public.guests
    on guests.id = invite_tokens.guest_id
    and guests.wedding_id = invite_tokens.wedding_id
  where invite_tokens.token_hash = p_token_hash
    and invite_tokens.is_active = true
    and invite_tokens.access_scope = 'full'
    and guests.guest_kind = 'invited'
    and guests.deleted_at is null;

  if not found then
    raise exception 'Invite token not valid' using errcode = 'P0002';
  end if;

  if plus_one_requested = true and token_record.plus_one_allowed = false then
    raise exception 'Plus-one not allowed for guest' using errcode = '42501';
  end if;

  if plus_one_requested = true and normalized_plus_one_name is null then
    raise exception 'Plus-one name required' using errcode = '22023';
  end if;

  insert into public.rsvp_responses (
    wedding_id,
    guest_id,
    attendance,
    extra_guests,
    food_preference,
    allergy_notes,
    plus_one_name,
    plus_one_email,
    plus_one_phone,
    plus_one_food_preference,
    plus_one_allergy_notes,
    plus_one_sms_opt_in,
    plus_one_sms_opted_in_at,
    plus_one_sms_opted_out_at,
    updated_via_token_id,
    last_submitted_at
  )
  values (
    token_record.wedding_id,
    token_record.guest_id,
    p_attendance,
    p_extra_guests,
    nullif(btrim(coalesce(p_food_preference, '')), ''),
    nullif(btrim(coalesce(p_allergy_notes, '')), ''),
    case when plus_one_requested = true then normalized_plus_one_name else null end,
    case when plus_one_requested = true then normalized_plus_one_email else null end,
    case when plus_one_requested = true then normalized_plus_one_phone else null end,
    case when plus_one_requested = true then normalized_plus_one_food_preference else null end,
    case when plus_one_requested = true then normalized_plus_one_allergy_notes else null end,
    case when plus_one_requested = true then normalized_plus_one_sms_opt_in else false end,
    case when plus_one_requested = true and normalized_plus_one_sms_opt_in = true then submitted_at else null end,
    null,
    token_record.id,
    submitted_at
  )
  on conflict (guest_id) do update set
    wedding_id = excluded.wedding_id,
    attendance = excluded.attendance,
    extra_guests = excluded.extra_guests,
    food_preference = excluded.food_preference,
    allergy_notes = excluded.allergy_notes,
    plus_one_name = case
      when plus_one_requested = true then excluded.plus_one_name
      else null
    end,
    plus_one_email = case
      when plus_one_requested = true then excluded.plus_one_email
      else null
    end,
    plus_one_phone = case
      when plus_one_requested = true then excluded.plus_one_phone
      else null
    end,
    plus_one_food_preference = case
      when plus_one_requested = true then excluded.plus_one_food_preference
      else null
    end,
    plus_one_allergy_notes = case
      when plus_one_requested = true then excluded.plus_one_allergy_notes
      else null
    end,
    plus_one_sms_opt_in = case
      when plus_one_requested = true then excluded.plus_one_sms_opt_in
      else false
    end,
    plus_one_sms_opted_in_at = case
      when plus_one_requested = false
        then null
      when excluded.plus_one_sms_opt_in = true
        then coalesce(rsvp_responses.plus_one_sms_opted_in_at, submitted_at)
      else rsvp_responses.plus_one_sms_opted_in_at
    end,
    plus_one_sms_opted_out_at = case
      when plus_one_requested = false
        then case when rsvp_responses.plus_one_sms_opt_in = true then submitted_at else null end
      when excluded.plus_one_sms_opt_in = true
        then null
      when rsvp_responses.plus_one_sms_opt_in = true
        then submitted_at
      else rsvp_responses.plus_one_sms_opted_out_at
    end,
    updated_via_token_id = excluded.updated_via_token_id,
    last_submitted_at = excluded.last_submitted_at;

  update public.guests
  set invite_status = case
        when invite_status = 'not replied' then 'opened'
        else invite_status
      end,
      rsvp_status = 'rsvp ' || p_attendance,
      phone = case
        when normalized_phone is null
          and nullif(btrim(coalesce(email, '')), '') is null
          then phone
        else normalized_phone
      end,
      sms_opt_in = normalized_sms_opt_in,
      sms_opted_in_at = case
        when normalized_sms_opt_in = true
          then coalesce(sms_opted_in_at, submitted_at)
        else sms_opted_in_at
      end,
      sms_opted_out_at = case
        when normalized_sms_opt_in = true
          then null
        when sms_opt_in = true
          then submitted_at
        else sms_opted_out_at
      end
  where id = token_record.guest_id
    and wedding_id = token_record.wedding_id
    and deleted_at is null
    and guest_kind = 'invited';

  if not found then
    raise exception 'Invite token not valid' using errcode = 'P0002';
  end if;

  submitted_guest_id := token_record.guest_id;
  submitted_wedding_id := token_record.wedding_id;
  updated_invite_status := 'rsvp ' || p_attendance;
  return next;
end;
$$;

revoke execute on function public.submit_rsvp_response(
  text,
  text,
  integer,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  boolean
) from public;
grant execute on function public.submit_rsvp_response(
  text,
  text,
  integer,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  boolean
) to service_role;
