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

## Merge-blocking review feedback before PR #120 can merge

1. **Replace PR/internal admin-shell copy with user-facing product copy**
- Current: visible labels still reference `Brevet Console`, `Svensk adminvy för Wedding Planner`, `Admin · Brevet Console`, and PR/ADR language.
- Needed: use plain product/admin copy such as `Admin – Wedding Planner`; remove “Swedish admin view” framing because there is no English admin view.

2. **Remove Swenglish from admin UI**
- Current examples: `Förhandsgranska Invite SMS`, `Invited Guest`, `RSVP status`, `(Re)generate invite link`, mixed English status/help text.
- Needed: choose Swedish user-facing labels or intentional domain terms, then apply consistently across `/admin`, `/admin/guests`, `/admin/messages`.

3. **Make admin shell/sidebar less width-hungry**
- Current: fixed sidebar consumes useful horizontal space while bulk editing roster.
- Needed: collapsible sidebar or equivalent compact mode so roster edit session can use more width.

4. **Compress `/admin` overview hero**
- Current: hero block with `Admin · Brevet Console`, couple names, signed-in text, and real-data note takes prime screen space.
- Needed: reduce hero height to at most ~50% of current size and move low-priority signed-in/context copy out of the hero.

5. **Replace roster page PR-context copy**
- Current examples: `Gästlista utan dolda spara-knappar`, `Spara allt som en granskad Admin Guest roster edit session.`, `Redigera Gäster i en session`.
- Needed: user-facing copy that describes the task, not implementation/design-review terms.

6. **Make sticky save footer contextual**
- Current: footer is visible immediately on page load and says `Gästlistan är sparad` even before user edits.
- Needed: hide footer until relevant (dirty, saving, saved confirmation, error, conflict), and fix singular/plural copy (`1 osparad rad`, `N osparade rader`).

7. **Audit/remove guest-list copy-link actions**
- Current: a `Kopiera länkar`/copy-link affordance is still visible somewhere in guest list.
- Needed: drop any copy-existing-link action that cannot work without regenerating raw Invite link. If an action regenerates, label it as Generate/Regenerate, not Copy.

8. **Clarify selected SMS action copy**
- Current: `SMS markerade` is ambiguous.
- Needed: make CTA say what happens next, e.g. open composer for selected Guests, preview selected recipients, or send selected SMS flow.

9. **Compress roster table by moving read-only metadata into secondary row content**
- Current: read-only intel like `Typ`, `Koppling`, `Status`, and `Updated` each reserve their own columns.
- Needed: keep editable fields in primary row, move read-only status/details into a compact secondary line/chips under the name/row with self-evident labels. Goal: fewer columns, less horizontal overflow, better bulk-edit density.

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
- Branch execution PRD/parallelization plan: `docs/admin-roster-pr120-merge-plan.md`
