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
  - Use direct browser upload with short-lived signed upload URLs created by the app after server-side request validation.
  - Pre-upload validation may use client-declared filename, MIME type, and size only as an early rejection gate; it must not be the only validation gate.
  - Do not stream large photo bodies through Vercel server routes.
  - After storage upload succeeds, the app must run a server-side finalize/verification step before the photo can be displayed, approved, or exported.
  - Post-upload verification should confirm the stored object exists, matches expected size limits using storage-observed metadata, and is an allowed image type using a bounded server-side content check; deeper validation can run in a background job or Supabase Edge Function if needed.
  - Store file metadata in `PhotoUpload`, including storage path, server-verified MIME type and size, optional original filename, optional note, verification status, session id, and inferred guest id when available.
- Upload flow (uses shared route and shared settings):
  - Allow one or many image files.
  - Validate declared file size and image type before creating signed upload URLs.
  - Show upload progress and completion/error states.
  - Save one `PhotoUpload` row per uploaded file after storage upload succeeds, initially with `verification_status = pending`.
  - Finalize each upload server-side and set `verification_status = verified` only after post-upload verification succeeds.
  - If post-upload verification fails, set `verification_status = rejected`, do not display/export the file, and delete the Supabase Storage object when safe.
- Attribution:
  - When a secure guest navigation cookie exists, hash/lookup the cookie server-side and associate uploads with the matching `GuestNavigationSession` and guest.
  - The cookie value must be opaque, signed/unguessable, `HttpOnly`, `Secure`, and `SameSite=Lax`; it must not contain raw invite tokens or PII.
  - If no matching cookie exists and anonymous hub upload is enabled, create/save the upload as anonymous.
  - If no matching cookie exists and anonymous hub upload is disabled, reject the upload with a clear message.
- Review behavior:
  - Admins can toggle whether uploaded photos require review before showing.
  - Default is open/no review required: new verified uploads are saved with `moderation_status = approved` and can appear after verification succeeds.
  - When review is required, new verified uploads are saved with `moderation_status = pending` until an admin approves or hides them.
  - Review-off/open mode must not bypass post-upload verification.
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
- Invalid declared files are rejected with clear message before storage upload starts when possible.
- Files that fail server-side post-upload verification are not approved, displayed, or exported.
- Upload progress is visible during transfer.
- Uploaded files are stored in Supabase Storage and have matching `PhotoUpload` metadata rows.
- Uploaded files must pass server-side post-upload verification before they can be displayed, approved, or exported.
- With review disabled by default, verified valid uploads are marked `approved` without manual review.
- With review enabled, verified valid uploads are marked `pending` and do not show until approved.
- Spotify action is visible on the same page as upload.

## Out of scope

- Automatic face tagging or filters
- Separate per-table QR flow
- Guest login or account creation for photo upload
