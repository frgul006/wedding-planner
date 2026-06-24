# Admin roster edit session working summary

Status: PR `#120` (`design-admin-roster-edit-session`) merge-blocking feedback implemented
Date: 2026-06-24

## Implemented in PR #120

- Plain admin shell copy (`Admin – Wedding Planner`) with no visible `Brevet Console` / PR-design framing.
- Compact admin shell and overview hero; sidebar/nav consumes less roster width.
- Direction B `/admin` overview using real counts only.
- Restyled `/admin/guests` around one **Admin Guest roster edit session**.
- Draft Invited Guest rows created inline in roster.
- Dirty row/cell tracking with contextual sticky Save/Discard bar outside horizontal overflow.
- Sticky save footer hidden on clean initial load; shows dirty/saving/saved/error states only.
- Swedish dirty-count pluralization: `1 osparad rad`, `N osparade rader`.
- Batch save RPC commits all changed roster rows atomically, rejects invalid/stale rows, returns row errors.
- Editable roster fields limited to admin-owned fields: full name, email, phone, SMS consent, +1 permission, admin note.
- RSVP-managed Plus-one Guest identity/contact fields stay read-only.
- Selected-row actions implemented: bulk +1, bulk SMS consent, lifecycle archive.
- Archive action now removes all DB-archived rows from client state, including tied RSVP-managed Plus-one Guests archived by lifecycle RPC.
- Roster Invite-link generation remains explicit per row via Swedish `Skapa` / `Skapa om inbjudningslänk`; no copy-existing-link affordance.
- Clean-state gating blocks side-effect actions while roster dirty edits exist.
- Search/filter/sort preserve dirty edit session and expose hidden dirty-row count.
- Roster read-only metadata (`Typ`, `Koppling`, `Status`, `Updated`, food/allergy details) moved into compact secondary chips under Guest name.
- Selected roster SMS CTA clarified; it opens `/admin/messages?selected_guests=...` for selected Guests.
- `/admin/messages` consumes `selected_guests`, previews eligible selected SMS targets and excluded Guests/reasons, and sends only eligible selected targets.
- Selected SMS flow sends general SMS updates only; it does not send Invite SMS or regenerate Invite access.
- Visible admin copy swept for the review blockers across admin shell, roster, messages, QR, and basic load errors.
- Compatibility hooks/selectors keep existing E2E coverage stable while visible copy is Swedish.

## Explicitly dropped

- Bulk copy invite links for selected Guests will not be implemented.
- Reason: active Invite links are stored as hashes, so existing raw URLs cannot be recovered. Admins use each row's explicit generate/regenerate inbjudningslänk action when a raw URL is needed.

## Merge-blocking review feedback status

All user-raised merge blockers are implemented:

1. Admin-shell copy no longer references `Brevet Console` or “Swedish admin view”.
2. Admin visible copy is localized/polished in touched admin flows.
3. Sidebar/nav is more compact, giving roster more width.
4. `/admin` hero is materially smaller.
5. Roster page headings no longer use PR/internal copy.
6. Sticky save footer is contextual and pluralization is fixed.
7. Guest-list copy-existing-link actions are removed/renamed to generation of new inbjudningslänkar only.
8. Selected SMS CTA and selected message flow now explain exactly what happens.
9. Roster table is compressed by moving read-only metadata into secondary chips.
10. Selected Wedding SMS update flow is implemented end-to-end.

## Still not complete vs broader docs/CONTEXT

These remain non-blocking unless promoted:

1. **Action feedback across all admin pages**
   - Current: dashboard logout reusable pending button; roster/messages have improved feedback.
   - Missing: every submit/test/send/update button across all admin pages converted to shared pending/disabled/status primitives.

2. **Keyboard/edit polish**
   - Current: tab naturally moves through fields; Cmd/Ctrl+S saves.
   - Missing: Enter-to-edit and Esc-to-revert-cell semantics.

3. **Unsaved navigation prompt**
   - Current: browser confirm prevents accidental navigation.
   - Missing: custom Save / Discard / Stay prompt.

4. **Review changes**
   - Current: not implemented.
   - Requirement says optional, not blocking valid saves.

5. **Overview prioritization**
   - Current: overview shows real counts Guests, pending photos, SMS, updates.
   - Missing: prioritised Guest operations like unanswered RSVPs, missing phone/SMS eligibility, allergy notes to share.

6. **Live validation**
   - Current: validation appears on Save and clears on edit.
   - Missing: fully live per-cell validation before Save.

7. **Plus-one action eligibility visibility**
   - Current: non-qualifying selected rows are filtered out by bulk actions.
   - Missing: clearer visible per-action eligibility/disabled affordances for selected Plus-one Guests.

## Validation run after merge-blocker fixes

- `supabase db reset && pnpm seed:local`
- `pnpm lint`
- `pnpm build`
- `pnpm test:e2e --reporter=list` → 177 passed
- `playwright-cli snapshot` captured `/admin/guests` after admin login.
- `playwright-cli snapshot` captured `/admin/messages?selected_guests=...` selected SMS flow after admin login.

Snapshot artifacts from final local run:

- `/Users/fredrik/dev/wedding-planner/.playwright-cli/page-2026-06-24T21-47-21-624Z.yml`
- `/Users/fredrik/dev/wedding-planner/.playwright-cli/page-2026-06-24T21-47-21-921Z.yml`

## References

- Domain terms: `CONTEXT.md`
- PRD: `docs/prd/admin-guest-crud.md`
- ADR: `docs/adr/0003-admin-guest-roster-edit-session.md`
- Branch decisions: `docs/admin-roster-pr120-decisions.md`
- Branch execution PRD/parallelization plan: `docs/admin-roster-pr120-merge-plan.md`
- PR: https://github.com/frgul006/wedding-planner/pull/120
