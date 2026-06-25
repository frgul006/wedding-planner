# Wedding Design Export Visual Matrix

This document maps the standalone design export to repo PRDs so each feature has a concrete visual target for “Done”.

- Source export at extraction time: `Wedding Design - Standalone.html` from the local Downloads folder. The source HTML is not committed; the extracted PNG references below are the repo-tracked source of truth.
- Extraction date: 2026-05-15
- Extraction method: `playwright-cli` element screenshots from `data-dc-slot` artboards at 1:1 scale.
- Mobile artboard baseline: 390 px wide for invite and hub states.

## Status legend

- `Functionally implemented, visual gap`: the behavior exists, but the app does not yet match the target artboard.
- `Fixture needed`: the target exists, but we still need deterministic seed/test data or a route to reproduce it locally.
- `Decision needed`: the export has alternate directions and we need to pick one before implementation.
- `Needs visual review`: a reference exists, but the current app has not yet been compared state-by-state against it.
- `No direct artboard`: the PRD names the state, but this export does not include a separate screenshot for it.

## Invite and RSVP visuals

| Design state | PRD owner(s) | Current local route / fixture | Target asset | Status |
| --- | --- | --- | --- | --- |
| `Ogiltig länk` | [`public-invite-page.md`](../prd/public-invite-page.md), [`invite-token-security.md`](../prd/invite-token-security.md) | `/invite/bad-token` or `/invite` | [`references/invite/ogiltig-lank.png`](references/invite/ogiltig-lank.png) | Functionally implemented, visual gap |
| `Opened — no answer yet` | [`public-invite-page.md`](../prd/public-invite-page.md), [`invite-status-workflow.md`](../prd/invite-status-workflow.md) | `/invite/local-ada-first-time-rsvp` | [`references/invite/opened-no-answer.png`](references/invite/opened-no-answer.png) | Functionally implemented, visual gap |
| `Detaljer — no updates` | [`invite-event-info-and-gifts.md`](../prd/invite-event-info-and-gifts.md), [`invite-updates-feed.md`](../prd/invite-updates-feed.md) | `/invite/local-ada-first-time-rsvp#detaljer` with no published updates | No direct artboard; use `Detaljer — updates published` with the whole updates section removed | No direct artboard |
| `Detaljer — updates published` | [`invite-event-info-and-gifts.md`](../prd/invite-event-info-and-gifts.md), [`invite-updates-feed.md`](../prd/invite-updates-feed.md) | Need seeded published updates fixture | [`references/invite/detaljer-updates-published.png`](references/invite/detaljer-updates-published.png) | Functionally implemented, visual gap; fixture needed |
| `OSA — default form` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md), [`phone-capture-for-rsvp.md`](../prd/phone-capture-for-rsvp.md) | `/invite/local-ada-first-time-rsvp#osa` | [`references/invite/osa-default-form.png`](references/invite/osa-default-form.png) | Functionally implemented, visual gap |
| `OSA — +1 hidden` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md), [`admin-guest-crud.md`](../prd/admin-guest-crud.md) | Any valid invite where `plus_one_allowed = false` | No direct artboard; assert absence against default form structure | No direct artboard |
| `OSA — +1 expanded` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md), [`phone-capture-for-rsvp.md`](../prd/phone-capture-for-rsvp.md) | Existing RSVP +1 edit fixture or new +1 fixture | [`references/invite/osa-plus-one-expanded.png`](references/invite/osa-plus-one-expanded.png) | Functionally implemented, visual gap; fixture needed |
| `OSA — phone validation error` | [`phone-capture-for-rsvp.md`](../prd/phone-capture-for-rsvp.md), [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md) | Submit invalid compact phone value on OSA form | [`references/invite/osa-phone-validation-error.png`](references/invite/osa-phone-validation-error.png) | Functionally implemented, visual gap |
| `OSA — submitting` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md) | Route-intercept delayed RSVP submit | [`references/invite/osa-submitting.png`](references/invite/osa-submitting.png) | Functionally implemented, visual gap; fixture needed |
| `OSA — save error` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md) | Mock failed server action / route failure | [`references/invite/osa-save-error.png`](references/invite/osa-save-error.png) | Functionally implemented, visual gap; fixture needed |
| `OSA — submitted (Tack)` | [`rsvp-form-submission.md`](../prd/rsvp-form-submission.md), [`rsvp-view-update.md`](../prd/rsvp-view-update.md) | `/invite/local-alan-existing-rsvp?rsvp_status=submitted#osa` | [`references/invite/osa-submitted-tack.png`](references/invite/osa-submitted-tack.png) | Functionally implemented, visual gap |
| `Edit — already RSVP'd Ja` | [`rsvp-view-update.md`](../prd/rsvp-view-update.md), [`public-invite-page.md`](../prd/public-invite-page.md) | `/invite/local-alan-existing-rsvp` | [`references/invite/edit-rsvp-ja.png`](references/invite/edit-rsvp-ja.png) | Functionally implemented, visual gap |
| `Edit — already RSVP'd Nej` | [`rsvp-view-update.md`](../prd/rsvp-view-update.md), [`public-invite-page.md`](../prd/public-invite-page.md) | Need seeded `rsvp no` fixture | [`references/invite/edit-rsvp-nej.png`](references/invite/edit-rsvp-nej.png) | Functionally implemented, visual gap; fixture needed |
| `Edit — Kanske` | [`rsvp-view-update.md`](../prd/rsvp-view-update.md), [`public-invite-page.md`](../prd/public-invite-page.md) | Need seeded `rsvp maybe` fixture | [`references/invite/edit-rsvp-kanske.png`](references/invite/edit-rsvp-kanske.png) | Functionally implemented, visual gap; fixture needed |

