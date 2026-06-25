# PR #120 merge plan: Admin roster edit session

Status: branch execution PRD for `design-admin-roster-edit-session` / PR #120
Date: 2026-06-24
Source: `docs/admin-roster-edit-session-working-summary.md`, `CONTEXT.md`, `docs/prd/admin-guest-crud.md`, `docs/adr/0003-admin-guest-roster-edit-session.md`, subagent planning fanout.

## Problem Statement

PR #120 has the core **Admin Guest roster edit session** working, but cannot merge while visible admin UI still exposes PR/internal language, Swenglish copy, width-wasting layout, always-visible save footer, ambiguous selected actions, stale copy-link affordances, and an unfinished selected **Wedding SMS update** path.

Admins need a compact, understandable Swedish admin experience that preserves the domain model:

- roster edits commit as one all-or-nothing **Admin Guest roster edit session**;
- **Invite access** generation/regeneration remains separate from roster edits;
- selected roster SMS starts a **Wedding SMS update** for selected eligible **Message target** Guests, not an **Invite SMS** send;
- ineligible selected Guests are explained, not silently skipped.

## Solution

Ship remaining work as gated milestones on the current PR branch. Parallelize read-only planning/review aggressively. Parallelize write work only through isolated sibling worktrees branched from `design-admin-roster-edit-session`, then integrate back serially.

Merge blockers first:

1. product/domain copy decisions;
2. admin shell/copy/overview density;
3. roster UX blockers and table compression;
4. selected **Wedding SMS update** flow;
5. validation + review pass.

Remaining non-blocking polish follows only if still wanted before merge: action feedback sweep, live validation, keyboard polish, custom unsaved prompt, optional review changes, overview prioritization, clearer Plus-one action eligibility.

## User Stories

1. As an admin, I want the admin shell to use plain product copy, so that I do not see internal design/PR terms like “Brevet Console”.
2. As an admin, I want Swedish admin labels to be consistent, so that I do not need to interpret Swenglish controls.
3. As an admin, I want the sidebar to collapse or become compact, so that the roster has more width for bulk editing.
4. As an admin, I want the overview hero to be compact, so that operational content appears above the fold.
5. As an admin, I want roster headings to describe my task, so that implementation terms do not leak into the UI.
6. As an admin, I want save controls only when relevant, so that a clean page does not claim something was just saved.
7. As an admin, I want correct singular/plural unsaved-row copy, so that status text feels trustworthy.
8. As an admin, I want Invite-link actions to say Generate/Regenerate, so that I do not expect old raw links can be copied.
9. As an admin, I want selected SMS controls to say what happens next, so that I do not confuse SMS sending with SMS-consent edits.
10. As an admin, I want read-only roster metadata compressed into secondary details, so that editable fields get more table width.
11. As an admin, I want selected SMS to preview eligible and excluded Guests, so that no selected Guest is silently skipped.
12. As an admin, I want a Wedding SMS update to selected Guests to stay separate from Invite SMS, so that Invite access links are not regenerated accidentally.
13. As an admin, I want validation and review evidence, so that the PR can merge safely.

## Implementation Decisions

- Use `Admin – Wedding Planner` or equivalent plain admin product title. Do not use `Brevet Console` as visible UI copy.
- Treat copy cleanup as UI copy only. Preserve code/domain symbols where changing them would create needless churn.
- Decide one Swedish UI glossary before implementation for:
  - Guest / Invited Guest / Plus-one Guest;
  - Invite access;
  - Invite SMS;
  - Wedding SMS update;
  - Message target;
  - RSVP status;
  - Generate/Regenerate Invite link.
- Do not implement bulk copy of existing Invite links. Active raw Invite URLs cannot be recovered because tokens are stored hashed.
- If raw Invite URL copy is needed, show it only immediately after generation/regeneration and label it as newly generated.
- Selected roster SMS means a **Wedding SMS update** to selected eligible **Message target** Guests.
- Selected SMS page must re-evaluate eligibility server-side on submit. Page preview is helpful but not authoritative.
- Roster table compression should keep editable admin-owned fields primary and move read-only metadata into secondary row content/chips.
- Keep side-effect actions blocked while roster dirty edits exist.
- Prefer stable selectors/tests over exact marketing copy assertions where possible.
- Before implementing a custom unsaved navigation prompt, read relevant Next docs in `node_modules/next/dist/docs/` per project rule.

## Testing Decisions

Final validation before PR ready:

1. `supabase db reset && pnpm seed:local`
2. `pnpm lint`
3. `pnpm build`
4. `pnpm test:e2e --reporter=list`
5. `playwright-cli snapshot` for `/admin/guests`
6. `playwright-cli snapshot` for `/admin/messages?selected_guests=...` if selected SMS ships

Targeted validation by milestone:

