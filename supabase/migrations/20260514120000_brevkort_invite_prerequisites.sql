alter table public.weddings
add column venue_area text,
add column dress_code text,
add column child_policy text,
add column invite_support_email text;

comment on column public.weddings.venue_area is
  'Short place/city label for Brevkort invite details, e.g. Johanneshov.';
comment on column public.weddings.time_plan is
  'Structured JSON array of time-plan rows, e.g. [{"time":"16:30","label":"Välkomstdrinkar"}].';
comment on column public.weddings.dress_code is
  'Brevkort invite dress-code text shown on the details panel.';
comment on column public.weddings.child_policy is
  'Brevkort invite child-policy text shown on the details panel.';
comment on column public.weddings.invite_support_email is
  'Public support contact shown on invalid invite-link pages.';

alter table public.weddings
add constraint weddings_time_plan_array_check check (jsonb_typeof(time_plan) = 'array');

alter table public.guests
add column plus_one_allowed boolean not null default false;

comment on column public.guests.plus_one_allowed is
  'Controls whether this guest sees the Brevkort +1 option on their invite.';

alter table public.guests
add constraint guests_phone_e164_or_blank_check check (
  nullif(btrim(coalesce(phone, '')), '') is null
  or phone ~ '^[+][1-9][0-9]{7,14}$'
) not valid;

alter table public.rsvp_responses
add column plus_one_name text,
add column plus_one_email text,
add column plus_one_phone text,
add column plus_one_food_preference text,
add column plus_one_allergy_notes text,
add column plus_one_sms_opt_in boolean not null default false,
add column plus_one_sms_opted_in_at timestamptz,
add column plus_one_sms_opted_out_at timestamptz;

comment on column public.rsvp_responses.extra_guests is
  'Legacy/simple count. Brevkort +1 uses explicit plus_one_* fields and keeps this as 0 or 1.';
comment on column public.rsvp_responses.plus_one_name is
  'Named +1 guest full name for Brevkort RSVP responses.';
comment on column public.rsvp_responses.plus_one_email is
  'Optional +1 guest email for Brevkort RSVP responses.';
comment on column public.rsvp_responses.plus_one_phone is
  'Optional +1 guest compact E.164 phone number, e.g. +46701234567.';
comment on column public.rsvp_responses.plus_one_food_preference is
  'Optional +1 guest food preference for Brevkort RSVP responses.';
comment on column public.rsvp_responses.plus_one_allergy_notes is
  'Optional +1 guest allergy or special notes for Brevkort RSVP responses.';
comment on column public.rsvp_responses.plus_one_sms_opt_in is
  'Separate SMS consent for the named +1 guest.';

alter table public.rsvp_responses
add constraint rsvp_responses_plus_one_phone_e164_or_blank_check check (
  nullif(btrim(coalesce(plus_one_phone, '')), '') is null
  or plus_one_phone ~ '^[+][1-9][0-9]{7,14}$'
),
add constraint rsvp_responses_plus_one_sms_requires_phone_check check (
  plus_one_sms_opt_in = false
  or nullif(btrim(coalesce(plus_one_phone, '')), '') is not null
),
add constraint rsvp_responses_plus_one_sms_requires_timestamp_check check (
  plus_one_sms_opt_in = false
  or plus_one_sms_opted_in_at is not null
);

drop function if exists public.submit_rsvp_response(text, text, integer, text, text);
drop function if exists public.submit_rsvp_response(text, text, integer, text, text, text);
drop function if exists public.submit_rsvp_response(text, text, integer, text, text, text, boolean);

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
  has_plus_one_payload boolean;
begin
  has_plus_one_payload := normalized_plus_one_name is not null
    or normalized_plus_one_email is not null
    or normalized_plus_one_phone is not null
    or normalized_plus_one_food_preference is not null
    or normalized_plus_one_allergy_notes is not null
    or normalized_plus_one_sms_opt_in = true;

  if p_attendance not in ('yes', 'no', 'maybe') then
    raise exception 'Invalid attendance' using errcode = '22023';
  end if;

  if p_extra_guests is null or p_extra_guests < 0 then
    raise exception 'Invalid extra guest count' using errcode = '22023';
  end if;

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
    and guests.deleted_at is null;

  if not found then
    raise exception 'Invite token not valid' using errcode = 'P0002';
  end if;

  if has_plus_one_payload = true and token_record.plus_one_allowed = false then
    raise exception 'Plus-one not allowed for guest' using errcode = '42501';
  end if;

  if has_plus_one_payload = true and normalized_plus_one_name is null then
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
    normalized_plus_one_name,
    normalized_plus_one_email,
    normalized_plus_one_phone,
    normalized_plus_one_food_preference,
    normalized_plus_one_allergy_notes,
    normalized_plus_one_sms_opt_in,
    case when normalized_plus_one_sms_opt_in = true then submitted_at else null end,
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
      when has_plus_one_payload = true then excluded.plus_one_name
      else rsvp_responses.plus_one_name
    end,
    plus_one_email = case
      when has_plus_one_payload = true then excluded.plus_one_email
      else rsvp_responses.plus_one_email
    end,
    plus_one_phone = case
      when has_plus_one_payload = true then excluded.plus_one_phone
      else rsvp_responses.plus_one_phone
    end,
    plus_one_food_preference = case
      when has_plus_one_payload = true then excluded.plus_one_food_preference
      else rsvp_responses.plus_one_food_preference
    end,
    plus_one_allergy_notes = case
      when has_plus_one_payload = true then excluded.plus_one_allergy_notes
      else rsvp_responses.plus_one_allergy_notes
    end,
    plus_one_sms_opt_in = case
      when has_plus_one_payload = true then excluded.plus_one_sms_opt_in
      else rsvp_responses.plus_one_sms_opt_in
    end,
    plus_one_sms_opted_in_at = case
      when has_plus_one_payload = false
        then rsvp_responses.plus_one_sms_opted_in_at
      when excluded.plus_one_sms_opt_in = true
        then coalesce(rsvp_responses.plus_one_sms_opted_in_at, submitted_at)
      else rsvp_responses.plus_one_sms_opted_in_at
    end,
    plus_one_sms_opted_out_at = case
      when has_plus_one_payload = false
        then rsvp_responses.plus_one_sms_opted_out_at
      when excluded.plus_one_sms_opt_in = true
        then null
      when rsvp_responses.plus_one_sms_opt_in = true
        then submitted_at
      else rsvp_responses.plus_one_sms_opted_out_at
    end,
    updated_via_token_id = excluded.updated_via_token_id,
    last_submitted_at = excluded.last_submitted_at;

  update public.guests
  set invite_status = 'rsvp ' || p_attendance,
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
    and deleted_at is null;

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
