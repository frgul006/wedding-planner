# PRD: Admin Guest CRUD

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Admin guest list management

## Why this is needed

Admins need a simple list to manage invitees.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can add a guest.
- As an admin, I can edit a guest.
- As an admin, I can delete a guest with confirmation.
- As an admin, I can search and filter guests.

## Functional requirements

- Add button for new guest with required fields:
  - Full name
  - Email **or** phone
- Validate that at least one contact field is set: email or phone.
- Show guest list in table/card view.
- Show list fields:
  - Name
  - Email
  - Phone
  - Invite status
  - RSVP status
- Support search by name and phone.
- Support sorting by name and status.
- Edit form can update name, email, phone, and notes.
- Delete requires confirmation.

## Non-functional requirements

- List handles 500 guests smoothly.
- Changes save without leaving the page (or with clear save feedback).

## Acceptance criteria

- Add and edit 100 guests in one session without data loss.
- Search returns correct results for partial names.
- Delete action always requires confirmation.

## Out of scope

- Seating plan builder
- Automatic imports from social platforms