- Shell/copy/overview: admin smoke + messages + guests E2E specs, plus grep for removed copy.
- Roster UX: admin guest roster specs, roster session specs, plus Plus-one specs if row structure changes selectors.
- Selected SMS: message target tests, admin messages E2E, and a negative assertion that unselected/ineligible Guests do not receive sends.
- Integration: full E2E only after all lane branches are merged into the PR branch.

Static grep checks before merge:

- no visible admin copy matches `Brevet Console`, `Svensk adminvy`, `Admin Guest roster edit session`, `Gästlista utan dolda`, `SMS markerade`;
- no stale copy-existing-link UI like `Kopiera länkar`, `Copy it now`, `Copied` remains in guest-list Invite-link actions;
- `selected_guests` is both emitted from roster and consumed by messages page/action logic.

## Out of Scope

- Bulk copy of existing Invite links.
- CSV import.
- Spreadsheet paste/range fill.
- Manual Invite/RSVP status overrides.
- Admin editing RSVP answers, food, allergy, or Plus-one RSVP-managed identity/contact fields.
- Full mobile roster editing.
- Seating plan builder.
- Sending Invite SMS links through the roster selected SMS action.

## Milestones and Dependencies

### Gate 0 — Product/domain decisions

Blocking for all writers.

Decide and record:

- exact admin shell title/copy;
- Swedish UI glossary;
- selected SMS semantics;
- whether selected SMS history needs a persisted “selected audience” concept or can rely on existing delivery rows;
- Invite-link generated URL copy affordance wording.

Recommended decisions:

- title: `Admin – Wedding Planner`;
- selected SMS: selected Guests only, no global audience selector in selected mode;
- history: no schema change for now; delivery rows are enough;
- Invite-link copy: no copy-existing-link button, only copy newly generated URL if visible.

### Milestone 1 — Merge-blocking shell/copy/overview density

Can run parallel with Milestone 2 after Gate 0 if in separate worktree.

Scope:

- remove `Brevet Console` and “Swedish admin view” framing;
- fix `Förhandsgranska Invite SMS` and similar Swenglish;
- make admin sidebar collapsible/compact;
- reduce `/admin` hero height by about half;
- update exact-copy E2E selectors.

Primary likely files:

- `app/admin/layout.tsx`
- `app/admin/page.tsx`
- admin messages page copy where touched
- E2E specs with exact text selectors

Gate:

- grep clean for shell/copy blockers;
- `/admin` snapshot/manual check confirms shorter hero + accessible nav.

### Milestone 2 — Merge-blocking roster UX

Should be single-writer. Conflicts heavily inside roster editor.

Scope:

- replace roster PR-context copy;
- make sticky save footer contextual;
- fix `1 osparad rad` / `N osparade rader`;
- remove copy-existing-link affordance;
- rename `SMS markerade` to a clear next-step CTA;
- compress table by moving `Typ`, `Koppling`, `Status`, `Updated` into secondary row/chips;
- keep dirty row/cell tracking, hidden dirty-row visibility, save/discard behavior intact.

Primary likely files:

- `app/admin/guests/page.tsx`
- `app/admin/guests/guest-roster-editor.tsx`
- `app/admin/guests/invite-link-button.tsx`
- admin guest roster E2E/support files

Gate:

- clean roster load has no sticky footer;
- dirty state shows footer with correct pluralization;
- generated/regenerated Invite link UI does not promise copying old raw links;
- table has fewer columns and less horizontal pressure;
- roster snapshot captured.

### Milestone 3 — Selected Wedding SMS update flow

Can split into backend planning/tests in parallel after Gate 0, but final messages UI integration should run after Milestone 1 copy work.

Scope:

- parse `selected_guests` on `/admin/messages`;
- re-query selected Guests server-side;
- compute eligible selected **Message target** Guests;
- show excluded selected Guests with reasons;
- send **Wedding SMS update** only to eligible selected Message targets;
- preserve separation from **Invite SMS**.

Primary likely files:

- `app/admin/guests/guest-roster-editor.tsx`
- `app/admin/messages/page.tsx`
- `app/admin/messages/actions.ts`
- message target/message blast libs/tests
- admin messages E2E

Gate:

- selected mode shows count/list/exclusions;
- ineligible selected Guests are not silently skipped;
- action cannot send to unselected Guests;
- no Invite SMS link regeneration occurs from selected Wedding SMS update.

### Milestone 4 — Remaining backlog, non-blocking unless promoted

Do after merge blockers unless user explicitly marks as merge-critical.

Items:

- pending/duplicate-submit feedback across all admin pages;
- full live per-cell validation before Save;
- Enter-to-edit / Esc-to-revert-cell;
- custom unsaved Save / Discard / Stay prompt;
- optional Review changes;
- overview prioritization: unanswered RSVPs, missing phone/SMS eligibility, allergy notes;
- clearer per-action Plus-one eligibility/disabled affordances.

## Parallelization Plan

### Rule: read parallel, write isolated

Use subagents heavily for:

- read-only context gathering;
- implementation planning;
- review fanout;
- validation planning;
- post-implementation adversarial review.

