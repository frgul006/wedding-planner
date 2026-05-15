# PRD: Public Invite Page

**Version:** 0.3
**Status:** Brevkort shell/details and OSA redesign implemented
**Date:** 2026-05-15
**Scope:** Guest-facing invite landing page, secure guest session bootstrap, and Brevkort invite states

## Design source

Use `../design/brevkort-invite-states.md` as the repo-tracked visual/state reference for the invite page.

## Why this is needed
Guests need one simple, personal place to open their invite, read wedding details, and submit or update their OSA/RSVP.

## Users
- Invited guests

## User stories
- As a guest, I can open my invite with my link.
- As a guest, I can view wedding details in one page.
- As a guest, I can see if my link is not valid.
- As a guest, I can submit or update my OSA/RSVP without creating an account.
- As a guest, opening my personal invite link can remember this device for later QR photo upload attribution.

## Functional requirements
- Public route format: `/invite/:token`.
- `/invite` without a token must render the same safe invalid-link page as an invalid token.
- If token is invalid, missing, expired, or inactive, show the Brevkort invalid state:
  - Swedish heading/copy equivalent to `Inbjudan saknas` and `Den här länken fungerade inte.`
  - No guest name, token data, RSVP state, venue, schedule, or other event details.
  - It may show an intentionally public support email so the guest can ask for a new link.
- If token is valid, render the Brevkort folded invite experience with three mobile-first panels:
  1. `Inbjudan` — personalized cover with guest name, couple names, date/time, venue summary, and primary CTA.
  2. `Detaljer` — event details, map/music links, gifts/dress-code cards, and updates feed.
  3. `OSA` — RSVP form, edit form, or submitted confirmation.
- The top navigation must show the monogram/couple mark, current panel count (`01/03`, `02/03`, `03/03`), three progress dots, and active panel label.
- Guests can move between panels by tapping dots, next/back controls, or equivalent swipe-friendly controls.
- First valid open with no answer starts on the cover panel and prompts the guest toward details/OSA, including the sticky/persistent OSA prompt from the artboard when space allows.
- If the linked guest already has an RSVP response:
  - Show the current answer on the cover as a saved/current-answer banner or chip.
  - Show the sticky/current-answer bar variant with the guest's saved answer where the layout supports it.
  - Change the primary CTA copy to an update action, such as `Uppdatera svar`.
  - Pre-fill the OSA form with the current saved values.
- Show a clear event summary (names, date/time, venue) only for valid tokens.
- Show base details driven from wedding settings:
  - Venue and Google Maps link
  - Time plan
  - Dress code and child policy where configured
  - Gift info
  - Spotify playlist link
- Wedding settings are defined in `wedding-event-settings.md` (single source of truth).
- If token is valid, show an interactive OSA/RSVP area where guests can submit or update their RSVP.
- The OSA panel must only show +1 controls when the linked guest has `plus_one_allowed = true`; guests without +1 permission must not see or be able to submit +1 details.
- If token is valid, show an Updates section with the latest published updates when available, and a Swedish empty state when none are published.
- If token is valid, create or refresh a secure guest navigation session cookie for this browser.
  - The cookie is used later for best-effort attribution of QR hub photo uploads from the same device.
  - The cookie must be opaque and must not contain raw invite tokens, guest ids, names, emails, phone numbers, or other PII.
  - Cookie lookup is server-side only, using a hashed stored value in `GuestNavigationSession`.
- The page can be used without login.

## Required Brevkort states
- `Ogiltig länk`: safe invalid-token/missing-token page.
- `Opened — no answer yet`: first valid open; invite status flips to `opened`; cover panel and sticky OSA prompt are shown.
- `OSA — default form`: fresh OSA panel; default attendance is `Ja`, +1 is off, and SMS opt-in is on only when a valid phone is already prefilled; otherwise SMS opt-in defaults off so the simple path remains valid.
- `OSA — +1 hidden`: guests without +1 permission see no +1 prompt.
- `OSA — +1 expanded`: guests with +1 permission can reveal second-guest fields.
- `OSA — phone validation error`: phone field shows a rust/error underline and helper text.
- `OSA — submitting`: submit button is disabled and shows progress/spinner; form values are preserved.
- `OSA — save error`: error banner appears above the form and retry is available.
- `OSA — submitted (Tack)`: confirmation replaces the form and summarizes the saved answer.
- `Edit — already RSVP'd Ja/Nej/Kanske`: existing answer has distinct saved-state treatment and update copy.
- `Detaljer — updates published`: published updates render inline in the details panel.

## Data dependencies
- Brevkort details require explicit or deliberately mapped wedding settings for venue area/city, structured time-plan rows, dress code, child policy, gift info, Spotify URL, and public support email.
- Brevkort OSA +1 behavior requires `guests.plus_one_allowed` and named +1 RSVP detail fields.
- Phone values are compact E.164 with no spaces, for example `+46701234567`.

## Visual and UX requirements
- Mobile-first Brevkort artboard baseline is 390 px wide.
- Swedish guest-facing labels and copy are required for the invite experience.
- Use the Brevkort paper/letter visual direction:
  - Paper background: `#f1eadc`
  - Deep paper card: `#e6dcc7`
  - Ink: `#15130f`
  - Walnut: `#6f4f33`
  - Tan: `#b89978`
  - Rust/error/accent: `#b34a2c`
- Typography direction:
  - Serif display: Cormorant Garamond or equivalent.
  - UI/body: Inter/system sans.
  - Small uppercase metadata: IBM Plex Mono or equivalent monospace.
- Current RSVP status chips:
  - `Ja`: positive/green saved treatment.
  - `Nej`: neutral saved treatment.
  - `Kanske`: tan/lower-emphasis treatment with gentle nudge to confirm later.

## Non-functional requirements
- Mobile-first layout.
- Fast load for low-bandwidth connections.
- Accessible text contrast, touch targets, form labels, and keyboard navigation.
- No invalid-token path may leak guest-specific data or event logistics.

## Acceptance criteria
- Valid token opens the invite page quickly and renders the Brevkort three-panel experience.
- Invalid or missing token renders the safe invalid-link state and no guest/event logistics.
- First valid open updates status to `opened` and shows the cover panel with a path toward OSA.
- Wedding details section is visible before the OSA form.
- Valid invite pages include the interactive RSVP form and an Updates section.
- Existing RSVP responses show saved-state treatment, pre-fill the form, and use update copy.
- Submit, validation-error, save-error, plus-one-hidden, plus-one-expanded, and submitted-confirmation states match the Brevkort requirements.
- Opening a valid personal invite creates or refreshes a secure guest navigation cookie that can later link same-device QR hub uploads to the guest.

## Out of scope
- Guest login or account management
- Multiple wedding pages in one link
- Managing the real invite updates feed, covered by build item 11
