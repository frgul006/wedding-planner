# PRD: Photo Moderation and Admin Export

**Version:** 0.2
**Status:** Draft
**Date:** 2026-05-09
**Scope:** Staff review controls and final handling of Supabase Storage uploads

## Why this is needed

Staff need control over what photos to keep, whether new photos appear immediately, and what to share or download later.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As staff, I can see uploaded photos in one place.
- As staff, I can choose whether new uploads require approval before appearing.
- As staff, I can approve, hide, or delete uploads.
- As staff, I can download a full photo set.

## Functional requirements

- Admin photo list in `/admin`.
- Admin setting: `Require photo review before showing uploads` (`photo_upload_requires_review`).
  - Default is off/open.
  - When off, new uploads are automatically `approved` after server-side upload verification succeeds.
  - When on, new verified uploads start as `pending` and must be approved before showing.
  - Upload verification is required in both modes; review-off/open mode must not approve unverified objects.
- Show upload time, optional guest note, inferred guest name when available, and anonymous marker when not available.
- Show upload verification state when an upload is still being verified or was rejected.
- Moderation states: `pending` / `approved` / `hidden`.
- Actions: approve, hide, delete.
- Delete should remove or tombstone the metadata row and remove the Supabase Storage object when safe.
- Export button to download all accepted photos as zip.
- Accepted photos are photos with `verification_status = verified`, `moderation_status = approved`, and no `deleted_at` value.
- Hidden, pending, unverified/rejected, and deleted photos are excluded from public display and export.

## Non-functional requirements

- Handles many uploads without slowing admin screen.
- Admin previews should use short-lived signed read URLs instead of exposing permanent public storage URLs; generated thumbnails can be added later if performance requires them.

## Acceptance criteria

- Admin can view new uploads in near real time.
- Admin can turn review requirement on or off from settings.
- With review off, a verified new upload appears as approved without manual action.
- With review on, a verified new upload appears as pending and is hidden from public display/export until approved.
- Unverified or rejected uploads are never included in public display or export.
- Hidden/deleted photos are not included in shared export.
- Zip export works for a set of approved photos.

## Out of scope

- Auto-cropping or image compression choices
- Automated content moderation