Use writer subagents only with one of these patterns:

1. one writer at a time in active PR worktree; or
2. parallel writers in separate sibling worktrees under `../wedding-planner-worktrees/<branch-slug>`, each branched from `design-admin-roster-edit-session`, each with `.env.local` copied from main checkout, then merged back serially.

Do not let two writer agents edit `guest-roster-editor.tsx` or `app/admin/messages/page.tsx` concurrently in same worktree.

### Recommended worktree lanes

Create from current PR branch:

- `pr120-shell-copy-density`
- `pr120-roster-ux-blockers`
- `pr120-selected-sms-flow`
- `pr120-admin-polish` only if Milestone 4 included

Integrate back into `design-admin-roster-edit-session` in this order:

1. shell/copy/density;
2. roster UX blockers;
3. selected SMS flow;
4. optional polish;
5. final validation fixes.

### Subagent runbook

#### Step 1 — Decision note

Parent writes/updates short decision note in branch, then launches writers. No subagent should decide product semantics alone.

#### Step 2 — Parallel writer lanes

Lane A: shell/copy/density worker

Prompt shape:

> Implement merge-blocking admin shell/copy cleanup for PR #120. Use agreed glossary. Remove Brevet/internal copy, fix Swenglish, add compact/collapsible admin sidebar, compress `/admin` hero, update exact-copy tests. Do not change roster save semantics or SMS send behavior. Run targeted admin smoke/messages/guests checks if possible. Report changed files, commands, failures.

Lane B: roster UX blocker worker

Prompt shape:

> Implement merge-blocking `/admin/guests` roster UX blockers. Replace PR-context copy, make save footer contextual with Swedish pluralization, remove copy-existing-link affordance, clarify selected SMS CTA, compress metadata columns into secondary row/chips. Preserve all-or-nothing Admin Guest roster edit session semantics, dirty tracking, hidden dirty-row flow, side-effect action gating. Run targeted roster E2E if possible. Report changed files, commands, failures.

Lane C: selected SMS worker

Prompt shape:

> Implement selected Wedding SMS update flow from roster to `/admin/messages`. Parse `selected_guests`, re-evaluate selected Guests into eligible Message targets and excluded reasons server-side, show preview/exclusions, send only eligible selected Message targets, keep Invite SMS separate. Run message target/admin messages tests if possible. Report changed files, commands, failures.

Lane D: optional polish worker

Prompt shape:

> Implement only promoted non-blocking backlog item(s). Keep changes narrow. Do not refactor roster/editor broadly unless item requires it. Run targeted tests. Report changed files, commands, failures.

#### Step 3 — Per-lane review fanout

After each writer lane finishes, parent launches read-only reviewers in fresh context:

- reviewer 1: product/domain correctness and copy consistency;
- reviewer 2: UI/interaction regression and accessibility;
- reviewer 3: tests/validation gaps and selector brittleness.

Reviewers must not edit files. Parent synthesizes findings. One lane worker applies accepted fixes.

#### Step 4 — Serial integration

Parent or single integration worker merges lane branches into PR branch in order. Resolve conflicts. Run targeted checks after each merge. Do not batch all merges before first test.

#### Step 5 — Final validation/review loop

Final sequence:

1. `supabase db reset && pnpm seed:local`
2. `pnpm lint`
3. `pnpm build`
4. targeted E2E failures if any
5. full `pnpm test:e2e --reporter=list`
6. Playwright snapshots
7. fresh-context parallel review of final diff
8. fix worker for accepted findings
9. repeat review only if fixes are non-trivial
10. update PR body via `--body-file`, verify rendered body
11. run `/review` workflow per project rule
12. mark PR ready only after review passed

## Conflict Hotspots

High-conflict files:

- `app/admin/guests/guest-roster-editor.tsx`
- `app/admin/messages/page.tsx`
- E2E files using exact visible text

Moderate-conflict files:

- `app/admin/layout.tsx`
- `app/admin/page.tsx`
- `app/admin/guests/page.tsx`
- message actions/libs

Avoid parallel writes to these in one worktree. If parallel writer lanes touch same file, integrate shell/copy first, then rebase/merge downstream lane before continuing.

## Merge Gates

- Gate 0: decisions recorded.
- Gate 1: shell/copy grep clean and overview/sidebar checked.
- Gate 2: roster UX blockers passed targeted tests + snapshot.
- Gate 3: selected SMS flow passed targeted tests + snapshot.
- Gate 4: full validation green.
- Gate 5: draft PR review workflow passed, PR body updated, PR ready.

## Notes

Subagent context fanout already produced a temporary synthesis artifact at:

`/var/folders/rv/np753vqn1xv06ssf666l3djr0000gn/T/pi-subagents-uid-501/chain-runs/db5e7af3/prd-plan/final-admin-roster-merge-prd.md`

This branch doc is the durable version for PR #120 orchestration.
