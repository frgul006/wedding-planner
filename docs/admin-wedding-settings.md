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
- `wedding_date`
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
- `allow_anonymous_hub_upload` (default `true`)
- `photo_upload_requires_review` (default `false`)

`time_plan` is edited as one item per textarea line, such as `16:30 - Välkomstdrinkar`, and saved as a structured JSON array of `{ time, label }` rows. Blank lines are ignored. Existing string rows are still normalized when rendered.

### Planned Brevkort visual prerequisite

Item 23a will add explicit optional partner display fields to the same settings page:

- `partner_one_name`
- `partner_two_name`

These fields will drive the public invite cover names. They are intentionally separate from `name`, which remains the general wedding title / legacy display name.

## Features

- Edit wedding title/name
- Edit date and time
- Edit venue details, venue area/city, and map link
- Edit structured timeline/time plan rows
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
