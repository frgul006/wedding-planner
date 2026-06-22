# Wedding App Data Modeling (Draft v0.3)

This is a simple shared model for the current PRDs.

## 1) Core idea

Start with one wedding in one app install, but include `wedding_id` on child tables now so future multi-wedding support is easier.

## 2) Entities and fields

### Wedding (single source of truth)

- `id` (UUID)
- `name` (string)
  - General wedding title / legacy display name.
- `partner_one_name` (string, optional)
  - Explicit first partner display name for the Brevkort invite cover. Blank values render safe public placeholders instead of being inferred from `name`.
- `partner_two_name` (string, optional)
  - Explicit second partner display name for the Brevkort invite cover. Blank values render safe public placeholders instead of being inferred from `name`.
- `wedding_date` (datetime)
  - Wedding start time; admin-entered values are interpreted as Stockholm wall-clock time.
- `wedding_end_date` (datetime, optional)
  - Wedding end time; admin-entered values are interpreted as Stockholm wall-clock time and used only by Calendar action `.ics` downloads.
- `venue_name` (string)
- `venue_address` (string)
- `venue_area` (string, optional)
  - Short place/city label for the Brevkort `Plats` card, e.g. `Johanneshov`.
- `google_maps_url` (string)
- `time_plan` (json list of structured entries with required local clock time and label, e.g. `[{"time":"16:30","label":"Välkomstdrinkar"}]`)
- `policy` (string)
  - Legacy/general policy text; Brevkort should either map this deliberately or use the explicit fields below.
- `dress_code` (string, optional)
- `child_policy` (string, optional)
- `gift_info` (string)
- `spotify_playlist_url` (string, optional)
- `invite_support_email` (string, optional)
  - Public contact reserved for the Brevkort invalid invite-link state; not guest-specific.
- `invite_sms_template` (string)
  - Saved Invite SMS template. It must include `{{first_name}}` and `{{invite_link}}`; raw Invite links are rendered at send time and are not stored in the template.
- `allow_anonymous_hub_upload` (bool, default `true`)
  - QR hub visitors can upload without a guest cookie when this is true.
  - If false, photo upload requires a valid `GuestNavigationSession` cookie match.
- `photo_upload_requires_review` (bool, default `false`)
  - Default open behavior: uploads are automatically `approved` after server-side upload verification unless this is true.
- `created_at`, `updated_at`

### CoupleMember

Future/optional normalized model for multi-person wedding parties. It is not the planned source for the current Brevkort two-name cover; item 23a uses flat `weddings.partner_one_name` and `weddings.partner_two_name` fields instead.

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
- `phone` (string, optional, compact E.164 with no spaces)
  - Validation rule: Invited Guests need at least one of `email` or `phone`; Plus-one Guests can be name-only.
- `sms_opt_in` (bool)
  - Guests are included in SMS blasts only when this is true and a valid E.164 phone is present.
- `sms_opted_in_at` (datetime, nullable)
- `sms_opted_out_at` (datetime, nullable)
- `guest_kind` (`invited | plus_one`)
  - Current roster rows are Invited Guests. Future RSVP plus-one submissions create RSVP-managed Plus-one Guests.
- `invited_guest_id` (UUID, nullable) -> tied Invited Guest for Plus-one Guests
- `rsvp_managed` (bool, default `false`)
  - True when a Plus-one Guest identity/contact fields are owned by RSVP sync.
- `plus_one_allowed` (bool, default `false`)
  - Controls whether an Invited Guest sees the Brevkort +1 option on their invite.
  - Admins enable this per Invited Guest; explicitly invited partners should usually have this off.
- `side_id` (UUID, optional) -> relation to `CoupleMember`
- `notes` (string, optional)
- `deleted_at` (datetime, nullable)
  - Admin delete is implemented as soft delete by setting this timestamp. Normal admin lists exclude deleted guests.
