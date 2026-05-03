# PRD: Admin Messaging System

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Text message blasts to guest groups

## Why this is needed

Admins need a quick way to send SMS updates.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can send a message to all guests.
- As an admin, I can send only to guests with RSVP Yes, RSVP No, or RSVP Maybe.

## Functional requirements

- Admin composer in `/admin` with fields:
  - Title (optional)
  - Body text
  - Audience: All / RSVP Yes / RSVP No / RSVP Maybe
  - Send now
- Save message in history with time and sender.
- Optional: show delivery status if SMS provider gives one.

## Non-functional requirements

- Confirm before sending to large groups.
- Show clear success/failure after send attempt.

## Acceptance criteria

- Admin sends a message to any audience in one flow.
- Sent message history is stored and visible.
- Message failures show clear error.

## Out of scope

- Two-way guest replies in this flow
