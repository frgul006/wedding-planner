# PRD: Phone Capture on RSVP

**Version:** 0.2
**Status:** Implemented with Brevkort phone/consent states
**Date:** 2026-05-15
**Scope:** Guest contact data for updates

## Design source

Use the phone and SMS controls in `../design/brevkort-invite-states.md`, especially `OSA — phone validation error` and `OSA — +1 expanded`.

## Why this is needed
Guests can receive SMS updates only if they leave a valid phone number and consent to updates.

## Users

- Invited guests

## User stories

- As a guest, I can add my phone number while RSVP-ing.
- As a guest, I can update my phone number later from my invite link.
- As a guest, I can opt in or out of important SMS updates from my invite link.
- As a guest bringing a +1, I can optionally add the +1 phone and SMS consent too.

## Functional requirements

- Add optional phone field to the OSA form for the invited guest.
- Use compact E.164 international-format guidance with no spaces, for example `+46701234567`.
- Validate country code and reject spaces or local-only formats when a phone value is provided.
- Save phone on the guest record tied to token.
- Capture SMS update consent before including the guest in SMS blasts; the artboard's checked/on default applies only when a valid compact E.164 phone is already prefilled, and the submitted checked/unchecked state is the source of truth.
- Allow edit of phone number and SMS consent on invite page after submit.
- Show error message for invalid phone format.
- Error state must match the Brevkort artboard:
  - Rust/error underline on the field.
  - Helper copy equivalent to `Använd internationellt format utan mellanslag, t.ex. +46701234567.`
- Add optional +1 phone and +1 SMS consent fields only when the linked guest is allowed to bring a +1 and the +1 block is expanded.
- SMS consent for any person requires that person's valid phone number.
- If a phone field is blank on first render, its SMS opt-in checkbox defaults off so RSVP remains submit-ready without phone input.
- Blank phone values remain allowed when SMS opt-in is not selected.

## Non-functional requirements

- Do not block RSVP if phone is blank and SMS opt-in is not selected.
- Do not render a default state that blocks the simple RSVP path because of an unchecked/missing phone decision the guest has not made yet.
- Show friendly Swedish text for validation errors.
- Preserve entered phone values after validation or save errors.

## Acceptance criteria

- Valid phone number saves with country code.
- RSVP can be submitted without phone when SMS opt-in is not selected.
- Invalid number shows clear Brevkort-style error treatment.
- Guests who opt in are eligible for SMS blasts; guests who opt out are excluded.
- +1 SMS consent is captured separately from the invited guest when +1 details are implemented.

## Implementation notes

- The RSVP form includes an optional phone input with strict compact E.164 guidance; phone values are stored without spaces.
- Valid numbers are saved to the linked `public.guests.phone` record through `public.submit_rsvp_response`.
- The RSVP form includes an SMS updates opt-in checkbox; opting in requires a valid phone number, and the checkbox defaults off unless that person's phone value is already valid.
- Plus-one phone/consent requires new persistence if the current schema only stores the invited guest phone.
- Invalid phone values redirect or re-render back to the invite with a clear validation error and preserved values.

## Out of scope

- Full international number auto-complete from carrier API
