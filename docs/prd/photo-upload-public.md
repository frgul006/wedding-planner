# PRD: Wedding Hub Upload Flow (Public)

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Guests use one QR hub for uploads and music actions

## Why this is needed
Guests can share photos quickly and also add songs during the wedding.

## Users

- Wedding guests

## User stories

- As a guest, I can scan one QR code and reach a shared wedding hub.
- As a guest, I can upload photos in the hub.
- As a guest, I can open the shared Spotify playlist from wedding settings on the same hub.
- As a guest, I can add a short note with my photo upload.

## Functional requirements

- Public route is one shared page (for QR), for example `/wedding-hub`, no login needed.
- Page sections:
  - Photo upload area
  - "Add songs" button/link to Spotify playlist from wedding settings
- Upload flow (uses shared route and shared settings):
  - Allow one or many image files.
  - Validate file size and format.
  - Show upload progress and completion/error states.
- Allow optional short text note with upload.

## Non-functional requirements

- Works on modern phones on slow Wi‑Fi.
- The hub page should feel fast and simple.

## Acceptance criteria

- A guest can upload multiple valid photos in one session.
- Invalid files are rejected with clear message.
- Upload progress is visible during transfer.
- Spotify action is visible on the same page as upload.

## Out of scope

- Automatic face tagging or filters
- Separate per-table QR flow
