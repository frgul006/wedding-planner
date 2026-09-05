# Admin photo moderation and export

Admin photo moderation is implemented at `/admin/photos`.

## Access

The page and ZIP export require:

- a valid Supabase Auth session
- an active `admin_profiles` row for the signed-in user

Server actions and the export route verify the active admin profile before touching rows or storage objects.

## Photo list

The admin list shows paginated `photo_uploads` rows for the current admin wedding and auto-refreshes every 15 seconds so new uploads appear without a full browser reload. It includes:

- upload time
- original filename and storage path
- inferred guest name or anonymous marker
- optional guest note
- MIME type and size
- verification status: `pending`, `verified`, or `rejected`
- moderation status: `pending`, `approved`, `hidden`, or deleted/tombstoned
- thumbnail status and verification errors when present

Private Supabase Storage objects are previewed with short-lived signed URLs. Deleted/tombstoned rows are retained for audit visibility, but do not receive preview links.

## Moderation actions

Admins can:

- Approve a verified, non-deleted upload.
- Hide a non-deleted upload.
- Delete a non-deleted upload.

Delete is implemented as a metadata tombstone (`deleted_at`) plus `moderation_status = hidden`. The server action also attempts to remove the original and thumbnail objects from the private `wedding-photos` bucket.

## Public display and export rules

A photo is accepted only when all of these are true:

- `verification_status = verified`
- `moderation_status = approved`
- `deleted_at is null`

Pending, rejected, hidden, and deleted photos are excluded from both the public wedding hub gallery/feed and the admin ZIP export.

## Wedding hub access

When anonymous hub uploads are enabled, visitors can upload without attribution. When anonymous uploads are disabled, photo upload requires **Wedding hub access** from a valid Guest navigation cookie whose Guest is still active and non-archived. Stale cookies for archived Guests no longer unlock uploads or photo attribution.

## ZIP export

`/admin/photos/export` returns an attachment ZIP named `approved-wedding-photos-YYYY-MM-DD.zip`.

The export route uses stable keyset pagination through all accepted photos for the admin wedding and streams originals from Supabase Storage into the ZIP. If an approved row points to a missing storage object, that file is skipped and an `EXPORT-WARNINGS.txt` entry is added.

## Local validation

After seeding local data, sign in as the seeded admin at:

```txt
http://localhost:3000/admin/login
```

Then visit:

```txt
http://localhost:3000/admin/photos
```

Useful checks:

1. Confirm the page shows the auto-refresh status and a manual refresh button.
2. Enable `Require photo review before showing uploads` in `/admin/settings`.
3. Upload a photo from `/wedding-hub`.
4. Confirm the upload appears as pending in `/admin/photos` and is absent from `/wedding-hub` and the ZIP export.
5. Approve it and confirm it appears publicly and in the ZIP export.
6. Hide or delete it and confirm it disappears from the public gallery and export.

### Photo readiness checklist

Use local Supabase only; preserve wedding settings before test fixtures reset them and restore afterwards. Clean only test-owned rows and original/thumbnail paths, including uploads that never reached finalize.

- Picker → upload → feed/gallery: try JPEG, PNG, WEBP, per-file notes, and multiple files. Confirm verified DB MIME/size, matching stored original bytes, attribution when an active invite cookie exists, and anonymous access rules.
- Limits: at most 8 selected files, 50 MiB each, 512-character notes. Unsupported/empty/oversized files should fail before signing.
- Slow/partial batch: hold or fail a later Storage PUT. Earlier files must already be finalized; retry must not sign/upload earlier successes again. Picker, note, and remove controls stay disabled during transfer.
- Lost finalize response: let the server commit, then drop its response. Retry should use the same claim, without another Storage PUT or duplicate row. Gallery refresh failure must not turn success into a failed upload.
- Review on: show a receipt message but keep the verified pending photo out of public gallery/export until approved. Rejected bytes stay excluded and the stored original is removed.
- HEIC/HEIF: verify server acceptance with compatible image signatures; browsers unable to decode show **Öppna original**, linking to the original. This does not convert the image; opening it may need a compatible app. Header fixtures test signature verification, not full image validity.
- Server verification: an ignored Range or fallback 200 must consume only enough stream chunks for the 8 KiB prefix, then cancel. Invalid magic, MIME mismatch, and interrupted reads must fail closed. A stream can deliver an oversized chunk; only its prefix is retained and no further chunk is requested.
- Validate mobile-sized picker/progress/gallery with `playwright-cli snapshot`, plus desktop browser regressions. Real iPhone Safari/camera-roll and slow venue Wi-Fi still require physical-device testing; browser emulation is not that validation.

Focused automated checks: `e2e/wedding-hub-upload-browser.spec.ts`, `e2e/wedding-hub-photo-verification.spec.ts`, `e2e/wedding-hub-photo-upload-command.spec.ts`, `e2e/qr-code.spec.ts`, and `e2e/admin-photos.spec.ts`.
