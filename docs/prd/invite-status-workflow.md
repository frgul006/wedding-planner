# PRD: Invite and RSVP Status Tracking

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Invite progress states

## Why this is needed

Admins need quick status for every invite.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can see if a guest has not opened or not replied.
- As an admin, I can see when someone marked RSVP.

## Functional requirements

- Status values:
  - `not replied`
  - `opened`
  - `rsvp yes`
  - `rsvp no`
  - `rsvp maybe`
- Initial status for each guest is `not replied`.
- Set `opened` when invite page is first opened with valid token, but only if current status is `not replied`.
- Opening an invite must never downgrade an existing RSVP status back to `opened`.
- Set RSVP status to `rsvp yes`, `rsvp no`, or `rsvp maybe` when a guest submits answer.
- An RSVP answer updates the status directly; each answer replaces the previous one.
- Show status per guest row in admin list.

## Non-functional requirements

- Status updates should happen automatically.

## Acceptance criteria

- Opening invite updates status to `opened` without manual action.
- Final status always matches latest RSVP answer and is one of: `rsvp yes`, `rsvp no`, `rsvp maybe`.
- Status appears in admin list consistently.

## Out of scope

- Email open-tracking via image pixel
