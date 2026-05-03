# PRD: Photo Moderation and Admin Export

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Staff review and final handling of uploads

## Why this is needed

Staff need control over what photos to keep and share later.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As staff, I can see uploaded photos in one place.
- As staff, I can hide or delete bad uploads.
- As staff, I can download a full photo set.

## Functional requirements

- Admin photo list in `/admin`.
- Show upload time and optional guest note.
- Optional states: pending / approved / hidden.
- Actions: hide, delete, optionally approve.
- Export button to download all accepted photos as zip.
- Accepted photos are photos with `moderation_status = approved`.

## Non-functional requirements

- Handles many uploads without slowing admin screen.

## Acceptance criteria

- Admin can view new uploads in near real time.
- Hidden/deleted photos are not included in shared export.
- Zip export works for a set of photos.

## Out of scope

- Auto-cropping or image compression choices
