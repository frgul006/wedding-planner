# PRD: QR Code Setup for Guest Hub

**Version:** 0.2
**Status:** Draft
**Date:** 2026-05-09
**Scope:** Admin creates one QR code for anonymous photo upload + playlist access

## Why this is needed
Guests need one easy entry point at the venue.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can generate and download one QR code.
- As a guest, I can scan the code to open the shared wedding hub.
- As a guest, I can upload photos from the QR hub without logging in when anonymous hub upload is enabled, which is the default.

## Functional requirements

- Admin action in `/admin` to generate a wedding-day QR.
- Provide downloadable PNG/print version.
- QR points to one public shared hub route (for example: `/wedding-hub`) used by all guests.
- Hub route gives access to:
  - Anonymous-capable photo upload
  - "Add songs" action (opens shared Spotify playlist link from wedding settings)
- If the same browser previously opened a personal invite link and has a valid guest navigation cookie, the hub may use it for best-effort upload attribution.
- Missing attribution cookie must not block access to the QR hub.
- Missing attribution cookie must not block photo upload while anonymous hub upload is enabled.
- If anonymous hub upload is disabled, the upload area requires a valid guest navigation cookie and otherwise shows a clear message.

## Non-functional requirements

- QR should remain valid for the wedding day window.

## Acceptance criteria

- QR download works from `/admin`.
- Scanning QR opens the shared wedding hub.
- The same scanned QR works for both photo upload and playlist add flow.
- Scanning QR from a new device still allows anonymous upload while anonymous hub upload is enabled.
- Scanning QR from a device with a valid guest navigation cookie can attribute uploads to the guest.
- If anonymous hub upload is disabled, scanning QR from a new device without a valid cookie does not allow upload and shows a clear message.

## Out of scope

- Dynamic QR expiry refresh on the fly
- Per-table QR routing
