# Wedding App Data Modeling (Draft v0.2)

This is a simple shared model for the current PRDs.

## 1) Core idea

Start with one wedding in one app install, but include `wedding_id` on child tables now so future multi-wedding support is easier.

## 2) Entities and fields

### Wedding (single source of truth)

- `id` (UUID)
- `name` (string)
  - This is the couple name or wedding title shown on invites.
- `wedding_date` (datetime)
- `venue_name` (string)
- `venue_address` (string)
- `google_maps_url` (string)
- `time_plan` (json list of text entries, e.g. `["17:00 - Pre-drink", "19:00 - Middag"]`)
- `policy` (string)
- `gift_info` (string)
- `spotify_playlist_url` (string, optional)
- `allow_anonymous_hub_upload` (bool, default `true`)
  - QR hub visitors can upload without a guest cookie when this is true.
  - If false, photo upload requires a valid `GuestNavigationSession` cookie match.
- `photo_upload_requires_review` (bool, default `false`)
  - Default open behavior: uploads are automatically `approved` after server-side upload verification unless this is true.
- `created_at`, `updated_at`

### CoupleMember

- `id` (UUID)
- `wedding_id` (UUID)
- `display_name` (string)
- `label` (string, optional, e.g. "Brud"/"Brudgumma"/"Partner 1")
- `sort_order` (int)

### AdminProfile

Admin authentication is handled by Supabase Auth. The app stores only wedding-specific authorization/profile data.

- `id` (UUID) -> references `auth.users.id`
- `wedding_id` (UUID)
- `email` (string, unique)
- `display_name` (string, optional)
- `role` (`admin`) for now
- `is_active` (bool)
- `invited_by_admin_id` (UUID, nullable) -> relation to `AdminProfile`
- `created_at`, `updated_at`

### Guest

- `id` (UUID)
- `wedding_id` (UUID)
- `full_name` (string)
- `email` (string, optional)
- `phone` (string, optional)
  - Validation rule: at least one of `email` or `phone` must be set.
- `sms_opt_in` (bool)
  - Guests are included in SMS blasts only when this is true and a valid E.164 phone is present.
- `sms_opted_in_at` (datetime, nullable)
- `sms_opted_out_at` (datetime, nullable)
- `side_id` (UUID, optional) -> relation to `CoupleMember`
- `notes` (string, optional)
- `deleted_at` (datetime, nullable)
  - Admin delete is implemented as soft delete by setting this timestamp. Normal admin lists exclude deleted guests.
- `invite_status` (`not replied | opened | rsvp yes | rsvp no | rsvp maybe`)
- `created_at`, `updated_at`

### InviteToken

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID)
- `token_hash` (string, unique)
- `is_active` (bool)
- Raw token is not stored. If an admin needs to copy a link again, generate a new token and invalidate the previous active token.
- `created_at`, `regenerated_at`
- `invalidated_at` (datetime, nullable)

### GuestNavigationSession

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID, nullable) -> relation to `Guest`
  - Set when the session was created from a valid invite link.
  - Null for anonymous wedding hub visitors.
- `invite_token_id` (UUID, nullable)
  - Set when the session was created from a valid invite link, for audit/debugging.
  - Null for anonymous wedding hub visitors.
- `cookie_hash` (string, unique)
  - Store a hash of an opaque secure cookie value, not the raw invite token or PII.
- `is_anonymous` (bool)
- `created_at`
- `last_seen_at`
- `expires_at` (datetime, optional)
- `metadata` (json, optional: ip, user_agent)

### RSVPResponse (single current response per guest)

Implemented in `public.rsvp_responses`.

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID, unique)
- `attendance` (`yes | no | maybe`)
- `extra_guests` (int, >= 0)
- `food_preference` (string, optional)
- `allergy_notes` (string, optional)
- `updated_via_token_id` (UUID, nullable) -> latest invite token used to submit
- `last_submitted_at` (datetime)
- `created_at`, `updated_at`

### InviteEvent

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID, optional)
- `invite_token_id` (UUID, optional)
- `session_id` (UUID, optional)
- `event_type` (`opened`)
- `occurred_at` (datetime)
- `metadata` (json, optional: ip, user_agent)

### WeddingUpdate

- `id` (UUID)
- `wedding_id` (UUID)
- `title` (string)
- `message` (string)
- `link_url` (string, optional, full `http` or `https` URL)
- `status` (`draft | published | archived`)
  - Only `published` updates appear on invite pages.
- `created_by_admin_id` (UUID, nullable)
  - Set at creation time and immutable afterward.
- `created_at`, `updated_at`

### MessageBlast

- `id` (UUID)
- `wedding_id` (UUID)
- `title` (string, optional)
- `body` (string)
- `audience` (`all | rsvp yes | rsvp no | rsvp maybe`)
  - RSVP audiences filter by the guest's current RSVP invite status.
