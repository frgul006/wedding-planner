create table public.rsvp_responses (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  guest_id uuid not null,
  attendance text not null check (attendance in ('yes', 'no', 'maybe')),
  extra_guests integer not null default 0 check (extra_guests >= 0),
  food_preference text,
  allergy_notes text,
  updated_via_token_id uuid references public.invite_tokens(id) on delete set null,
  last_submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvp_responses_guest_wedding_fk
    foreign key (guest_id, wedding_id)
    references public.guests(id, wedding_id)
    on delete cascade
);

create unique index rsvp_responses_guest_id_key on public.rsvp_responses(guest_id);
create index rsvp_responses_wedding_attendance_idx
on public.rsvp_responses(wedding_id, attendance);
create index rsvp_responses_updated_via_token_idx
on public.rsvp_responses(updated_via_token_id);

create trigger set_rsvp_responses_updated_at
before update on public.rsvp_responses
for each row
execute function public.set_updated_at();

alter table public.rsvp_responses enable row level security;

create policy "Active admins can view RSVP responses for their wedding"
on public.rsvp_responses
for select
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can create RSVP responses for their wedding"
on public.rsvp_responses
for insert
to authenticated
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can update RSVP responses for their wedding"
on public.rsvp_responses
for update
to authenticated
using (public.is_active_admin_for_wedding(wedding_id))
with check (public.is_active_admin_for_wedding(wedding_id));

create policy "Active admins can delete RSVP responses for their wedding"
on public.rsvp_responses
for delete
to authenticated
using (public.is_active_admin_for_wedding(wedding_id));

create or replace function public.submit_rsvp_response(
  p_token_hash text,
  p_attendance text,
  p_extra_guests integer,
  p_food_preference text,
  p_allergy_notes text
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
begin
  if p_attendance not in ('yes', 'no', 'maybe') then
    raise exception 'Invalid attendance' using errcode = '22023';
  end if;

  if p_extra_guests is null or p_extra_guests < 0 then
    raise exception 'Invalid extra guest count' using errcode = '22023';
  end if;

  select invite_tokens.id, invite_tokens.guest_id, invite_tokens.wedding_id
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

  insert into public.rsvp_responses (
    wedding_id,
    guest_id,
    attendance,
    extra_guests,
    food_preference,
    allergy_notes,
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
    token_record.id,
    submitted_at
  )
  on conflict (guest_id) do update set
    wedding_id = excluded.wedding_id,
    attendance = excluded.attendance,
    extra_guests = excluded.extra_guests,
    food_preference = excluded.food_preference,
    allergy_notes = excluded.allergy_notes,
    updated_via_token_id = excluded.updated_via_token_id,
    last_submitted_at = excluded.last_submitted_at;

  update public.guests
  set invite_status = 'rsvp ' || p_attendance
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

revoke execute on function public.submit_rsvp_response(text, text, integer, text, text) from public;
grant execute on function public.submit_rsvp_response(text, text, integer, text, text) to service_role;
