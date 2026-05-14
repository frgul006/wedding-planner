# Admin guest management

Admin guest management is implemented at `/admin/guests`.

## Access

The page requires:

- a valid Supabase Auth session
- an active `admin_profiles` row for the signed-in user

Server actions verify the active admin profile before creating, updating, or deleting guests.

## Data model

Guests are stored in `public.guests` with RLS enabled.

Important fields:

- `wedding_id` scopes each guest to a wedding
- `full_name` is required
- `email` or `phone` is required by a database check constraint
- `invite_status` starts as `not replied`
- `deleted_at` implements soft delete/archive behavior

Normal admin lists only show guests where `deleted_at is null`.

## Features

- Add guest
- Edit name, email, phone, SMS update consent, and notes inline
- Search by partial name or phone
- Filter by invite status
- Sort by name, status, or newest
- Show current RSVP details when submitted, including extra guest count, food preference, allergy/special notes, and latest submission time
- Reflect phone numbers updated by token-backed RSVP submissions in the editable Phone column
- Delete with browser confirmation; delete sets `deleted_at` instead of hard-deleting
- Generate or regenerate private invite links; raw links are shown only immediately after generation

## Planned Brevkort follow-up

- Add `guests.plus_one_allowed` so admins can control whether each guest sees the +1 option on their invite.
- Expose the +1 permission in add/edit UI before implementing the Brevkort OSA +1 flow.
- Show named +1 RSVP details after the Brevkort RSVP data-model migration is implemented.

## Local validation

After creating a local Supabase Auth user and matching `admin_profiles` row, visit:

```txt
http://localhost:3000/admin/guests
```