- `invite_status` (`not replied | opened`)
  - Opened-Invite activity only.
- `rsvp_status` (`not replied | rsvp yes | rsvp no | rsvp maybe`)
  - Dedicated RSVP status for Invited Guests, separate from opened-Invite activity. RSVP-managed Plus-one Guests store the tied Invited Guest's latest RSVP status as a derived snapshot.
- `created_at`, `updated_at`

### InviteToken

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID)
- `token_hash` (string, unique)
- `is_active` (bool)
- `access_scope` (`full | scoped`)
  - Full active Invite tokens grant RSVP-capable Invite access to Invited Guests.
  - Scoped tokens grant Plus-one Guest non-RSVP Invite access and Wedding hub access; they are revoked when the tied RSVP-managed Plus-one Guest is removed.
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

Implemented in `public.rsvp_responses`, including Brevkort named +1 persistence fields. Future token-backed RSVP submissions sync named +1 identity/contact details into one tied RSVP-managed Plus-one Guest; existing historical rows are not backfilled.

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID, unique)
- `attendance` (`yes | no | maybe`)
- `extra_guests` (int, `0` or `1` for Brevkort/API submissions)
  - Legacy compatibility count for the Brevkort +1 flow; named `plus_one_*` fields carry the guest-facing details.
- `food_preference` (string, optional)
- `allergy_notes` (string, optional)
- `plus_one_name` (string, optional)
- `plus_one_email` (string, optional)
- `plus_one_phone` (string, optional, compact E.164 with no spaces)
- `plus_one_food_preference` (string, optional)
- `plus_one_allergy_notes` (string, optional)
- `plus_one_sms_opt_in` (bool, default `false`)
- `plus_one_sms_opted_in_at` (datetime, nullable)
- `plus_one_sms_opted_out_at` (datetime, nullable)
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
  - RSVP audiences filter by the Message target's RSVP audience status: Invited Guests use their own `rsvp_status`, and Plus-one Guests inherit the tied Invited Guest's `rsvp_status`.
- `send_status` (`queued | sent | partial | failed`)
- `message_kind` (`custom | invite_sms`)
  - `custom` is the normal admin SMS composer.
  - `invite_sms` records Invite SMS sends and stores the template text in `body`, not per-Guest raw links.
- `created_by_admin_id` (UUID)
- `created_at`, `sent_at`

### MessageDelivery

- `id` (UUID)
- `wedding_id` (UUID)
- `message_blast_id` (UUID)
- `guest_id` (UUID)
  - The specific Message target Guest that received this delivery; duplicate phone numbers still create one delivery per eligible Guest record.
- `phone` (string, compact E.164 with no spaces)
- `provider_message_id` (string, optional)
- `invite_token_id` (UUID, optional) -> relation to `InviteToken`
  - Set for Invite SMS deliveries after the fresh link is generated. Raw Invite links are not stored in message history.
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
  - Starts as `pending` only after the browser reports direct storage upload and row creation.
  - Becomes `verified` only after server-side post-upload verification/finalize confirms MIME/size and persisted object checks pass.
  - Rejected uploads are not displayed/exported and their storage object should be deleted when safe.
- `moderation_status` (`pending | approved | hidden`)
  - Accepted photos for export are verified + approved photos only.
  - New verified uploads default to `approved` when `Wedding.photo_upload_requires_review = false`.
  - New verified uploads default to `pending` when `Wedding.photo_upload_requires_review = true`.
- `thumbnail_status` (`pending | ready | failed | unavailable`)
  - Tracks client-generated gallery thumbnail availability and server verification.
  - `pending` when a thumbnail upload claim exists and is currently being finalized.
  - `ready` when a verified small image exists in private storage.
  - `failed` when thumbnail verification fails; original upload can still be verified.
  - `unavailable` when a format cannot generate a thumbnail.
- `thumbnail_storage_path` (string, nullable)
  - Private storage object path for the thumbnail used by gallery/feed rendering.
