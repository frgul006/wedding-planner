# PRD: RSVP Form Submission

**Version:** 0.1
**Status:** Implemented
**Date:** 2026-05-03
**Scope:** One-time response submission

## Why this is needed

Guests need an easy way to answer attendance and food needs.

## Users

- Invited guests

## User stories

- As a guest, I can answer Yes / No / Maybe.
- As a guest, I can tell how many people I bring.
- As a guest, I can add food preference and allergy notes.

## Functional requirements

- Form fields:
  - Attendance (Yes/No/Maybe)
  - Extra guest count (0+)
  - Food preference list
  - Allergy / special note text
- Save response against invite token.
- Set RSVP status to `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- Basic validation:
  - attendance required
  - extra guest count as number
- Submit button creates one response for the token.

## Non-functional requirements

- Very short form steps (under 5 taps).
- Simple error message when submit fails.

## Acceptance criteria

- Guest can submit RSVP in 3 taps (simple path).
- Submitted values are linked to the correct token.
- Form blocks invalid data clearly.

## Implementation notes

- Valid `/invite/[token]` pages render the RSVP form; `/invite` and invalid token URLs keep the generic invalid-link behavior.
- Submissions are handled by a server action that validates form data and calls `public.submit_rsvp_response` with the hashed invite token.
- The database function validates the active token and atomically upserts `public.rsvp_responses` by `guest_id`, keeping one current RSVP per guest.
- Each saved response records `wedding_id`, `guest_id`, `updated_via_token_id`, attendance, extra guest count, food preference, allergy/special notes, and submit timestamps.
- Guest `invite_status` is updated to match the latest attendance: `rsvp yes`, `rsvp no`, or `rsvp maybe`.

## Out of scope

- Event check-in at venue
- Group RSVP invite flow for external systems
