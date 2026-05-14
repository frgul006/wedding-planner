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
- `plus_one_allowed` defaults to `false` and controls whether future Brevkort OSA UI may offer a +1
- `deleted_at` implements soft delete/archive behavior

Normal admin lists only show guests where `deleted_at is null`.

## Features

- Add guest
- Edit name, email, phone, +1 permission, SMS update consent, and notes inline
- Search by partial name or phone
- Filter by invite status
- Sort by name, status, or newest
- Show current RSVP details when submitted, including extra guest count, food preference, allergy/special notes, and latest submission time
- Store named +1 RSVP details for the Brevkort OSA flow when allowed by the guest's +1 permission
- Reflect phone numbers updated by token-backed RSVP submissions in the editable Phone column
- Delete with browser confirmation; delete sets `deleted_at` instead of hard-deleting
- Generate or regenerate private invite links; raw links are shown only immediately after generation

## Brevkort follow-up

The data model and admin +1 permission controls are in place. The remaining Brevkort follow-up is the public OSA redesign that replaces the legacy extra-guest count with the guest-facing named +1 UI.

## Local validation

After creating a local Supabase Auth user and matching `admin_profiles` row, visit:

```txt
http://localhost:3000/admin/guests
```
