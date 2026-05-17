# PRD: Invite and RSVP Status Tracking

**Version:** 0.1
**Status:** Implemented
**Date:** 2026-05-03
**Scope:** Invite progress states

## Why this is needed

Admins need quick status for every invite.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can see opened-Invite activity separately from whether a Guest has submitted an RSVP.
- As an admin, I can see when someone marked RSVP.

## Functional requirements

- Persist opened-Invite activity in `invite_status`:
  - `not replied`
  - `opened`
- Persist the RSVP answer in dedicated `rsvp_status`:
  - `not replied`
  - `rsvp yes`
  - `rsvp no`
  - `rsvp maybe`
- Initial state for each guest is `invite_status = not replied` and `rsvp_status = not replied`.
- Set `invite_status = opened` when invite page is first opened with valid token, but only if current `invite_status` is `not replied`.
- Opening an invite must never downgrade or overwrite an existing `rsvp_status`.
- Set `rsvp_status` to `rsvp yes`, `rsvp no`, or `rsvp maybe` when a guest submits answer.
- An RSVP answer updates `rsvp_status` directly; each answer replaces the previous one.
- Show derived current Guest status per guest row in admin list.

## Non-functional requirements

- Status updates should happen automatically.

## Acceptance criteria

- Opening invite updates opened-Invite activity to `opened` without manual action.
- Dedicated `rsvp_status` always matches latest RSVP answer and is one of: `rsvp yes`, `rsvp no`, `rsvp maybe` after submission.
- Derived Guest status appears in admin list consistently.

## Implementation notes

- Guest rows default `invite_status` and `rsvp_status` to `not replied`.
- A valid `/invite/[token]` page load calls `public.mark_invite_opened(p_guest_id, p_wedding_id)` after token validation.
- `public.mark_invite_opened` only updates `invite_status = not replied` guests to `opened`; it never overwrites `rsvp_status`.
- RSVP submission continues to call `public.submit_rsvp_response`, which upserts the current response, preserves `invite_status` as opened-Invite activity, and sets dedicated `rsvp_status` to `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- `/admin/guests` shows, filters, and sorts by the current Guest status derived from `invite_status` and `rsvp_status`.

## Out of scope

- Email open-tracking via image pixel
