# PRD: QR Code Setup for Guest Hub

**Version:** 0.3
**Status:** Draft
**Date:** 2026-05-10
**Scope:** Build item 13 creates one downloadable QR code and a shared public hub shell; real photo upload is delivered in build item 16.

## Why this is needed
Guests need one easy entry point at the venue.

## Delivery split

This PRD is intentionally split across build items:

- **Build item 13: QR hub shell**
  - Admin can generate/download/print the shared QR code.
  - QR opens the shared `/wedding-hub` route.
  - The hub can show the Spotify playlist action from wedding settings.
  - The hub may show a disabled/coming-soon photo entry point so the final layout is visible.
  - No real photo upload, storage, guest attribution, or moderation is required yet.
- **Build item 16: Wedding hub upload flow**
  - Turns the item 13 photo entry point into working anonymous-capable uploads.
  - Depends on item 14 guest session attribution and item 15 photo storage/settings foundation.
  - Detailed upload behavior remains in `photo-upload-public.md`.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can generate and download one QR code.
- As a guest, I can scan the code to open the shared wedding hub.
- As a guest, I can open the shared Spotify playlist from the hub when a playlist link is configured.
- As a guest, I can see where photo upload will live, even if upload is not enabled until build item 16.

## Functional requirements for build item 13

- Admin action in `/admin` to generate a wedding-day QR.
- Provide downloadable PNG/print version.
- QR points to one public shared hub route, `/wedding-hub`, used by all guests.
- Hub route gives access to:
  - "Add songs" action that opens the shared Spotify playlist link from wedding settings when configured.
  - A clear photo upload entry point or placeholder that does not claim uploads work before item 16 is implemented.
- Missing attribution cookie must not block access to the QR hub.
- The QR/hub shell must not expose personal invite tokens, raw guest ids, guest names, emails, phone numbers, or other guest PII.

## Deferred requirements for build item 16

These are required for the finished QR upload experience, but not for build item 13:

- Anonymous-capable photo upload.
- Upload from a new device while `allow_anonymous_hub_upload` is enabled.
- Best-effort upload attribution when the same browser previously opened a personal invite link and has a valid guest navigation cookie.
- Clear rejection/message when anonymous hub upload is disabled and the browser has no valid guest navigation cookie.
- Storage, verification, review, and export behavior described in `photo-upload-public.md` and `photo-review-and-export.md`.

## Non-functional requirements

- QR should remain valid for the wedding day window.
- The hub shell should be mobile-first and fast to load.

## Acceptance criteria for build item 13

- QR download works from `/admin`.
- QR print/preview is available from `/admin`.
- Scanning QR opens the shared `/wedding-hub` route.
- The shared hub shows the Spotify playlist action when a valid Spotify URL is configured in wedding settings.
- The shared hub does not show fake photo activity.
- The shared hub clearly communicates that photo upload is coming later or unavailable until the upload flow is implemented.
- Scanning QR from a new device can still open the hub without logging in.

## Acceptance criteria deferred to build item 16

- The same scanned QR works for both photo upload and playlist add flow.
- Scanning QR from a new device still allows anonymous upload while anonymous hub upload is enabled.
- Scanning QR from a device with a valid guest navigation cookie can attribute uploads to the guest.
- If anonymous hub upload is disabled, scanning QR from a new device without a valid cookie does not allow upload and shows a clear message.

## Out of scope for build item 13

- Real photo upload
- Supabase Storage setup for photos
- Guest navigation session attribution
- Photo moderation/export
- Dynamic QR expiry refresh on the fly
- Per-table QR routing