## Wedding hub visuals

| Design state | PRD owner(s) | Current local route / fixture | Target asset | Status |
| --- | --- | --- | --- | --- |
| `Attributed (cookie present)` | [`photo-upload-public.md`](../prd/photo-upload-public.md), [`invite-token-security.md`](../prd/invite-token-security.md) | Open valid invite, then `/wedding-hub` | [`references/hub/attributed-cookie-present.png`](references/hub/attributed-cookie-present.png) | Needs visual review |
| `Anonymous — allowed` | [`photo-upload-public.md`](../prd/photo-upload-public.md), [`wedding-event-settings.md`](../prd/wedding-event-settings.md) | `/wedding-hub` with anonymous upload enabled and no guest cookie | [`references/hub/anonymous-allowed.png`](references/hub/anonymous-allowed.png) | Needs visual review |
| `Anonymous — blocked` | [`photo-upload-public.md`](../prd/photo-upload-public.md), [`wedding-event-settings.md`](../prd/wedding-event-settings.md) | `/wedding-hub` with anonymous upload disabled and no guest cookie | [`references/hub/anonymous-blocked.png`](references/hub/anonymous-blocked.png) | Needs visual review; fixture needed |
| `Uploading (in flight)` | [`photo-upload-public.md`](../prd/photo-upload-public.md) | Delayed signed upload/finalize fixture | [`references/hub/uploading-in-flight.png`](references/hub/uploading-in-flight.png) | Needs visual review; fixture needed |
| `Pending review` | [`photo-upload-public.md`](../prd/photo-upload-public.md), [`photo-review-and-export.md`](../prd/photo-review-and-export.md) | Upload with `photo_upload_requires_review = true` | [`references/hub/pending-review.png`](references/hub/pending-review.png) | Needs visual review; fixture needed |
| `Rejected upload` | [`photo-upload-public.md`](../prd/photo-upload-public.md), [`photo-review-and-export.md`](../prd/photo-review-and-export.md) | Rejected upload fixture | [`references/hub/rejected-upload.png`](references/hub/rejected-upload.png) | Needs visual review; fixture needed |
| `Spotify not configured` | [`qr-code-generation.md`](../prd/qr-code-generation.md), [`wedding-event-settings.md`](../prd/wedding-event-settings.md) | `/wedding-hub` with blank Spotify URL | [`references/hub/spotify-not-configured.png`](references/hub/spotify-not-configured.png) | Needs visual review; fixture needed |
| `Photo upload gated` | [`qr-code-generation.md`](../prd/qr-code-generation.md), [`photo-upload-public.md`](../prd/photo-upload-public.md) | Feature-gated/coming-soon upload fixture | [`references/hub/photo-upload-gated.png`](references/hub/photo-upload-gated.png) | Needs visual review; may be historical item-13 state |
| `Empty feed (first scan)` | [`photo-upload-public.md`](../prd/photo-upload-public.md) | `/wedding-hub` with no approved photos/feed items | [`references/hub/empty-feed-first-scan.png`](references/hub/empty-feed-first-scan.png) | Needs visual review |

