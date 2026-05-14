# PRD: Admin Guest CRUD

**Version:** 0.2
**Status:** Implemented, including per-guest +1 permission
**Date:** 2026-05-14
**Scope:** Admin guest list management

## Why this is needed

Admins need a simple list to manage invitees and control who is allowed to bring an extra guest.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can add a guest.
- As an admin, I can edit a guest.
- As an admin, I can delete a guest with confirmation.
- As an admin, I can search and filter guests.
- As an admin, I can decide per guest whether their invite should include a +1 option.
- As an admin, I can invite both partners explicitly and prevent either partner from seeing a confusing +1 prompt.

## Functional requirements

- Add button for new guest with required fields:
  - Full name
  - Email **or** phone
  - +1 allowed toggle/checkbox
- Validate that at least one contact field is set: email or phone.
- Store the per-guest +1 setting as `guests.plus_one_allowed`.
- `plus_one_allowed` should default to `false` for newly created guests unless an admin explicitly enables it.
- Show guest list in table/card view.
- Show list fields:
  - Name
  - Email
  - Phone
  - +1 allowed
  - Invite status
  - RSVP status
- Support search by name and phone.
- Support sorting by name and status.
- Edit form can update name, email, phone, +1 allowed, SMS update consent, and notes.
- Changing +1 allowed affects future invite/OSA renders for that guest.
- Delete requires confirmation.

## Implementation notes

- Add a `guests.plus_one_allowed` boolean migration before exposing the admin UI control.
- RSVP submission and invite rendering must read this server-side value; hiding the UI alone is not enough.

## Non-functional requirements

- List handles 500 guests smoothly.
- Changes save without leaving the page (or with clear save feedback).
- The +1 permission control must be obvious enough to avoid accidentally offering +1 to explicitly invited couples.

## Acceptance criteria

- Add and edit 100 guests in one session without data loss.
- Search returns correct results for partial names.
- Delete action always requires confirmation.
- Admin can enable +1 for one guest and disable it for another.
- Guests with +1 disabled do not see +1 controls on their invite.
- Guests with +1 enabled are persisted with the permission needed for the follow-up Brevkort OSA +1 option.

## Out of scope

- Seating plan builder
- Automatic imports from social platforms
