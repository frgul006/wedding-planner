# Wedding App Build Order (Small PRD Scope)

## Recommended delivery order

1. ✅ Complete — Admin authentication + `/admin` route guard
2. ✅ Complete — Admin guest CRUD
3. ✅ Complete — Invite token security
4. ✅ Complete — Wedding event settings
5. ✅ Complete — Invite event info and gifts
6. ✅ Complete — Public invite page
7. ✅ Complete — RSVP form submission
8. ✅ Complete — RSVP view/update
9. ✅ Complete — Invite status workflow
10. ✅ Complete — Phone capture for RSVP
11. ✅ Complete — Invite updates feed
12. ✅ Complete — Admin messaging system
    - Keep the merged 46elks SMS work before starting photo admin screens, because both areas touch admin navigation and may add database migrations.
13. ✅ Complete — QR code setup for guest hub shell
    - Admin can download/print one QR code.
    - QR opens the shared `/wedding-hub` route.
    - Hub can show the Spotify playlist action immediately.
    - Photo upload may be shown as a disabled/coming-soon entry point only; real upload behavior is item 16.
14. ✅ Complete — Guest session attribution foundation
    - Opening a valid personal invite link creates/refreshes a secure guest navigation cookie.
    - This can be built after messaging and before public photo upload so QR uploads can be attributed when possible.
15. ✅ Complete — Photo storage and settings foundation
    - Supabase Storage private bucket setup.
    - `PhotoUpload` metadata table/model, including upload verification status.
    - `photo_upload_requires_review` wedding setting, default off/open.
    - Confirm `allow_anonymous_hub_upload` remains default on.
16. ✅ Complete — Wedding hub upload flow (public)
    - Turns the item 13 photo entry point into a working upload flow.
    - Direct signed browser uploads to Supabase Storage.
    - Anonymous QR uploads by default, with same-device guest inference from the secure cookie when available.
17. ✅ Complete — Photo moderation and export
    - Admin can review uploads at `/admin/photos` with status filters, pagination, short-lived signed previews, and 15-second auto-refresh.
    - Admin can approve, hide, or delete/tombstone uploads.
    - Public gallery/feed and ZIP export include only verified, approved, non-deleted photos.
    - Admin can download approved originals from `/admin/photos/export` as a ZIP; missing storage objects are skipped with an export warning entry.
18. ✅ Complete — Brevkort invite data-model and admin prerequisites
    - Add or deliberately map Brevkort-dependent wedding fields from `../design/brevkort-invite-states.md`: venue area/city, structured time-plan rows, dress code, child policy, gifts, Spotify, and invite-support contact.
    - Add `guests.plus_one_allowed` and expose it in `/admin/guests` so admins can control per guest whether the OSA page offers a +1.
    - Add named +1 RSVP detail persistence and +1 SMS consent fields before replacing the old generic extra guest count UI.
    - Keep phone values compact E.164 with no spaces, for example `+46701234567`.
19. ⚠️ Functional complete; visual parity pending — Brevkort public invite shell and details panel
    - Build the three-panel mobile invite: `Inbjudan`, `Detaljer`, `OSA`.
    - Include the safe invalid-link state, top progress navigation, cover CTA, opened/no-answer state, and saved-answer cover treatment.
    - Build the Brevkort `Detaljer` panel: `Tidsplan`, `Plats`, `Klädkod` / `Gåvor`, `Musik`, updates empty state, and published updates.
    - Visual acceptance now depends on `../design/wedding-design-export.md` and extracted invite screenshots.
20. ⚠️ Functional complete; visual parity pending — Brevkort OSA and RSVP state redesign
    - Build default OSA form, +1 hidden state for disallowed guests, +1 expanded fields for allowed guests, phone/SMS controls, submitting state, save-error state, and `Tack` confirmation.
    - Pre-fill edit mode and return from `Uppdatera mitt svar` to an editable OSA form.
    - Enforce +1 permission server-side; hiding the UI is not enough.
    - Visual acceptance now depends on `../design/wedding-design-export.md` and extracted OSA/edit screenshots.
