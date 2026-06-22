# Admin wedding settings

Admin wedding settings are implemented at `/admin/settings`.

## Access

The page requires:

- a valid Supabase Auth session
- an active `admin_profiles` row for the signed-in user

The update server action verifies the active admin profile before updating the wedding row.

## Data model

Settings are stored on the existing `public.weddings` row scoped by `admin_profiles.wedding_id`.

Editable fields:

- `name`
- `partner_one_name`
- `partner_two_name`
- `wedding_date`
- `wedding_end_date`
- `venue_name`
- `venue_address`
- `venue_area`
- `google_maps_url`
- `time_plan`
- `dress_code`
- `child_policy`
- `policy` (legacy/general notes)
- `gift_info`
- `spotify_playlist_url`
- `invite_support_email`
- `invite_sms_template` (edited from `/admin/messages`)
- `allow_anonymous_hub_upload` (default `true`)
- `photo_upload_requires_review` (default `false`)

`time_plan` is edited as one item per textarea line, such as `16:30 - Välkomstdrinkar`, and saved as a structured JSON array of `{ time, label }` rows. Each non-blank row requires a valid local clock time and a label; label-only rows are invalid and block saving with an error. Blank lines are ignored. Existing string rows are still normalized when rendered.

`partner_one_name` and `partner_two_name` drive the **Public Wedding identity** used by the Invite cover, invalid-Invite contact, and Wedding hub monogram. They are optional and intentionally separate from `name`, which remains the general wedding title / legacy display name. Blank partner fields render safe public placeholders instead of parsing `name`.

`wedding_date` is the wedding start time as Stockholm wall-clock time. Admin-entered `datetime-local` values are interpreted in `Europe/Stockholm`, not in the production server timezone or the admin browser timezone.
`wedding_end_date` is optional and used only for Calendar action `.ics` downloads. It is not displayed on the Invite page; when provided, it must be later than `wedding_date`.

Guest-facing links stored in `google_maps_url` and `spotify_playlist_url` must be `http` or `https` URLs. Unsafe values are rejected when saving Wedding settings and still hidden when rendering the Invite as a defensive fallback.

`invite_sms_template` stores the Wedding's Invite SMS copy. It is part of Wedding settings but edited from `/admin/messages` because admins preview, test, and send it there.

## Features

- Edit wedding title/name
- Edit explicit public invite partner names
- Edit date and time
- Edit venue details, venue area/city, and map link
- Edit structured Time Plan rows
- Edit dress code, child policy, invite support email, and legacy policy notes
- Edit gift information
- Edit Spotify playlist link
- Toggle anonymous wedding hub uploads
- Toggle whether verified photo uploads require admin review before showing

## Local validation

After seeding local data, visit:

```txt
http://localhost:3000/admin/settings
```

Save changes and confirm the success message appears and the edited values persist after reload.
