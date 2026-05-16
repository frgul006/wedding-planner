# Wedding App PRD Index

## Build order (smallest-first scope)

(Also documented in `build-order.md`)

1. ✅ **Admin authentication and route guard**
   - `admin-auth-and-route-guard.md`
2. ✅ **Admin guest CRUD**
   - `admin-guest-crud.md`
3. ✅ **Invite token security**
   - `invite-token-security.md`
4. ✅ **Wedding event settings**
   - `wedding-event-settings.md`
5. ✅ **Invite event info and gifts**
   - `invite-event-info-and-gifts.md`
6. ✅ **Public invite page**
   - `public-invite-page.md`
7. ✅ **RSVP form submission**
   - `rsvp-form-submission.md`
8. ✅ **RSVP view and update**
   - `rsvp-view-update.md`
9. ✅ **Invite status workflow**
   - `invite-status-workflow.md`
10. ✅ **Phone capture for RSVP**
   - `phone-capture-for-rsvp.md`
11. ✅ **Invite updates feed**
   - `invite-updates-feed.md`
12. ✅ **Admin messaging system**
   - `admin-messaging-system.md`
13. ✅ **QR code setup for guest hub shell**
   - `qr-code-generation.md`
14. ✅ **Guest session attribution foundation**
   - `invite-token-security.md`
   - `public-invite-page.md`
   - `../data-model.md`
15. ✅ **Photo storage and settings foundation**
   - `wedding-event-settings.md`
   - `photo-upload-public.md`
   - `photo-review-and-export.md`
   - `../data-model.md`
16. ✅ **Wedding hub upload flow (public)**
   - `photo-upload-public.md`
17. ✅ **Photo moderation and export**
   - `photo-review-and-export.md`
   - `../admin-photos.md`
18. ✅ **Brevkort invite data-model and admin prerequisites**
   - `admin-guest-crud.md`
   - `wedding-event-settings.md`
   - `rsvp-form-submission.md`
   - `phone-capture-for-rsvp.md`
   - `../data-model.md`
19. ⚠️ **Brevkort public invite shell and details panel** — functional shell exists; visual parity pending
   - `public-invite-page.md`
   - `invite-event-info-and-gifts.md`
   - `invite-updates-feed.md`
   - Visual targets: `../design/wedding-design-export.md`
20. ⚠️ **Brevkort OSA and RSVP state redesign** — functional RSVP states exist; visual parity pending
   - `rsvp-form-submission.md`
   - `rsvp-view-update.md`
   - `phone-capture-for-rsvp.md`
   - Visual targets: `../design/wedding-design-export.md`
21. ⚠️ **Brevkort invite QA and rollout** — defer visual QA sign-off until target screenshots match
   - `public-invite-page.md`
   - `rsvp-form-submission.md`
   - `rsvp-view-update.md`
   - Visual targets: `../design/wedding-design-export.md`

## Visual parity follow-up order

22. ✅ **Extract visual references and PRD ownership matrix**
   - `../design/wedding-design-export.md`
23. ✅ **Brevkort design-token and component foundation**
   - Shared paper, texture, typography, colors, borders, buttons, form fields, and status-strip primitives
23a. ✅ **Explicit couple-name fields prerequisite**
   - Added explicit `partner_one_name` / `partner_two_name` wedding settings before shell visual parity
   - See `invite-visual-parity-execution-plan.md`
24. ✅ **Invite shell, cover, invalid-link, and saved-answer states**
   - `public-invite-page.md`
   - `rsvp-view-update.md`
   - HITL sign-off notes: `../../issues/done/009-shell-cover-visual-review-notes.md`
   - See `invite-visual-parity-execution-plan.md`
25. **Details panel visual parity**
   - `invite-event-info-and-gifts.md`
   - `invite-updates-feed.md`
26. **OSA visual state pack**
   - `rsvp-form-submission.md`
   - `rsvp-view-update.md`
   - `phone-capture-for-rsvp.md`
27. ✅ **Visual fixtures and QA harness**
   - deterministic fixtures for `Nej`, `Kanske`, +1 expanded, published updates, submitting, and save-error states
   - See `invite-visual-parity-execution-plan.md`
28. **Wedding hub visual parity review**
   - `photo-upload-public.md`
   - `qr-code-generation.md`
   - `photo-review-and-export.md`
29. **Admin visual direction decision**
   - choose Direction A or B from `../design/references/admin/`

See `build-order.md` for dependencies and parallelization notes.

## Future / optional

- **SMS delivery reports**
  - `sms-delivery-reports.md`

All files are written in simple, ELI5-friendly structure and wording.
