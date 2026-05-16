# Brevkort Invite States Design Reference

This document is the repo-tracked reference for the **Brevkort — invite states** artboards from the shared wedding design export.

For extracted screenshots and PRD ownership, see [`wedding-design-export.md`](wedding-design-export.md). Invite-specific reference images live under [`references/invite/`](references/invite/).

## Route and layout

- Route: `/invite/[token]`
- Mobile artboard baseline: 390 px wide
- Valid invites use a three-panel folded invite:
  1. `Inbjudan`
  2. `Detaljer`
  3. `OSA`
- Top navigation shows couple/monogram, panel count (`01/03`, `02/03`, `03/03`), three progress dots, and active panel label.

## Required states

- `Ogiltig länk`
  - Missing, invalid, expired, inactive, or archived-guest token.
  - No guest name or wedding logistics.
  - May show a public support email.
- `Opened — no answer yet`
  - First valid open.
  - Invite status moves from `not replied` to `opened` without downgrading existing RSVP statuses.
  - Cover panel prompts toward details/OSA.
- `Detaljer — no updates`
  - Shows details panel without the `Uppdateringar` section.
- `Detaljer — updates published`
  - Shows latest published updates inline with date, title, and body.
- `OSA — default form`
  - Attendance defaults to `Ja`.
  - +1 defaults off when allowed, and is hidden when not allowed.
  - SMS opt-in defaults on only when a valid compact E.164 phone is already prefilled; otherwise it defaults off.
- `OSA — +1 hidden`
  - Guests with `plus_one_allowed = false` see no +1 prompt.
- `OSA — +1 expanded`
  - Guests with `plus_one_allowed = true` can reveal named second-guest fields.
- `OSA — phone validation error`
  - Rust/error underline and helper text.
  - Phone copy uses compact E.164 with no spaces, e.g. `+46701234567`.
- `OSA — submitting`
  - Submit action disabled with progress/spinner copy.
  - Visible form values are preserved.
- `OSA — save error`
  - Error banner appears above the form.
  - Retry is available and values are preserved.
- `OSA — submitted (Tack)`
  - Confirmation replaces the form.
  - Shows saved-answer summary and `Uppdatera mitt svar` action.
- `Edit — already RSVP'd Ja/Nej/Kanske`
  - Existing answers show saved-state treatment on cover/sticky area.
  - OSA panel is prefilled and uses update copy.

## Data dependencies

- Wedding settings:
  - explicit partner display names (`partner_one_name`, `partner_two_name`) for the cover
  - venue name/address
  - venue area/city label
  - structured time-plan rows (`time`, `label`)
  - dress code
  - child policy
  - gift info
  - Spotify URL
  - public invite-support email
- Guest:
  - `plus_one_allowed`
- RSVP response:
  - attendance
  - invited guest phone, food preference, allergy notes, SMS consent
  - named +1 details and +1 SMS consent when allowed and selected

## Visual direction

- Paper/letter style.
- Warm paper/tan/walnut/rust palette.
- Serif display type for names and headings.
- Sans body text.
- Monospace uppercase metadata.
- Exact color/font tokens now live in the shared Brevkort invite token/component foundation.
- Cover names should come from explicit partner-name fields, not parser-derived pieces of `wedding.name`.
- The shell should keep the 390 px postcard composition centered on wider screens, support swipe plus hash deep links, and show one primary panel at a time.
