# PRD: Admin Guest CRUD

**Version:** 0.3
**Status:** Functionally implemented; Direction B roster edit-session restyle planned
**Date:** 2026-06-24
**Scope:** Admin guest roster management

## Design source

Admin restyle uses Direction B — Brevet Console:

- `../design/references/admin/direction-b-overview.png`
- `../design/references/admin/direction-b-guests.png`

Direction B visual language wins over Direction A. When pixel fidelity conflicts with roster usability, the roster edit-session UX wins: sticky save controls, dirty-state markers, and bulk-first actions are allowed deviations from the static export.

Architecture rationale: `../adr/0003-admin-guest-roster-edit-session.md`.

## Why needed

Admins need to manage the Guest roster quickly without hidden per-row save buttons, unclear pending states, or accidental partial updates. Roster cleanup should feel like one reviewed batch of work.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can add draft Invited Guests while editing the roster.
- As an admin, I can edit multiple Guests' admin-owned fields and save all changes with one visible Save changes button.
- As an admin, I can see which cells and rows have unsaved changes.
- As an admin, I get pending, success, and error feedback for every admin action.
- As an admin, I can run selected-row bulk actions for common operations.
- As an admin, I can search, filter, and sort without losing unsaved roster edits.
- As an admin, I can decide per Invited Guest whether the Invite includes a +1 option.
- As an admin, I can invite both partners explicitly and prevent either partner seeing a confusing +1 prompt.

## Functional requirements

### Visual direction

- Use Direction B Brevet Console shell and Swedish admin copy.
- Apply the Direction B navigation shell to every admin page in the first restyle PR.
- Fully restyle `/admin` and `/admin/guests`; other admin pages may keep existing content structure inside the new shell.
- Overview uses real data only; no fake placeholder counts or tasks.
- Overview first prioritizes Guest operations: unanswered RSVPs, Guests missing phone/SMS eligibility, allergy notes to share, and pending photo review.

### Roster layout

- Optimize `/admin/guests` desktop-first for dense bulk editing.
- Use a dense table with merged practical columns:
  - Name + email, with Guest kind/tied Invited Guest context inline
  - Phone
  - SMS
  - Status
  - +1
  - Food
  - Allergies
  - Admin notes
  - Updated
- Keep Save changes outside horizontal table overflow in a sticky bottom bar.
- Support core keyboard shortcuts: tab through editable cells, Enter edit, Esc revert cell, Cmd/Ctrl+S save.

### Roster edit session

- Replace per-row save buttons with one Admin Guest roster edit session.
- Admins can edit individual cells across many rows, then use one sticky Save changes button.
- Add guest creates unsaved draft Invited Guest rows in the roster.
- Save changes commits draft Invited Guests and edits together, all-or-nothing.
- If any row is invalid, stale, or fails validation, save nothing and show inline errors.
- While Save changes is pending, lock the roster and side-effect actions; show Saving… with spinner/progress state.
- On success, clear dirty state, show “Saved N changes” in the bar, and show a small toast/status confirmation.
- Provide optional Review changes, but do not require a review dialog for valid saves.
- Discard removes draft rows and reverts dirty cells.
- Navigating away with unsaved changes prompts the admin to Save, Discard, or Stay.
- Search/filter/sort preserve the dirty edit session; if changed rows are hidden, the sticky bar must make that visible and offer a way to reveal/review them.
- Reject stale changed rows when another admin has updated them since the roster loaded.

### Editable fields

The roster edit session may edit only admin-owned fields:

- Full name
- Email
- Phone
- SMS consent
- +1 permission
- Admin notes

Rules:

- Full name is required for draft Invited Guests.
- Email or phone is required for draft Invited Guests.
- Enabling SMS consent requires valid E.164 phone.
- New Invited Guests default `plus_one_allowed = false` unless admin enables it.
- Changing +1 permission affects future Invite/OSA renders.
- RSVP-managed Plus-one Guest identity/contact fields stay read-only.
- RSVP answers, food preference, allergy details, opened-Invite activity, and RSVP status stay read-only in the roster edit session.
- No manual Invite/RSVP status override ships in this work.

### Selected-row bulk actions

Bulk side-effect actions require a clean saved roster state; admins must Save or Discard dirty edits before running them.

Ship these selected-row actions first:

- Bulk allow/disallow +1.
- Bulk enable/disable SMS consent, with eligibility validation.
- Archive selected Guests with confirmation and clear lifecycle/Invite access consequences.
- Send SMS opens the generic Wedding SMS update composer for selected eligible Message targets and shows excluded Guests with reasons.

Failure model:

- DB-only bulk actions should be all-or-nothing when possible.
- SMS sending may be partial because external providers can fail per recipient; show sent/failed summary.
- Never silently skip ineligible selected Guests for SMS; show exclusions.

### Plus-one Guests

- Show both Invited Guests and Plus-one Guests in the roster.
- Label each Guest kind and show tied Invited Guest context for Plus-one Guests.
- Plus-one Guests can be selected only for actions they qualify for.
- RSVP-managed Plus-one Guest identity/contact fields stay read-only.

### Action feedback across admin

- All admin server-action buttons must show pending feedback, disable duplicate submission, and expose success/error state.
- Guest roster gets one-save edit-session feedback.
- Other admin pages keep their natural form boundaries, but submit/test/send/update buttons need pending/disabled labels and accessible status messages.

## Acceptance criteria

- Admin can add and edit 100 Guests in one roster edit session without data loss.
- Save changes is always visible when the roster is dirty and never hidden in horizontal overflow.
- Invalid roster edits show live inline errors and prevent save.
- Save changes locks the roster while pending and shows a spinner/pending label.
- All-or-nothing roster save leaves no partial DB updates on validation or stale-row failure.
- Search/filter/sort do not discard unsaved edits.
- Navigating away with unsaved changes prompts before data loss.
- Admin can bulk allow/disallow +1 and bulk enable/disable SMS consent for selected eligible Guests.
- Admin can archive selected Guests only after confirmation.
- Roster Send SMS opens generic SMS composer and shows ineligible selected Guests with reasons.
- Guests with +1 disabled do not see +1 controls on Invite.
- Guests with +1 enabled keep the persisted permission required by Brevkort OSA +1 option.
- All admin pages touched by server actions show pending disabled button feedback.

## Out of scope

- CSV import implementation; reserve visual space only.
- Spreadsheet paste/range fill.
- Manual Invite/RSVP status overrides.
- Bulk copy invite links for selected Guests; use each row's explicit Generate/Regenerate Invite link action instead.
- Admin corrections to RSVP answers, food, allergies, or plus-one details.
- Full mobile roster editing; roster is desktop-first.
- Seating plan builder.
- Automatic imports from social platforms.