- `thumbnail_mime_type` (string, nullable)
  - MIME type for verified thumbnail upload.
- `thumbnail_size_bytes` (bigint, nullable)
  - Verified thumbnail byte size.
- `thumbnail_verified_at` (datetime, nullable)
  - Timestamp of successful thumbnail verification.
- `thumbnail_error` (string, nullable)
  - Reason when thumbnail status is `failed` (server-side check reason).
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

## 4) Brevkort data-model deltas

The Brevkort invite artboards require data that the earlier baseline schema did not fully model:

- Wedding settings need explicit `venue_area`, structured time-plan rows, `dress_code`, `child_policy`, and `invite_support_email` or deliberate documented mappings from existing fields.
- Guest rows need `plus_one_allowed` so admins can decide per guest whether the OSA page offers a +1.
- RSVP responses need named +1 details and +1 SMS consent fields, not only an `extra_guests` count.
- Phone numbers should remain compact E.164 with no spaces, e.g. `+46701234567`.

Implement these as migrations before building the Brevkort UI states that depend on them.

## 5) Important status and +1 rules

- Guest starts with `guest_kind = invited`, `invite_status = not replied`, and `rsvp_status = not replied`.
- On first valid invite page view: set `invite_status = opened` only if the current status is `not replied`.
- Opening an invite must never overwrite or downgrade an existing `rsvp_status`.
- On RSVP submit/update: `rsvp_status` becomes `rsvp yes|no|maybe` (one of these only) and `invite_status` remains or becomes `opened`.
- No duplicate RSVP rows for the same guest (update in place by `guest_id`).
- RSVP submission by invite token must resolve the active token first and save the response against that token's `guest_id` and `wedding_id`.
- Guests may submit +1 details only when their `guests.plus_one_allowed = true`.
- Server-side RSVP submission must reject or ignore +1 payloads when `plus_one_allowed = false`; do not rely only on hiding UI fields.
- Future RSVP submissions with +1 details create or update one RSVP-managed Plus-one Guest tied to the submitting Invited Guest.
- Future RSVP submissions that remove +1 details archive the tied RSVP-managed Plus-one Guest and revoke active scoped Invite tokens for that Guest.
- Existing historical RSVP +1 rows are not backfilled into Plus-one Guests automatically.

## 6) Photo upload/session decisions

- QR hub photo upload is anonymous-capable by default (`allow_anonymous_hub_upload = true`).
- Uploads do not require a `GuestNavigationSession` when anonymous upload is allowed.
- If anonymous upload is disabled (`allow_anonymous_hub_upload = false`), photo upload requires a valid `GuestNavigationSession` cookie match whose Guest is still active and non-archived; stale cookies for archived Guests return a clear rejection.
- Opening a valid full or scoped personal invite link creates or refreshes a secure opaque guest navigation cookie and stores only its hash.
- QR hub upload should look up that cookie server-side and set `PhotoUpload.session_id`/`guest_id` when it matches; otherwise the upload remains anonymous.
- Direct-to-storage uploads use app-issued signed upload URLs and signed server claims; the browser uploads originals (and optional thumbnails) directly to private Supabase Storage.
- Direct-to-storage uploads must run a server-side post-upload verification/finalize step before they can be approved, displayed, or exported.
- Browser-generated thumbnails are best effort for JPEG/PNG/WebP; unsupported formats can still be accepted as originals with `thumbnail_status = unavailable`.
- Public gallery/feed reads only verified + approved + non-deleted rows and signs short-lived private storage URLs at render/API time.
- Photo review is open by default (`photo_upload_requires_review = false`), so new verified uploads are `approved` unless an admin enables review.

## 7) Open questions for your modeling session

- Should `side` label be strictly one of two roles, or can we keep it free text in `CoupleMember.label`?
- Should message blasts be SMS only first, or in-app only for now?
