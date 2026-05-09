# PRD: Phone Capture on RSVP

**Version:** 0.1
**Status:** Implemented
**Date:** 2026-05-03
**Scope:** Guest contact data for updates

## Why this is needed

Guests can receive SMS updates only if they leave a phone number.

## Users

- Invited guests

## User stories

- As a guest, I can add my phone number while RSVP-ing.
- As a guest, I can update my phone number later from my invite link.
- As a guest, I can opt in or out of important SMS updates from my invite link.

## Functional requirements

- Add optional phone field to RSVP form.
- Validate number format and country code.
- Save phone on guest record tied to token.
- Capture explicit SMS update consent before including the guest in SMS blasts.
- Allow edit of phone number and SMS consent on invite page after submit.
- Show error message for invalid phone format.

## Non-functional requirements

- Do not block RSVP if phone is not given.
- Show friendly text for validation errors.

## Acceptance criteria

- Valid phone number saves with country code.
- RSVP can be submitted without phone.
- Invalid number shows clear error.
- Guests who opt in are eligible for SMS blasts; guests who opt out are excluded.

## Implementation notes

- The RSVP form includes an optional phone input with strict country-code format guidance.
- Valid numbers are saved to the linked `public.guests.phone` record through `public.submit_rsvp_response`.
- The RSVP form includes an SMS updates opt-in checkbox; opting in requires a valid phone number.
- Blank phone values remain allowed so RSVP submission is not blocked when SMS opt-in is not selected.
- Invalid phone values redirect back to the invite with a clear validation error.

## Out of scope

- Full international number auto-complete from carrier API
