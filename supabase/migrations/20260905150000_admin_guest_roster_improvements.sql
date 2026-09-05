-- Admin notes belong to admins, including on RSVP-managed +1 Guests.
-- RSVP attendance remains one shared response for an Invited Guest and their +1.
create or replace function public.save_admin_guest_roster_session(p_wedding_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  normalized jsonb := '[]'::jsonb;
  errors jsonb := '{}'::jsonb;
  row_errors jsonb;
  current_guest public.guests%rowtype;
  v_id uuid;
  v_key text;
  v_name text;
  v_email text;
  v_phone text;
  v_notes text;
  v_status text;
  v_sms boolean;
  v_plus_one boolean;
  v_expected timestamptz;
  seen_ids uuid[] := '{}';
  seen_keys text[] := '{}';
  v_now timestamptz := now();
  saved_count integer := 0;
begin
  if not public.is_active_admin_for_wedding(p_wedding_id) then
    raise exception 'Not allowed to save Admin Guest roster session' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return jsonb_build_object('status', 'validation-error', 'message', 'Ogiltigt ändringspaket.', 'errors', '{}'::jsonb);
  end if;
  -- Consistent lock order, including companions changed by a parent RSVP update.
  perform id from public.guests
    where wedding_id = p_wedding_id and deleted_at is null
    order by id for update;

  for item in select value from jsonb_array_elements(p_changes) loop
    v_key := coalesce(nullif(item->>'row_key', ''), '_session');
    row_errors := '{}'::jsonb;
    v_id := null;
    v_expected := null;
    begin
      v_id := nullif(item->>'id', '')::uuid;
      v_expected := nullif(item->>'expected_updated_at', '')::timestamptz;
      v_sms := coalesce((item->>'sms_opt_in')::boolean, false);
      v_plus_one := coalesce((item->>'plus_one_allowed')::boolean, false);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('status', 'validation-error', 'message', 'Ogiltigt ändringspaket.', 'errors', jsonb_build_object(v_key, jsonb_build_object('row', 'Ogiltiga fältvärden.')));
    end;
    v_name := nullif(btrim(item->>'full_name'), '');
    v_email := nullif(btrim(item->>'email'), '');
    v_phone := nullif(btrim(item->>'phone'), '');
    v_notes := nullif(btrim(item->>'notes'), '');
    v_status := coalesce(item->>'rsvp_status', 'not replied');
    if v_id = any(seen_ids) or v_key = any(seen_keys) then
      row_errors := row_errors || jsonb_build_object('row', 'Samma gäst förekommer flera gånger.');
    end if;
    seen_keys := array_append(seen_keys, v_key);
    if v_id is not null then seen_ids := array_append(seen_ids, v_id); end if;
    if v_name is null then row_errors := row_errors || jsonb_build_object('fullName', 'Namn krävs.'); end if;
    if v_status not in ('not replied', 'rsvp yes', 'rsvp no', 'rsvp maybe') then
      row_errors := row_errors || jsonb_build_object('row', 'Ogiltigt OSA-svar.');
    end if;
    if v_sms and (v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$') then
      row_errors := row_errors || jsonb_build_object('phone', 'SMS kräver ett giltigt telefonnummer.');
    end if;
    current_guest := null;
    if v_id is not null then
      select * into current_guest from public.guests
        where id = v_id and wedding_id = p_wedding_id and deleted_at is null;
      if not found then
        row_errors := row_errors || jsonb_build_object('row', 'Gästen finns inte längre.');
      else
        if not (item ? 'rsvp_status') then v_status := current_guest.rsvp_status; end if;
        if v_expected is null or v_expected <> current_guest.updated_at then
          row_errors := row_errors || jsonb_build_object('row', 'Raden ändrades av någon annan. Ladda om innan du sparar.');
        end if;
        if current_guest.rsvp_managed and (
          v_name is distinct from current_guest.full_name or
          v_email is distinct from current_guest.email or
          v_phone is distinct from current_guest.phone or
          v_sms is distinct from current_guest.sms_opt_in or
          v_plus_one is distinct from current_guest.plus_one_allowed
        ) then
          row_errors := row_errors || jsonb_build_object('row', 'Kontaktuppgifter för +1 ändras via den inbjudna gästens OSA.');
        end if;
        if current_guest.guest_kind = 'plus_one' and v_status <> current_guest.rsvp_status then
          row_errors := row_errors || jsonb_build_object('row', 'Ändra OSA på den inbjudna gästen; svaret gäller även +1.');
        end if;
        if v_status = 'not replied' and current_guest.rsvp_status <> 'not replied' then
          row_errors := row_errors || jsonb_build_object('row', 'Välj Ja, Nej eller Kanske. Ett sparat OSA-svar kan inte raderas här.');
        end if;
      end if;
    elsif nullif(item->>'draft_id', '') is null then
      row_errors := row_errors || jsonb_build_object('row', 'Ny rad saknar utkast-id.');
    end if;
    if (v_id is null or current_guest.guest_kind = 'invited') and v_email is null and v_phone is null then
      row_errors := row_errors || jsonb_build_object('contact', 'Ange e-post eller telefonnummer.');
    end if;
    if current_guest.guest_kind = 'plus_one' and v_plus_one then
      row_errors := row_errors || jsonb_build_object('row', 'En +1 kan inte bjuda in ytterligare gäster.');
    end if;
    if row_errors <> '{}'::jsonb then errors := errors || jsonb_build_object(v_key, row_errors); end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'full_name', v_name, 'email', v_email, 'phone', v_phone, 'notes', v_notes,
      'sms_opt_in', v_sms, 'plus_one_allowed', v_plus_one, 'rsvp_status', v_status,
      'rsvp_changed', v_status is distinct from coalesce(current_guest.rsvp_status, 'not replied')
    ));
  end loop;
  if errors <> '{}'::jsonb then
    return jsonb_build_object('status', 'validation-error', 'message', 'Ingen ändring sparades. Rätta markerade fält.', 'errors', errors);
  end if;

  for item in select value from jsonb_array_elements(normalized) loop
    v_id := (item->>'id')::uuid;
    v_sms := (item->>'sms_opt_in')::boolean;
    v_status := item->>'rsvp_status';
    if v_id is null then
      insert into public.guests(wedding_id, full_name, email, phone, notes, plus_one_allowed, sms_opt_in, sms_opted_in_at)
        values(p_wedding_id, item->>'full_name', item->>'email', item->>'phone', item->>'notes',
          (item->>'plus_one_allowed')::boolean, v_sms, case when v_sms then v_now end)
        returning id into v_id;
    else
      update public.guests set
        full_name = item->>'full_name', email = item->>'email', phone = item->>'phone', notes = item->>'notes',
        plus_one_allowed = (item->>'plus_one_allowed')::boolean,
        sms_opted_in_at = case when v_sms then coalesce(sms_opted_in_at, v_now) else sms_opted_in_at end,
        sms_opted_out_at = case when v_sms then null when sms_opt_in then v_now else sms_opted_out_at end,
        sms_opt_in = v_sms
        where id = v_id and wedding_id = p_wedding_id;
    end if;
    if (item->>'rsvp_changed')::boolean then
      insert into public.rsvp_responses(wedding_id, guest_id, attendance, updated_via_token_id, last_submitted_at)
        values(p_wedding_id, v_id, substring(v_status from 6), null, v_now)
        on conflict (guest_id) do update set attendance = excluded.attendance,
          updated_via_token_id = null, last_submitted_at = excluded.last_submitted_at;
      -- Preserve dietary/contact details and +1 membership. A later guest submission may change them.
      update public.guests set rsvp_status = v_status
        where wedding_id = p_wedding_id and deleted_at is null
          and (id = v_id or (guest_kind = 'plus_one' and rsvp_managed and invited_guest_id = v_id));
    end if;
    saved_count := saved_count + 1;
  end loop;
  return jsonb_build_object('status', 'success', 'saved_count', saved_count);
end;
$$;
revoke execute on function public.save_admin_guest_roster_session(uuid, jsonb) from public;
grant execute on function public.save_admin_guest_roster_session(uuid, jsonb) to authenticated;
