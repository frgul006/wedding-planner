# PRD: RSVP View and Update

**Version:** 0.2
**Status:** Implemented with Brevkort edit/confirmation redesign
**Date:** 2026-05-15
**Scope:** Re-open and edit RSVP by invite token

## Design source

Use the edit and submitted states in `../design/brevkort-invite-states.md`: `Edit — already RSVP'd Ja`, `Edit — already RSVP'd Nej`, `Edit — Kanske`, and `OSA — submitted (Tack)`.

## Why this is needed
Guests may want to see or change their answer later.

## Users

- Invited guests

## User stories

- As a guest, I can see what I already answered.
- As a guest, I can edit my RSVP using the same link.
- As a guest, I can confirm that my latest changes were saved.

## Functional requirements

- If token already has a response, pre-fill the OSA form with saved values.
- Existing saved values include attendance, phone, food preference, allergy/special notes, SMS consent, +1 selection, and +1 details when the guest is allowed a +1 and +1 details are present.
- Allow guest to change answer on the same Brevkort invite they used before.
- Save updates should replace previous response (no duplicates).
- If `plus_one_allowed = false`, the edit form must hide +1 controls and the server must reject submitted +1 values.
- If guest changes answer, status becomes `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- Show current-answer treatment before editing:
  - Cover panel includes a `Ditt svar` summary banner or chip.
  - Primary CTA switches from open/read copy to update copy, such as `Uppdatera svar`.
  - OSA panel heading switches to `Uppdatera svar`.
  - Helper copy tells the guest they can update before the deadline.
- Existing-answer visual variants:
  - `Ja`: positive saved chip.
  - `Nej`: neutral saved chip.
  - `Kanske`: tan/lower-emphasis chip and gentle prompt to confirm later.
- After submit/update succeeds, show the `Tack` confirmation state:
  - Confirmation replaces the form.
  - Summary shows saved attendance, phone, food, and +1 status/details when the guest is allowed a +1.
  - `Uppdatera mitt svar` control returns to OSA edit mode.
  - Confirmation includes couple sign-off copy.
- Track `last_submitted_at` as the timestamp of the latest submit or update.

## Non-functional requirements

- Keep user flow simple: same page for new and edit.
- Do not make guests hunt through admin-style data; use plain Swedish copy.

## Acceptance criteria

- Reopening a link shows the latest saved answer on the Brevkort cover and in the OSA form.
- Multiple updates do not create duplicate records.
- Updated answer is visible in admin next view.
- Success after first submit and after update both show a confirmation state with saved summary.
- `Uppdatera mitt svar` returns the guest to an editable, pre-filled form.

## Implementation notes

- Valid `/invite/[token]` pages load the linked guest's current `public.rsvp_responses` row, if one exists.
- Existing RSVP values are shown in a current-answer summary and pre-filled into the same RSVP form.
- The submit action continues to use `public.submit_rsvp_response`, which upserts by `guest_id`, updates `last_submitted_at`, and keeps the guest `invite_status` aligned with the latest attendance.
- `/admin/guests` shows submitted RSVP details, including whether the guest was allowed a +1, +1 details when implemented, food preference, allergy/special notes, phone, SMS consent, and latest submission time.
- Invalid token and missing-token pages still show only the generic invalid-link message.

## Out of scope

- Keeping full change version history for each guest response
