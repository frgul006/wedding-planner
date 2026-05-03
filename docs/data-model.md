# Wedding App Data Modeling (Draft v0.1)

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
- `allow_anonymous_hub_upload` (bool)
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
- `side_id` (UUID, optional) -> relation to `CoupleMember`
- `notes` (string, optional)
- `is_archived` (bool)
- `deleted_at` (datetime, nullable)
- `invite_status` (`not replied | opened | rsvp yes | rsvp no | rsvp maybe`)
- `created_at`, `updated_at`, `archived_at`

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
- `invite_token_id` (UUID, nullable)
  - Set when the session was created from a valid invite link.
  - Null for anonymous wedding hub visitors.
- `cookie_hash` (string, unique)
  - Store a hash of an opaque secure cookie value, not the raw invite token.
- `is_anonymous` (bool)
- `created_at`
- `last_seen_at`
- `expires_at` (datetime, optional)
- `metadata` (json, optional: ip, user_agent)

### RSVPResponse (single current response per guest)

- `id` (UUID)
- `wedding_id` (UUID)
- `guest_id` (UUID, unique)
- `attendance` (`yes | no | maybe`)
- `extra_guests` (int, >= 0)
- `food_preference` (string)
- `allergy_notes` (string)
- `updated_via_token_id` (UUID, nullable)
- `last_submitted_at` (datetime)
- `updated_at`

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
- `link` (string, optional)
- `status` (`draft | published | archived`)
- `created_by_admin_id` (UUID)
- `visible_from` (datetime)
- `visible_to` (datetime, optional)
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
- `delivery_status` (`queued | sent | delivered | failed`)
- `error_text` (string, optional)
- `created_at`

### PhotoUpload

- `id` (UUID)
- `wedding_id` (UUID)
- `session_id` (UUID, nullable)
- `file_url` (string)
- `thumb_url` (string, optional)
- `note` (string, optional)
- `moderation_status` (`pending | approved | hidden`)
  - Accepted photos for export are `approved` photos only.
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
- InviteToken `1`—`1` GuestNavigationSession (current, latest one if present)
- Guest `1`—`1` RSVPResponse (current answer)
- Guest `1`—`N` MessageDelivery
- MessageBlast `1`—`N` MessageDelivery
- GuestNavigationSession `1`—`N` PhotoUpload
- Guest `1`—`N` PhotoUpload (through `PhotoUpload.session_id` -> `GuestNavigationSession.invite_token_id` -> `InviteToken.guest_id` when linked to token)

## 4) Important status rule

- Guest starts with `invite_status = not replied`.
- On first valid invite page view: set `invite_status = opened` only if the current status is `not replied`.
- Opening an invite must never downgrade an existing RSVP status back to `opened`.
- On RSVP submit/update: status becomes `rsvp yes|no|maybe` (one of these only).
- No duplicate RSVP rows for the same guest (update in place).

## 5) Open questions for your modeling session

- Should `allow_anonymous_hub_upload = false` mean guest must have a session from invite link (cookie) before upload?
- Should uploads require a `GuestNavigationSession` when anonymous is off?
- Should `side` label be strictly one of two roles, or can we keep it free text in `CoupleMember.label`?
- Should message blasts be SMS only first, or in-app only for now?
