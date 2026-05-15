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
19. ✅ Complete — Brevkort public invite shell and details panel
    - Build the three-panel mobile invite: `Inbjudan`, `Detaljer`, `OSA`.
    - Include the safe invalid-link state, top progress navigation, cover CTA, opened/no-answer state, and saved-answer cover treatment.
    - Build the Brevkort `Detaljer` panel: `Tidsplan`, `Plats`, `Klädkod` / `Gåvor`, `Musik`, updates empty state, and published updates.
20. Brevkort OSA and RSVP state redesign
    - Build default OSA form, +1 hidden state for disallowed guests, +1 expanded fields for allowed guests, phone/SMS controls, submitting state, save-error state, and `Tack` confirmation.
    - Pre-fill edit mode and return from `Uppdatera mitt svar` to an editable OSA form.
    - Enforce +1 permission server-side; hiding the UI is not enough.
21. Brevkort invite QA and rollout
    - Validate with lint/build plus Playwright coverage of: invalid link, first open, details panel, default OSA submit, compact-phone validation error, +1 hidden for disallowed guests, +1 expanded for allowed guests, existing-answer edit, save error, submitted confirmation, empty updates, and published updates.
    - Confirm token security and guest-navigation cookie behavior are unchanged.

## Why this order

- Items 1–17 are complete foundation work.
- Add the Brevkort redesign after the completed foundation so the new invite work is explicit follow-up scope instead of rewriting completed milestones.
- Ship Brevkort data-model/admin prerequisites before UI states that depend on them.
- Build the Brevkort shell/details before the OSA state redesign so RSVP work can plug into the final panel structure.
- Keep QA/rollout last because it depends on the new data fields, admin controls, invite shell, and OSA states.
