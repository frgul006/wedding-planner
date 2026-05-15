## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Add the item 23a prerequisite for explicit Brevkort cover names. The app should store `partner_one_name` and `partner_two_name` on the wedding settings record, let admins edit those fields from `/admin/settings`, render safe public placeholders when either field is blank, and seed local data with `Fredrik` / `Matilda` for visual fixtures.

Reference: "Delivery sequence" item 1 and "Item 24 decisions" partner-name requirement.

## Acceptance criteria

- [ ] A migration adds nullable `weddings.partner_one_name` and `weddings.partner_two_name` fields with clear comments.
- [ ] `/admin/settings` loads, displays, saves, and persists both partner-name fields as optional settings with helper text explaining blank public placeholders.
- [ ] Public invite data loading includes the partner-name fields and the invite cover can distinguish explicit names from missing values.
- [ ] Blank partner fields render intentional public placeholders instead of parsing `weddings.name`.
- [ ] Local seed data populates `partner_one_name = Fredrik` and `partner_two_name = Matilda`.
- [ ] Admin settings and invite tests cover saving/displaying populated names and placeholder behavior for blanks.

## Blocked by

None - can start immediately.

## PRD sections addressed

- Delivery sequence: Item 23a — explicit couple-name prerequisite
- Item 24 decisions: explicit partner fields and placeholder behavior