## Admin visuals

Direction B — Brevet Console is the chosen admin visual target. Direction B visual language should guide shell, typography, tone, and density; roster edit-session UX requirements may intentionally deviate from the static guest-list export.

| Design direction / screen | PRD owner(s) | Current local route | Target asset | Status |
| --- | --- | --- | --- | --- |
| Direction A — Studio overview | Admin dashboard / navigation docs, [`qr-code-generation.md`](../prd/qr-code-generation.md), [`photo-review-and-export.md`](../prd/photo-review-and-export.md) | `/admin` | [`references/admin/direction-a-overview.png`](references/admin/direction-a-overview.png) | Rejected admin direction |
| Direction A — Studio guests | [`admin-guest-crud.md`](../prd/admin-guest-crud.md), [`invite-status-workflow.md`](../prd/invite-status-workflow.md) | `/admin/guests` | [`references/admin/direction-a-guests.png`](references/admin/direction-a-guests.png) | Rejected admin direction |
| Direction B — Brevet Console overview | Admin dashboard / navigation docs, [`qr-code-generation.md`](../prd/qr-code-generation.md), [`photo-review-and-export.md`](../prd/photo-review-and-export.md) | `/admin` | [`references/admin/direction-b-overview.png`](references/admin/direction-b-overview.png) | Chosen target; real data only |
| Direction B — Brevet Console guests | [`admin-guest-crud.md`](../prd/admin-guest-crud.md), [`invite-status-workflow.md`](../prd/invite-status-workflow.md) | `/admin/guests` | [`references/admin/direction-b-guests.png`](references/admin/direction-b-guests.png) | Chosen target; edit-session UX deviations expected |

## Parallelization notes

Execution notes for the visual follow-up workstreams:

1. ✅ **Design-token/component foundation**: shared paper, typography, border, button, form-field, and status-strip primitives are available for follow-up invite visual-parity work.
2. **Explicit partner-name prerequisite**: add `partner_one_name` and `partner_two_name` wedding settings before invite shell or fixture work starts, so cover references do not depend on parsing `wedding.name`. This is a gate for items 24 and 27, not a parallel workstream.
3. **Invite shell/cover**: rebuild `Inbjudan` shell, invalid-link, opened/no-answer, and saved-answer cover states against the invite references while preserving server data loading. Keep Details and OSA internals for later passes.
4. **Fixture pack**: add deterministic seeds/tests for RSVP `Nej`, `Kanske`, +1 expanded, published updates, submitting, and save-error states. Use Playwright mocks for transient states and attach screenshots as CI artifacts without committing generated baselines.
5. **Details panel visual parity**: match timeline, venue/map, dress/gifts, music, updates, and `Vidare till OSA` treatment after the shell contract is stable.
6. **OSA state pack**: restyle the RSVP form states after the shared primitives and fixture states are available.
7. **Hub visual review**: compare `/wedding-hub` against the extracted hub references separately from invite work.
8. **Admin direction decision**: pick Direction A or B before any admin restyle PR.
