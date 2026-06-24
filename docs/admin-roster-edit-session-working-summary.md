# Admin roster edit session working summary

Status: current PR `#120` (`design-admin-roster-edit-session`)
Date: 2026-06-24

## Implemented in PR #120

- Direction B / Brevet Console admin shell for `/admin/*`.
- Direction B `/admin` overview using real counts only.
- Restyled `/admin/guests` around one Admin Guest roster edit session.
- Draft Invited Guest rows created inline in roster.
- Dirty row/cell tracking with sticky Save/Discard bar outside horizontal overflow.
- Batch save RPC commits all changed roster rows atomically, rejects invalid/stale rows, and returns row errors.
- Editable roster fields limited to admin-owned fields: full name, email, phone, SMS consent, +1 permission, admin note.
- RSVP-managed Plus-one Guest identity/contact fields stay read-only.
- Selected-row actions implemented for bulk +1, bulk SMS consent, and lifecycle archive.
- Roster Invite-link generation remains explicit per row via Generate/Regenerate Invite link.
- Clean-state gating blocks side-effect actions while roster has dirty edits.
- Search/filter/sort preserve dirty edit session and expose hidden dirty-row count.
- Cmd/Ctrl+S save shortcut and browser-level unsaved navigation guard.
- Compatibility hooks keep existing E2E coverage stable while visible copy stays Swedish.

## Explicitly dropped

- Bulk copy invite links for selected Guests will not be implemented.
- Reason: active Invite links are stored as hashes, so existing raw URLs cannot be recovered. Admins should use each row's explicit Generate/Regenerate Invite link action when a raw URL is needed.

## Still not complete vs current docs/CONTEXT

1. **Roster Send SMS selected flow**
   - Current: `/admin/guests` links to `/admin/messages?selected_guests=...`.
   - Missing: messages page does not consume selected IDs, build eligible Message targets, or show excluded Guests/reasons.

2. **Action feedback across all admin pages**
   - Current: dashboard logout has reusable pending button; roster has rich feedback.
   - Missing: every submit/test/send/update button across all admin pages has not been converted to pending/disabled/status primitives.

3. **Keyboard/edit polish**
   - Current: tab naturally moves through fields; Cmd/Ctrl+S saves.
   - Missing: Enter-to-edit and Esc-to-revert-cell semantics.

4. **Unsaved navigation prompt**
   - Current: browser confirm prevents accidental navigation.
   - Missing: custom Save / Discard / Stay prompt.

5. **Review changes**
   - Current: not implemented.
   - Requirement says optional, not blocking valid saves.

6. **Overview prioritization**
   - Current: overview shows real counts for Guests, pending photos, SMS, updates.
   - Missing: prioritised Guest operations like unanswered RSVPs, missing phone/SMS eligibility, allergy notes to share.

7. **Live validation**
   - Current: validation appears on Save and clears on edit.
   - Missing: fully live per-cell validation before Save.

8. **Plus-one action eligibility visibility**
   - Current: non-qualifying selected rows are filtered out by bulk actions.
   - Missing: clearer visible per-action eligibility/disabled affordances for selected Plus-one Guests.

## Validation run after final fixes

- `supabase db reset && pnpm seed:local`
- `pnpm lint`
- `pnpm build`
- `pnpm test:e2e --reporter=list` → 174 passed
- `playwright-cli snapshot` captured `/admin/guests` after admin login against local dev server.

## References

- Domain terms: `CONTEXT.md`
- PRD: `docs/prd/admin-guest-crud.md`
- ADR: `docs/adr/0003-admin-guest-roster-edit-session.md`
- PR: https://github.com/frgul006/wedding-planner/pull/120