21. ⚠️ Pending visual sign-off — Brevkort invite QA and rollout
    - Validate with lint/build plus Playwright coverage of: invalid link, first open, details panel, default OSA submit, compact-phone validation error, +1 hidden for disallowed guests, +1 expanded for allowed guests, existing-answer edit, save error, submitted confirmation, empty updates, and published updates.
    - Confirm token security and guest-navigation cookie behavior are unchanged.
    - Final rollout should wait until visual captures match the extracted references or documented intentional differences.

## Visual parity follow-up order

These are the next build items that turn the completed functionality above into the target design. Use `../design/wedding-design-export.md` as the acceptance matrix.

22. ✅ Complete — Extract visual references and PRD ownership matrix
    - Capture stable PNG references from the standalone export.
    - Map each visual state to its owning PRD, local fixture/route, and current status.
    - Mark existing PRDs as functionally complete but visually pending where appropriate.
23. ✅ Complete — Brevkort design-token and component foundation
    - Created shared paper, dotted texture, ink/walnut/rust colors, border, spacing, serif display, sans body, mono metadata, button, status-strip, card, and form-field primitives.
    - Built reusable invite primitives before the remaining panel visual-parity passes.
23a. ✅ Complete — Explicit couple-name fields prerequisite
    - Added `weddings.partner_one_name` and `weddings.partner_two_name` and exposed them as optional admin settings with helper text.
    - Public invite covers use safe placeholders when explicit names are blank instead of parsing `wedding.name`.
    - Local seed data populates `Fredrik` and `Matilda` so visual fixtures match the cover references by default.
24. ⚠️ AFK complete; visual review pending — Invite shell, cover, invalid-link, and saved-answer states
    - Rebuilt the centered mobile 390 px postcard shell with one primary panel at a time, swipe support, hash deep links, dot/arrow navigation, disabled end arrows, compact date formatting, and explicit partner-name rendering.
    - Matched `Ogiltig länk`, `Opened — no answer yet`, and saved-answer/edit cover references at close parity, with intentional differences documented in PRs.
    - Kept the implementation scope to shell/cover/invalid/saved-answer treatment; items 25 and 26 still own Details and OSA internals.
    - Remaining item 24 work is the HITL visual review in `issues/009-shell-cover-visual-review-notes.md`.
25. Next — Details panel visual parity
    - Match timeline, venue/map, dress/gifts, music, empty updates, published updates, and `Vidare till OSA` treatment.
26. Next — OSA visual state pack
    - Match default form, +1 hidden/expanded, phone validation error, submitting, save error, submitted `Tack`, and existing-answer edit states.
27. ✅ Complete — Visual fixtures and QA harness
    - Added deterministic fixtures for RSVP `Nej`, `Kanske`, +1 expanded, and published updates.
    - Added Playwright route interception/mocks for transient submitting and save-error states.
    - Runs visual QA specs in default E2E CI, asserting key content and attaching screenshots as artifacts without committing generated baselines.
28. Later / parallel — Wedding hub visual parity review
    - Compare `/wedding-hub` states against `references/hub/` and split implementation work after invite parity is underway.
29. Later / decision needed — Admin visual direction
    - Choose Direction A or Direction B from `references/admin/` before restyling admin pages.

## Parallelization notes

- Items 23a and 27 are complete, so follow-up invite visual-parity work can rely on explicit partner names and stable visual QA fixtures.
- Item 24 AFK implementation is complete; only the HITL visual review remains before considering item 24 visually signed off.
- Items 25 and 26 can run in parallel now that the shell/navigation contract from item 24 is stable.
- Item 28 can run independently from invite work, as long as it does not change shared invite primitives.
- Item 29 is a product/design decision and should happen before any admin restyle implementation.

## Why this order

- Items 1–17 are complete foundation work.
- Items 18–21 delivered the functional Brevkort data model, invite shell, OSA behavior, and test coverage, but visual parity is not signed off.
- Item 22 makes “Done” measurable before more UI work starts.
- Item 23 came before major restyling so shell, details, and OSA work share one visual system instead of duplicating Tailwind classes.
- Item 23a kept explicit partner-name data out of the item 24 UI PR while avoiding parser-based cover-name rendering.
- Item 24 established the final panel/navigation contract before item 25 details and item 26 OSA plug into it.
- Item 27 supplied fixture and artifact coverage for visual review without committing generated baselines.
- Hub and admin visual work are intentionally later/parallel so invite parity does not get blocked by unrelated design decisions.
