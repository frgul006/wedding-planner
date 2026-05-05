# Admin wedding updates

Admin wedding updates are implemented at `/admin/updates`.

## Access

The page requires:

- a valid Supabase Auth session
- an active `admin_profiles` row for the signed-in user

Server actions verify the active admin profile before creating or updating feed items.

## Data model

Updates are stored in `public.wedding_updates` with RLS enabled.

Important fields:

- `wedding_id` scopes each update to a wedding
- `title` is the short guest-facing heading
- `message` is the guest-facing body text
- `link_url` is optional and must be a full `http` or `https` URL when provided
- `status` is `draft`, `published`, or `archived`
- `created_by_admin_id` records the admin who created the item
- `updated_at` changes automatically when an item is edited

## Features

- Create updates from `/admin/updates`
- Edit title, message, optional link, and status
- Publish, draft, or archive an update by changing its status
- Show update history newest first for admins
- Display the latest five `published` updates on valid invite pages
- Keep draft and archived updates hidden from guests
- Guest-facing links open in a new tab with `rel="noopener noreferrer"`

## Local validation

After seeding local data, visit:

```txt
http://localhost:3000/admin/updates
```

Create a published update, then open a valid invite link and confirm the update appears in the Updates section. Change the update to draft or archived and confirm it no longer appears to guests.
