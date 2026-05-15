# Invite visual parity execution plan

This plan records the decisions for running the next Brevkort visual-parity work without mixing UI, fixture, and data-model concerns.

## Delivery sequence

1. **Item 23a — explicit couple-name prerequisite**
   - Add `weddings.partner_one_name` and `weddings.partner_two_name`.
   - Expose both fields in `/admin/settings` as optional fields with helper text.
   - Do not automatically backfill these fields from `weddings.name`; admins own the explicit display names.
   - Public invite cover states should show placeholders when either explicit partner name is blank.
   - Local seed data should populate `Fredrik` and `Matilda` so visual fixtures match the reference cover by default.
   - Merge this prerequisite before starting items 24 or 27.

2. **Item 24 — invite shell, cover, invalid-link, and saved-answer states**
   - Run as a UI-focused PR after item 23a merges.
   - Own invite shell/navigation, cover states, invalid-link visual parity, saved-answer cover treatment, and compact cover date formatting.
   - Do not restyle Details or OSA internals beyond what is required to sit inside the new shell; items 25 and 26 own those panels.

3. **Item 27 — visual fixtures and QA harness**
   - Run as a separate fixtures/test PR after item 23a merges.
   - Can run in parallel with item 24.
   - If both item 24 and item 27 are ready at the same time, merge item 27 first so item 24 can validate against stable states.

## Item 24 decisions

- Layout target is the mobile 390 px postcard shell; keep that shell centered on wider desktop screens instead of expanding it.
- Show one primary panel at a time.
- Support left/right swipe between panels.
- Keep hash deep links for panel state: `#inbjudan`, `#detaljer`, and `#osa`.
- Dot and arrow navigation should update the same panel state/hash.
- Disable unavailable arrows at the first and last panels; do not wrap around.
- Cover CTAs:
  - opened/no-answer state: primary action opens `Detaljer`.
  - saved-answer state: primary action opens `OSA` for update/edit.
- Cover date format should be compact Swedish day/month plus separate time, for example `26 sept` and `kl. 16:30`.
- Invalid-link state should load configured/default wedding fallback contact details when available, with a safe generic fallback if not.
- Use explicit partner fields from item 23a for cover names; show placeholders if those fields are blank.
- Acceptance bar is close visual parity plus documented intentional differences, not strict pixel-perfect matching.

## Item 27 decisions

- Use deterministic seeded invite tokens and database rows for stable visual states:
  - RSVP `Nej`
  - RSVP `Kanske`
  - +1 expanded
  - published updates
- Use Playwright route interception/mocks for transient states:
  - OSA submitting
  - OSA save error
- Build fixtures for all listed invite/RSVP visual states now, including states needed later by items 25 and 26.
- Add Playwright visual QA specs to the default E2E CI suite.
- The visual specs should assert key accessibility/content and attach screenshots as Playwright artifacts.
- Do not commit generated current-app screenshot baselines yet; keep captures as CI/local artifacts unless a later PR intentionally promotes them.

## Branch and PR boundaries

- Keep item 24 and item 27 in separate branches/PRs.
- Item 24 should primarily touch invite UI components and shell behavior.
- Item 27 should primarily touch seeds, test helpers, fixtures, and Playwright specs.
- Avoid editing the same invite components in item 27 unless a testability hook is unavoidable and agreed upon.
