# PRD: RSVP View and Update

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Re-open and edit RSVP by invite token

## Why this is needed

Guests may want to change their answer later.

## Users

- Invited guests

## User stories

- As a guest, I can see what I already answered.
- As a guest, I can edit my RSVP using the same link.

## Functional requirements

- If token already has a response, pre-fill form with saved values.
- Allow guest to change answer on the same page they used before.
- Save updates should replace previous response (no duplicates).
- If guest changes answer, status becomes `rsvp yes`, `rsvp no`, or `rsvp maybe`.
- Show simple confirmation after update.
- Track `last_submitted_at` as the timestamp of the latest submit or update.

## Non-functional requirements

- Keep user flow simple: same page for new and edit.

## Acceptance criteria

- Reopening a link shows latest saved answer.
- Multiple updates do not create duplicate records.
- Updated answer is visible in admin next view.

## Out of scope

- Keeping full change version history for each guest response
