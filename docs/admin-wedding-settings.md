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
- `google_maps_url`
- `time_plan`
- `policy`
- `gift_info`
- `spotify_playlist_url`
- `allow_anonymous_hub_upload`

`time_plan` is edited as one item per textarea line and saved as a JSON array of strings. Blank lines are ignored.

## Features

- Edit wedding title/name
- Edit date and time
- Edit venue details and map link
- Edit timeline/time plan
- Edit policy or dress code notes
- Edit gift information
- Edit Spotify playlist link
- Toggle anonymous wedding hub uploads

## Planned photo upload setting

The photo upload PRDs add a future `photo_upload_requires_review` wedding setting. It is not part of the current implemented settings page until the photo upload/review feature is built.

## Local validation

After seeding local data, visit:

```txt
http://localhost:3000/admin/settings
```

Save changes and confirm the success message appears and the edited values persist after reload.
