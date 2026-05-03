# PRD: QR Code Setup for Guest Hub

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Admin creates one QR code for photo + playlist access

## Why this is needed
Guests need one easy entry point at the venue.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can generate and download one QR code.
- As a guest, I can scan the code to open the shared wedding hub.

## Functional requirements

- Admin action in `/admin` to generate a wedding-day QR.
- Provide downloadable PNG/print version.
- QR points to one public shared hub route (for example: `/wedding-hub`) used by all guests.
- Hub route gives access to:
  - Photo upload
  - "Add songs" action (opens shared Spotify playlist link from wedding settings)

## Non-functional requirements

- QR should remain valid for the wedding day window.

## Acceptance criteria

- QR download works from `/admin`.
- Scanning QR opens the shared wedding hub.
- The same scanned QR works for both photo upload and playlist add flow.

## Out of scope

- Dynamic QR expiry refresh on the fly
- Per-table QR routing
