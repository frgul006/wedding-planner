# PRD: RSVP Form Submission

**Version:** 0.2
**Status:** Implemented baseline; Brevkort OSA redesign pending
**Date:** 2026-05-14
**Scope:** First-time response submission and current-response upsert

## Design source

Use the OSA states in `../design/brevkort-invite-states.md`: default form, +1 hidden/expanded, phone validation error, submitting, save error, and submitted confirmation.

## Why this is needed
Guests need an easy way to answer attendance, share contact details, and send food/allergy needs.

## Users

- Invited guests

## User stories

- As a guest, I can answer Ja / Nej / Kanske.
- As a guest, I can tell the couple if I bring one guest when my invitation allows a +1.
- As a guest, I can add food preference and allergy notes for myself.
- As a guest, I can add food preference and allergy notes for my +1 when allowed.
- As a guest, I can submit without losing entered values if there is an error.

## Functional requirements

- Valid `/invite/[token]` pages render the Brevkort `OSA` panel.
- `/invite` and invalid token URLs keep the generic invalid-link behavior and never render the form.
- Form fields for the invited guest:
  - Attendance radio group: `Ja` / `Nej` / `Kanske`.
  - Phone number, optional, using international-format guidance.
  - Food preference.
  - Allergy / special note text.
  - SMS updates opt-in checkbox.
- +1 flow:
  - Show the one-guest toggle only when the linked guest has `plus_one_allowed = true`.
  - Hide the +1 section completely when `plus_one_allowed = false` so guests who are invited as explicit partners are not prompted to bring another guest.
  - Replace the old generic extra guest count UI with a one-guest toggle for this design: `Tar du med en gäst?` (`Nej, bara jag` / `Ja, +1 gäst`).
  - Default +1 selection is off when the guest is allowed a +1.
  - When +1 is selected, show a `Din gäst` block with name, email, phone, food preference, allergy/special notes, and SMS updates opt-in for the guest.
  - +1 name is required when +1 is selected; +1 contact fields are optional unless SMS opt-in is selected.
  - Server-side validation must reject +1 payloads for guests where `plus_one_allowed = false`, even if a client submits hidden fields.
- Default fresh-form state follows the artboard:
  - Attendance defaults to `Ja`.
  - +1 defaults to off when the guest is allowed a +1, and is hidden otherwise.
  - SMS opt-in defaults on only when the relevant phone field is already prefilled with a valid compact E.164 value; otherwise it defaults off so the untouched simple path remains valid.
  - Save the final checked/unchecked SMS value submitted by the guest.
- Submit saves the response against the invite token.
- Set RSVP status to `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- Basic validation:
  - attendance required
  - phone fields must be blank or compact E.164 with no spaces, for example `+46701234567`
  - SMS opt-in requires a valid phone for the relevant person
  - default form state must never be invalid before the guest changes anything
  - +1 name required when +1 is selected and the linked guest is allowed a +1
  - +1 fields rejected when the linked guest is not allowed a +1
- Submit button creates or updates one current response for the token.
- While submit is in flight:
  - Disable the submit button.
  - Show progress/spinner copy equivalent to `Skickar…`.
  - Preserve visible form values.
- If save fails after validation passes:
  - Show a form-level error banner equivalent to `Kunde inte spara` / `Försök igen om en stund.`
  - Re-enable submit so the guest can retry.
  - Preserve visible form values.
- On successful first submit, replace the form with the `Tack` confirmation state and a saved-answer summary.

## Non-functional requirements

- Very short simple path: a guest who comes alone and has no notes can answer in a few taps.
- Simple, friendly Swedish error messages.
- Do not discard form input on validation or save errors.

## Acceptance criteria

- Guest can submit RSVP in the simple path without opening the +1 block when +1 is allowed, or without seeing +1 controls when +1 is not allowed.
- Guest can submit the untouched default form without a phone validation error when no phone is prefilled.
- Submitted values are linked to the correct token.
- Form blocks invalid data clearly.
- Phone validation errors match the Brevkort error state.
- Submitting state disables only the submit action and clearly shows progress.
- Save-error state shows retry copy and preserves values.
- Repeat submissions update the existing guest response instead of creating duplicates.
- Successful submit shows the `Tack` confirmation summary.

## Implementation notes

- Submissions are handled by a server action that validates form data and calls `public.submit_rsvp_response` with the hashed invite token.
- The database function validates the active token and atomically upserts `public.rsvp_responses` by `guest_id`, keeping one current RSVP per guest.
- Each saved response records `wedding_id`, `guest_id`, `updated_via_token_id`, attendance, guest contact/food/allergy values, +1 values when allowed and present, and submit timestamps.
- Guest `invite_status` is updated to match the latest attendance: `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- The current `extra_guests` count model is not enough for the Brevkort +1 state. Add a data-model migration for `guests.plus_one_allowed` plus named +1 RSVP details before implementing this redesign.

## Out of scope

- Event check-in at venue
- Group RSVP invite flow for external systems
- More than one +1 guest in the Brevkort design
