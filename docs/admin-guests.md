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
- Edit name, email, phone, and notes inline
- Search by partial name or phone
- Filter by invite status
- Sort by name, status, or newest
- Delete with browser confirmation; delete sets `deleted_at` instead of hard-deleting

## Local validation

After creating a local Supabase Auth user and matching `admin_profiles` row, visit:

```txt
http://localhost:3000/admin/guests
```
