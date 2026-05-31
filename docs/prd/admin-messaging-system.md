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
- As an admin, I can send personal Invite links by SMS to eligible Invited Guests.

## Functional requirements

- Admin composer in `/admin` with fields:
  - Title (optional)
  - Body text
  - Audience: All / RSVP Yes / RSVP No / RSVP Maybe
  - Send now
- Save message in history with time and sender.
- Provide a dedicated Invite SMS card on `/admin/messages` with:
  - Saved Wedding-scoped Invite SMS template.
  - Required `{{first_name}}` and `{{invite_link}}` placeholders.
  - Preview with eligible/skipped Guest lists and SMS segment estimate.
  - Test send to configured test phone.
  - Bulk send to eligible unsent Invited Guests.
  - Single Invited Guest send/resend.
- Optional: show delivery status if SMS provider gives one.

## Non-functional requirements

- Confirm before sending to large groups.
- Show clear success/failure after send attempt.

## Acceptance criteria

- Admin sends a message to any audience in one flow.
- Only guests with SMS opt-in and valid E.164 phone numbers are included.
- Invite SMS bulk sends include only active Invited Guests with no prior accepted Invite SMS, unopened Invite, and no submitted RSVP.
- Sent message history is stored and visible.
- Message failures show clear error.

## Out of scope

- Two-way guest replies in this flow
- Storing or redisplaying raw Invite links in SMS history
