# PRD: Wedding Hub Upload Flow (Public)

**Version:** 0.2
**Status:** Draft
**Date:** 2026-05-09
**Scope:** Guests use one QR hub for Supabase Storage photo uploads and music actions

## Why this is needed
Guests can share photos quickly and also add songs during the wedding. The upload flow must work from a shared venue QR code without requiring guest login.

## Users

- Wedding guests

## User stories

- As a guest, I can scan one QR code and reach a shared wedding hub.
- As a guest, I can upload photos in the hub even if I did not open my personal invite link on this device.
- As a guest, if I previously opened my personal invite link on this device, my upload can be attributed to me without another login step.
- As a guest, I can open the shared Spotify playlist from wedding settings on the same hub.
- As a guest, I can add a short note with my photo upload.

## Functional requirements

- Public route is one shared page (for QR), for example `/wedding-hub`, no login needed.
- Guests with the QR code can upload anonymously when `allow_anonymous_hub_upload` is enabled; this is the default.
- When anonymous hub upload is enabled, missing or expired guest cookies must not block upload.
- If an admin disables anonymous hub upload later, uploads require a valid guest navigation cookie and otherwise show a clear message.
- Page sections:
  - Photo upload area
  - "Add songs" button/link to Spotify playlist from wedding settings
- Storage:
  - Store uploaded originals in a private Supabase Storage bucket, for example `wedding-photos`.
  - Use direct browser upload with short-lived signed upload URLs created by the app after server-side validation.
  - Do not stream large photo bodies through Vercel server routes.
  - Store file metadata in `PhotoUpload`, including storage path, MIME type, size, optional original filename, optional note, session id, and inferred guest id when available.
- Upload flow (uses shared route and shared settings):
  - Allow one or many image files.
  - Validate file size and image format before creating signed upload URLs.
  - Show upload progress and completion/error states.
  - Save one `PhotoUpload` row per uploaded file after storage upload succeeds.
- Attribution:
  - When a secure guest navigation cookie exists, hash/lookup the cookie server-side and associate uploads with the matching `GuestNavigationSession` and guest.
  - The cookie value must be opaque, signed/unguessable, `HttpOnly`, `Secure`, and `SameSite=Lax`; it must not contain raw invite tokens or PII.
  - If no matching cookie exists and anonymous hub upload is enabled, create/save the upload as anonymous.
  - If no matching cookie exists and anonymous hub upload is disabled, reject the upload with a clear message.
- Review behavior:
  - Admins can toggle whether uploaded photos require review before showing.
  - Default is open/no review required: new uploads are saved with `moderation_status = approved` and can appear immediately.
  - When review is required, new uploads are saved with `moderation_status = pending` until an admin approves or hides them.
- Allow optional short text note with upload.

## Non-functional requirements

- Works on modern phones on slow Wi‑Fi.
- The hub page should feel fast and simple.
- Uploads should be serverless-friendly on Vercel by keeping large file transfer between the browser and Supabase Storage.

## Acceptance criteria

- A guest can upload multiple valid photos in one session.
- A guest who only has the shared QR code can upload without logging in while anonymous hub upload is enabled, which is the default.
- A guest who previously opened a personal invite link on the same device has uploads associated with their guest record when the cookie is still valid.
- If anonymous hub upload is disabled, a guest without a valid cookie cannot upload and sees a clear message.
- Invalid files are rejected with clear message before storage upload starts.
- Upload progress is visible during transfer.
- Uploaded files are stored in Supabase Storage and have matching `PhotoUpload` metadata rows.
- With review disabled by default, valid uploads are immediately marked `approved`.
- With review enabled, valid uploads are marked `pending` and do not show until approved.
- Spotify action is visible on the same page as upload.

## Out of scope

- Automatic face tagging or filters
- Separate per-table QR flow
- Guest login or account creation for photo upload