- `send_status` (`queued | sent | partial | failed`)
- `created_by_admin_id` (UUID)
- `created_at`, `sent_at`

### MessageDelivery

- `id` (UUID)
- `wedding_id` (UUID)
- `message_blast_id` (UUID)
- `guest_id` (UUID)
- `phone` (string)
- `provider_message_id` (string, optional)
- `delivery_status` (`queued | sent | failed`)
- `error_text` (string, optional)
- `created_at`

### PhotoUpload

- `id` (UUID)
- `wedding_id` (UUID)
- `session_id` (UUID, nullable) -> relation to `GuestNavigationSession`
- `guest_id` (UUID, nullable) -> relation to `Guest`
  - Best-effort inferred from `GuestNavigationSession` when a valid secure guest cookie is present.
  - Null for anonymous QR uploads.
- `storage_path` (string)
  - Supabase Storage object path for the original upload.
  - Bucket is the configured private photo bucket (for example `wedding-photos`) and does not need to vary per row for the MVP.
- `original_filename` (string, optional)
  - Client-declared display metadata only; never trusted for validation.
- `mime_type` (string)
  - Server-verified/normalized MIME type after finalize; client-declared value is provisional only.
- `size_bytes` (int)
  - Server-observed stored object size after finalize.
- `note` (string, optional)
- `verification_status` (`pending | verified | rejected`)
  - Starts as `pending` after the browser reports storage upload success.
  - Becomes `verified` only after the server-side post-upload verification/finalize step confirms the stored object is an allowed image within size limits.
  - Rejected uploads are not displayed/exported and their storage object should be deleted when safe.
- `moderation_status` (`pending | approved | hidden`)
  - Accepted photos for export are verified + approved photos only.
  - New verified uploads default to `approved` when `Wedding.photo_upload_requires_review = false`.
  - New verified uploads default to `pending` when `Wedding.photo_upload_requires_review = true`.
- `created_at`
- `deleted_at` (datetime, nullable)

### AuditLog (simple internal trace)

- `id` (UUID)
- `wedding_id` (UUID)
- `actor_admin_id` (UUID, nullable)
- `action` (string)
- `entity_type` (string)
- `entity_id` (UUID)
- `changes` (json, optional)
- `created_at`

## 3) Relations (simple)

- Wedding `1`—`N` CoupleMember
- Wedding `1`—`N` AdminProfile
- Wedding `1`—`N` Guest
- Wedding `1`—`N` WeddingUpdate
- Wedding `1`—`N` MessageBlast
- Wedding `1`—`N` PhotoUpload
- Guest `N`—`1` CoupleMember (via `side_id`)
- Guest `1`—`1` InviteToken (active)
- Guest `1`—`N` InviteToken (history, only one active)
- InviteToken `1`—`N` InviteEvent
- InviteToken `1`—`N` GuestNavigationSession (one per browser/device, latest one may be current)
- Guest `1`—`1` RSVPResponse (current answer)
- Guest `1`—`N` MessageDelivery
- MessageBlast `1`—`N` MessageDelivery
- GuestNavigationSession `1`—`N` PhotoUpload
- Guest `1`—`N` GuestNavigationSession
- Guest `1`—`N` PhotoUpload (direct nullable `PhotoUpload.guest_id`, set by secure cookie inference when available)

## 4) Important status rule

- Guest starts with `invite_status = not replied`.
- On first valid invite page view: set `invite_status = opened` only if the current status is `not replied`.
- Opening an invite must never downgrade an existing RSVP status back to `opened`.
- On RSVP submit/update: status becomes `rsvp yes|no|maybe` (one of these only).
- No duplicate RSVP rows for the same guest (update in place by `guest_id`).
- RSVP submission by invite token must resolve the active token first and save the response against that token's `guest_id` and `wedding_id`.

## 5) Photo upload/session decisions

- QR hub photo upload is anonymous-capable by default (`allow_anonymous_hub_upload = true`).
- Uploads do not require a `GuestNavigationSession` when anonymous upload is allowed.
- If anonymous upload is disabled (`allow_anonymous_hub_upload = false`), photo upload requires a valid `GuestNavigationSession` cookie match and otherwise returns a clear rejection.
- Opening a valid personal invite link creates or refreshes a secure opaque guest navigation cookie and stores only its hash.
- QR hub upload should look up that cookie server-side and set `PhotoUpload.session_id`/`guest_id` when it matches; otherwise the upload remains anonymous.
- Direct-to-storage uploads must run a server-side post-upload verification/finalize step before they can be approved, displayed, or exported.
- Photo review is open by default (`photo_upload_requires_review = false`), so new verified uploads are `approved` unless an admin enables review.

## 6) Open questions for your modeling session

- Should `side` label be strictly one of two roles, or can we keep it free text in `CoupleMember.label`?
- Should message blasts be SMS only first, or in-app only for now?
