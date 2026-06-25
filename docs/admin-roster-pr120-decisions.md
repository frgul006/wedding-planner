# PR #120 implementation decisions

Date: 2026-06-24
Branch: `design-admin-roster-edit-session`

These decisions unblock parallel implementation lanes for PR #120 merge blockers.

## Admin shell and UI copy

- Visible admin shell title should use plain product copy: `Admin – Wedding Planner`.
- Remove `Brevet Console`, `Svensk adminvy för Wedding Planner`, and PR/design-review framing from visible UI.
- Keep code/domain names unchanged unless needed for user-facing copy.
- Prefer Swedish user-facing labels. Keep domain terms only when they are intentional and self-explanatory in context.

## Invite-link affordances

- Do not implement or expose bulk copy of existing Invite links.
- Do not offer a copy action for an existing active raw Invite URL, because the raw token cannot be recovered after hashing.
- Row-level Invite-link action may generate/regenerate a link.
- If a newly generated raw URL is shown, any copy affordance must be scoped to that newly generated URL and copy must say that clearly.

## Selected SMS from roster

- `SMS` action from selected roster rows starts a **Wedding SMS update** for selected Guests.
- It does not send **Invite SMS** and must not regenerate Invite access links.
- Selected mode means selected Guests only; do not combine selected IDs with a global RSVP/audience selector for this PR.
- `/admin/messages` must parse `selected_guests`, re-evaluate eligibility server-side, show eligible selected **Message target** Guests, and show excluded selected Guests with reasons.
- Send action must target eligible selected Message targets only.

## Message history

- No schema change for selected-message history in this PR unless implementation proves existing delivery rows are insufficient.
- Existing Message delivery rows are the audit source for who received a selected Wedding SMS update.

## Deferred unless explicitly promoted

- Custom unsaved Save / Discard / Stay prompt.
- Optional Review changes dialog.
- Full admin action feedback sweep.
- Enter-to-edit / Esc-to-revert-cell keyboard polish.
- Overview operational prioritization beyond density/copy cleanup.
