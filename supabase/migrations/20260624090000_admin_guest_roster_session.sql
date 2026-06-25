create or replace function public.save_admin_guest_roster_session(
  p_wedding_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  normalized_changes jsonb := '[]'::jsonb;
  errors jsonb := '{}'::jsonb;
  saved_count integer := 0;
  v_draft_id text;
  v_email text;
  v_expected_updated_at timestamptz;
  v_full_name text;
  v_id uuid;
  v_index integer := 0;
  v_notes text;
  v_phone text;
  v_plus_one_allowed boolean;
  v_row_key text;
  v_sms_opt_in boolean;
  v_now timestamptz := now();
  current_guest record;
begin
  if not public.is_active_admin_for_wedding(p_wedding_id) then
    raise exception 'Not allowed to save Admin Guest roster session' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return jsonb_build_object(
      'status', 'validation-error',
      'message', 'Ogiltigt ändringspaket.',
      'errors', jsonb_build_object('_session', jsonb_build_object('row', 'Ogiltigt ändringspaket.'))
    );
  end if;

  for item in select value from jsonb_array_elements(p_changes) as changes(value) loop
    v_index := v_index + 1;
    v_id := null;
    v_draft_id := nullif(btrim(coalesce(item->>'draft_id', '')), '');
    v_row_key := nullif(btrim(coalesce(item->>'row_key', '')), '');
    v_full_name := nullif(btrim(coalesce(item->>'full_name', '')), '');
    v_email := nullif(btrim(coalesce(item->>'email', '')), '');
    v_phone := nullif(btrim(coalesce(item->>'phone', '')), '');
    v_notes := nullif(btrim(coalesce(item->>'notes', '')), '');
    v_plus_one_allowed := coalesce((item->>'plus_one_allowed')::boolean, false);
    v_sms_opt_in := coalesce((item->>'sms_opt_in')::boolean, false);
    v_expected_updated_at := null;

    if nullif(btrim(coalesce(item->>'id', '')), '') is not null then
      v_id := (item->>'id')::uuid;
    end if;

    if nullif(btrim(coalesce(item->>'expected_updated_at', '')), '') is not null then
      v_expected_updated_at := (item->>'expected_updated_at')::timestamptz;
    end if;

    v_row_key := coalesce(v_row_key, v_id::text, v_draft_id, 'row-' || v_index::text);

    if v_full_name is null then
      errors := errors || jsonb_build_object(
        v_row_key,
        coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('fullName', 'Namn krävs.')
      );
    end if;

    if v_email is null and v_phone is null then
      errors := errors || jsonb_build_object(
        v_row_key,
        coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('contact', 'Ange e-post eller telefonnummer.')
      );
    end if;

    if v_sms_opt_in and (v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$') then
      errors := errors || jsonb_build_object(
        v_row_key,
        coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('phone', 'SMS kräver telefonnummer i format +46701234567.')
      );
    end if;

    if v_id is null and v_draft_id is null then
      errors := errors || jsonb_build_object(
        v_row_key,
        coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('row', 'Ny rad saknar utkast-id.')
      );
    end if;

    if v_id is not null then
      select
        id,
        rsvp_managed,
        sms_opt_in,
        sms_opted_in_at,
        sms_opted_out_at,
        updated_at
      into current_guest
      from public.guests
      where id = v_id
        and wedding_id = p_wedding_id
        and deleted_at is null
      for update;

      if not found then
        errors := errors || jsonb_build_object(
          v_row_key,
          coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('row', 'Gästen finns inte längre.')
        );
      elsif current_guest.rsvp_managed then
        errors := errors || jsonb_build_object(
          v_row_key,
          coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('row', 'OSA-styrda Plus-one Gäster kan inte ändras här.')
        );
      elsif v_expected_updated_at is null then
        errors := errors || jsonb_build_object(
          v_row_key,
          coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('row', 'Raden saknar versionsstämpel. Ladda om sidan.')
        );
      elsif current_guest.updated_at <> v_expected_updated_at then
        errors := errors || jsonb_build_object(
          v_row_key,
          coalesce(errors->v_row_key, '{}'::jsonb) || jsonb_build_object('row', 'Raden ändrades av någon annan. Ladda om innan du sparar.')
        );
      end if;
    end if;

    normalized_changes := normalized_changes || jsonb_build_array(jsonb_build_object(
      'draft_id', v_draft_id,
      'email', v_email,
      'expected_updated_at', case when v_expected_updated_at is null then null else v_expected_updated_at::text end,
      'full_name', v_full_name,
      'id', case when v_id is null then null else v_id::text end,
      'notes', v_notes,
      'phone', v_phone,
      'plus_one_allowed', v_plus_one_allowed,
      'row_key', v_row_key,
      'sms_opt_in', v_sms_opt_in
    ));
  end loop;

  if errors <> '{}'::jsonb then
    return jsonb_build_object(
      'status', 'validation-error',
      'message', 'Rätta markerade fält innan du sparar.',
      'errors', errors
    );
  end if;

  for item in select value from jsonb_array_elements(normalized_changes) as changes(value) loop
    v_id := null;
    v_full_name := item->>'full_name';
    v_email := nullif(btrim(coalesce(item->>'email', '')), '');
    v_phone := nullif(btrim(coalesce(item->>'phone', '')), '');
    v_notes := nullif(btrim(coalesce(item->>'notes', '')), '');
    v_plus_one_allowed := coalesce((item->>'plus_one_allowed')::boolean, false);
    v_sms_opt_in := coalesce((item->>'sms_opt_in')::boolean, false);

    if nullif(btrim(coalesce(item->>'id', '')), '') is not null then
      v_id := (item->>'id')::uuid;
    end if;

    if v_id is null then
      insert into public.guests (
        wedding_id,
        full_name,
        email,
        phone,
        notes,
        plus_one_allowed,
        sms_opt_in,
        sms_opted_in_at,
        sms_opted_out_at
      ) values (
        p_wedding_id,
        v_full_name,
        v_email,
        v_phone,
        v_notes,
        v_plus_one_allowed,
        v_sms_opt_in,
        case when v_sms_opt_in then v_now else null end,
        null
      );
      saved_count := saved_count + 1;
    else
      update public.guests
      set
        full_name = v_full_name,
        email = v_email,
        phone = v_phone,
        notes = v_notes,
        plus_one_allowed = v_plus_one_allowed,
        sms_opt_in = v_sms_opt_in,
        sms_opted_in_at = case
          when v_sms_opt_in then coalesce(sms_opted_in_at, v_now)
          else sms_opted_in_at
        end,
        sms_opted_out_at = case
          when v_sms_opt_in then null
          when sms_opt_in then v_now
          else sms_opted_out_at
        end
      where id = v_id
        and wedding_id = p_wedding_id
        and deleted_at is null
        and rsvp_managed = false;
      saved_count := saved_count + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'success', 'saved_count', saved_count);
end;
$$;

revoke execute on function public.save_admin_guest_roster_session(uuid, jsonb) from public;
grant execute on function public.save_admin_guest_roster_session(uuid, jsonb) to authenticated;

create or replace function public.archive_admin_guests_lifecycle(
  p_wedding_id uuid,
  p_guest_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_at timestamptz := now();
  archived_count integer := 0;
  archived_guest_ids uuid[] := '{}'::uuid[];
  errors jsonb := '{}'::jsonb;
  revoked_count integer := 0;
  v_guest_id uuid;
begin
  if not public.is_active_admin_for_wedding(p_wedding_id) then
    raise exception 'Not allowed to archive Guests' using errcode = '42501';
  end if;

  if p_guest_ids is null or array_length(p_guest_ids, 1) is null then
    return jsonb_build_object('status', 'success', 'archived_count', 0, 'archived_guest_ids', '[]'::jsonb, 'revoked_scoped_token_count', 0);
  end if;

  for v_guest_id in select distinct unnest(p_guest_ids) loop
    perform 1
    from public.guests
    where id = v_guest_id
      and wedding_id = p_wedding_id
      and deleted_at is null
    for update;

    if not found then
      errors := errors || jsonb_build_object(
        v_guest_id::text,
        jsonb_build_object('row', 'Gästen finns inte längre eller är redan arkiverad.')
      );
    end if;
  end loop;

  if errors <> '{}'::jsonb then
    return jsonb_build_object(
      'status', 'validation-error',
      'message', 'Ingen Gäst arkiverades.',
      'errors', errors
    );
  end if;

  with target_guests as (
    select id, guest_kind
    from public.guests
    where wedding_id = p_wedding_id
      and deleted_at is null
      and id = any(p_guest_ids)
  ),
  archived_primary as (
    update public.guests guests
    set deleted_at = archived_at
    from target_guests
    where guests.id = target_guests.id
      and guests.wedding_id = p_wedding_id
      and guests.deleted_at is null
    returning guests.id
  ),
  archived_tied_plus_ones as (
    update public.guests guests
    set deleted_at = archived_at
    where guests.wedding_id = p_wedding_id
      and guests.deleted_at is null
      and guests.guest_kind = 'plus_one'
      and guests.rsvp_managed = true
      and guests.invited_guest_id in (
        select id from target_guests where guest_kind = 'invited'
      )
    returning guests.id
  ),
  archived_guests as (
    select id from archived_primary
    union
    select id from archived_tied_plus_ones
  ),
  revoked_scoped_tokens as (
    update public.invite_tokens tokens
    set
      invalidated_at = archived_at,
      is_active = false,
      regenerated_at = archived_at
    where tokens.wedding_id = p_wedding_id
      and tokens.access_scope = 'scoped'
      and tokens.is_active = true
      and tokens.guest_id in (select id from archived_guests)
    returning tokens.id
  )
  select
    (select count(*)::integer from archived_guests),
    (select coalesce(array_agg(id), '{}'::uuid[]) from archived_guests),
    (select count(*)::integer from revoked_scoped_tokens)
  into archived_count, archived_guest_ids, revoked_count;

  return jsonb_build_object(
    'status', 'success',
    'archived_count', archived_count,
    'archived_guest_ids', to_jsonb(archived_guest_ids),
    'revoked_scoped_token_count', revoked_count
  );
end;
$$;

revoke execute on function public.archive_admin_guests_lifecycle(uuid, uuid[]) from public;
grant execute on function public.archive_admin_guests_lifecycle(uuid, uuid[]) to authenticated;
