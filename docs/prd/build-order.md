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
23. Next — Brevkort design-token and component foundation
    - Create shared paper, dotted texture, ink/walnut/rust colors, border, spacing, serif display, sans body, and mono metadata primitives.
    - Build reusable invite primitives before restyling individual panels.
24. Next — Invite shell, cover, invalid-link, and saved-answer states
    - Rebuild the mobile 390 px postcard shell with one primary panel at a time, dot/arrow navigation, compact date formatting, and proper couple-name rendering.
    - Match `Ogiltig länk`, `Opened — no answer yet`, and saved-answer/edit cover references.
25. Next — Details panel visual parity
    - Match timeline, venue/map, dress/gifts, music, empty updates, published updates, and `Vidare till OSA` treatment.
26. Next — OSA visual state pack
    - Match default form, +1 hidden/expanded, phone validation error, submitting, save error, submitted `Tack`, and existing-answer edit states.
27. Next — Visual fixtures and QA harness
    - Add deterministic seeds or test fixtures for RSVP `Nej`, `Kanske`, +1 expanded, published updates, submitting, and save-error states.
    - Capture Playwright reference screenshots for changed flows and compare against target assets or documented intentional differences.
28. Later / parallel — Wedding hub visual parity review
    - Compare `/wedding-hub` states against `references/hub/` and split implementation work after invite parity is underway.
29. Later / decision needed — Admin visual direction
    - Choose Direction A or Direction B from `references/admin/` before restyling admin pages.

## Parallelization notes

- Items 23 and 27 can start in parallel: one person builds shared primitives while another makes deterministic fixtures.
- Item 24 should wait for enough of item 23 to avoid duplicating visual primitives.
- Items 25 and 26 can run in parallel after the shell/navigation contract from item 24 is stable.
- Item 28 can run independently from invite work, as long as it does not change shared invite primitives.
- Item 29 is a product/design decision and should happen before any admin restyle implementation.

## Why this order

- Items 1–17 are complete foundation work.
- Items 18–21 delivered the functional Brevkort data model, invite shell, OSA behavior, and test coverage, but visual parity is not signed off.
- Item 22 makes “Done” measurable before more UI work starts.
- Item 23 comes before major restyling so shell, details, and OSA work share one visual system instead of duplicating Tailwind classes.
- Item 24 establishes the final panel/navigation contract before item 25 details and item 26 OSA plug into it.
- Item 27 can run alongside UI work because fixture gaps block visual acceptance but do not require the final components.
- Hub and admin visual work are intentionally later/parallel so invite parity does not get blocked by unrelated design decisions.
