-- Sync future RSVP plus-one details into RSVP-managed Plus-one Guest rows.

alter table public.guests
  add column invited_guest_id uuid,
  add column rsvp_managed boolean not null default false;

comment on column public.guests.invited_guest_id is
  'For Plus-one Guests, the Invited Guest whose RSVP manages this Guest.';
comment on column public.guests.rsvp_managed is
  'True when this Plus-one Guest identity/contact data is owned by RSVP sync.';

alter table public.guests
  drop constraint if exists guests_guest_kind_check,
  add constraint guests_guest_kind_check
    check (guest_kind in ('invited', 'plus_one'));

alter table public.guests
  drop constraint if exists guests_check,
  add constraint guests_invited_contact_required_check check (
    guest_kind <> 'invited'
    or nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  ),
  add constraint guests_invited_guest_id_by_kind_check check (
    (guest_kind = 'invited' and invited_guest_id is null)
    or (guest_kind = 'plus_one' and invited_guest_id is not null)
  ),
  add constraint guests_rsvp_managed_plus_one_check check (
    rsvp_managed = false or guest_kind = 'plus_one'
  );

alter table public.guests
  add constraint guests_invited_guest_fk
  foreign key (invited_guest_id, wedding_id)
  references public.guests(id, wedding_id)
  on delete cascade;

create index guests_invited_guest_idx
on public.guests(wedding_id, invited_guest_id)
where guest_kind = 'plus_one';

create unique index guests_one_rsvp_managed_plus_one_per_invited_idx
on public.guests(wedding_id, invited_guest_id)
where guest_kind = 'plus_one'
  and rsvp_managed = true;

create or replace function public.enforce_plus_one_invited_guest()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tied_guest_kind text;
begin
  if new.guest_kind = 'plus_one' then
    if new.invited_guest_id is null then
      raise exception 'Plus-one Guest requires tied Invited Guest' using errcode = '23514';
    end if;

    if new.invited_guest_id = new.id then
      raise exception 'Plus-one Guest cannot be tied to itself' using errcode = '23514';
    end if;

    select guest_kind
    into tied_guest_kind
    from public.guests
    where id = new.invited_guest_id
      and wedding_id = new.wedding_id;

    if tied_guest_kind is distinct from 'invited' then
      raise exception 'Plus-one Guest must be tied to an Invited Guest' using errcode = '23514';
    end if;
  elsif new.invited_guest_id is not null then
    raise exception 'Invited Guest cannot be tied to another Guest' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_plus_one_invited_guest on public.guests;
create trigger enforce_plus_one_invited_guest
before insert or update of guest_kind, invited_guest_id, wedding_id
on public.guests
for each row
execute function public.enforce_plus_one_invited_guest();

alter table public.invite_tokens
  drop constraint if exists invite_tokens_access_scope_check,
  add constraint invite_tokens_access_scope_check
    check (access_scope in ('full', 'scoped'));

comment on column public.invite_tokens.access_scope is
  'Invite access scope. Full grants Invited Guest RSVP access; scoped is reserved for Plus-one Guest read-only Invite access.';

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

  if plus_one_requested = true then
    insert into public.guests (
      wedding_id,
      full_name,
      email,
      phone,
      guest_kind,
      invited_guest_id,
      rsvp_managed,
      invite_status,
      rsvp_status,
      plus_one_allowed,
      sms_opt_in,
      sms_opted_in_at,
      sms_opted_out_at,
      deleted_at
    )
    values (
      token_record.wedding_id,
      normalized_plus_one_name,
      normalized_plus_one_email,
      normalized_plus_one_phone,
      'plus_one',
      token_record.guest_id,
      true,
      'not replied',
      'rsvp ' || p_attendance,
      false,
      normalized_plus_one_sms_opt_in,
      case when normalized_plus_one_sms_opt_in = true then submitted_at else null end,
      null,
      null
    )
    on conflict (wedding_id, invited_guest_id)
      where guest_kind = 'plus_one' and rsvp_managed = true
    do update set
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      rsvp_status = excluded.rsvp_status,
      plus_one_allowed = false,
      sms_opt_in = excluded.sms_opt_in,
      sms_opted_in_at = case
        when excluded.sms_opt_in = true
          then coalesce(guests.sms_opted_in_at, submitted_at)
        else guests.sms_opted_in_at
      end,
      sms_opted_out_at = case
        when excluded.sms_opt_in = true
          then null
        when guests.sms_opt_in = true
          then submitted_at
        else guests.sms_opted_out_at
      end,
      deleted_at = null;
  else
    with tied_plus_one as (
      update public.guests
      set deleted_at = coalesce(deleted_at, submitted_at),
          sms_opt_in = false,
          sms_opted_out_at = case
            when sms_opt_in = true then submitted_at
            else sms_opted_out_at
          end
      where wedding_id = token_record.wedding_id
        and invited_guest_id = token_record.guest_id
        and guest_kind = 'plus_one'
        and rsvp_managed = true
      returning id
    )
    update public.invite_tokens
    set is_active = false,
        invalidated_at = submitted_at,
        regenerated_at = submitted_at
    where wedding_id = token_record.wedding_id
      and access_scope = 'scoped'
      and is_active = true
      and guest_id in (select id from tied_plus_one);
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
