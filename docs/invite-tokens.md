# Invite tokens

Private guest invite links are backed by `public.invite_tokens`.

## Security model

- Raw invite tokens are generated server-side with 32 random bytes and encoded with URL-safe base64.
- Only a SHA-256 hash of the raw token is stored in the database.
- `token_hash` is globally unique.
- A partial unique index allows only one active token per guest.
- Active tokens default to `access_scope = full`, granting full Invite access for Invited Guests.
- Regenerating a link invalidates the previous active token before creating a new active token.
- Raw links are shown in the admin UI only in the immediate generate/regenerate result and are not stored client-side by the app.

## Admin behavior

On `/admin/guests`:

- Guests without an active token show **Generate invite link**.
- Guests with an active token show **Regenerate invite link**.
- After generation, the raw `/invite/:token` URL is displayed with a copy button.
- Reloading the page hides the raw URL; admins must regenerate if they need a new copy.

## Invite access validation

`/invite/[token]` resolves **Invite access** by hashing the path token and looking up an active `invite_tokens` row with `access_scope = full` for a non-archived Invited Guest. `/invite` without a token does not validate anything and renders the same safe invalid-link page.

- Granted Invite access: displays the Guest name and Wedding information from the linked `weddings` row.
- Denied Invite access for invalid, inactive, archived-guest, or missing tokens: displays the safe invalid-link message without Guest data, venue, schedule, RSVP state, or other event logistics. When a configured/default wedding has a public `invite_support_email`, the page may show that support email and explicit partner contact names so guests can request a fresh link; otherwise it falls back to generic host copy.

The `lib/invite-access.ts` Module is the shared policy seam for proxy and page adapters. The proxy still extracts the raw token and writes cookies to the response, while the Module resolves granted/denied access and prepares the Guest navigation session cookie payload. The Invite page uses the same Module to resolve access and records opened status only after access is granted.

## Invite opened status

After `/invite/[token]` grants Invite access, the server calls `public.mark_invite_opened(p_guest_id, p_wedding_id)`. The function updates the linked Guest's opened-Invite activity from `not replied` to `opened` only when that is still the current `invite_status`. Dedicated `rsvp_status` values (`rsvp yes/no/maybe`) are stored separately and left unchanged, so reopening an Invite after RSVP never downgrades the RSVP status.

## Guest navigation session

Opening a valid `/invite/[token]` route creates or refreshes the `wp_guest_navigation` cookie before the Invite page renders. The cookie is opaque 32-byte random data, not the raw invite token or Guest PII. It is set as `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, with a 180-day expiry.

Only a SHA-256 hash of the cookie value is stored in `public.guest_navigation_sessions`, linked to the Wedding, Guest, and invite token that created the session. Invalid, inactive, archived-guest, and missing-token Invite pages do not set or refresh this cookie. The cookie is for later same-device QR/photo attribution only; it does not grant Invite access by itself.

## Guest-facing event information

Valid invite pages render the Brevkort three-panel invite shell:

1. `Inbjudan` with the personalized cover, opened/no-answer CTA state, or saved-answer treatment for existing RSVP responses.
2. `Detaljer` with the current wedding settings:
   - wedding date and time, formatted with Swedish `Intl` defaults for `Europe/Stockholm`
   - venue name, area/city, address, and `Visa karta` link when a safe `http` or `https` URL is configured
   - structured time plan entries
   - dress code, child policy, and legacy policy notes
   - gift information
   - Spotify playlist link when a safe `http` or `https` URL is configured
   - latest five published wedding updates in reverse `updated_at` order
3. `OSA` with the Brevkort RSVP states: default/edit form, allowed +1 expansion, inline validation/save errors, and submitted `Tack` confirmation.

Missing optional text or list fields show `Kommer snart`; missing map URLs show `Kartlänk kommer snart`, and missing playlist URLs show non-clickable coming-soon text. If no updates are published, the guest-facing `Uppdateringar` section is omitted.

## RSVP submission

Valid `/invite/[token]` pages let the linked guest submit or update:

- attendance: `yes`, `no`, or `maybe`
- optional phone number, using compact E.164 format like `+46701234567`
- optional SMS updates opt-in, which requires a valid phone number
- optional named +1 details only when `guests.plus_one_allowed = true`
- optional +1 phone and separate +1 SMS consent when the +1 block is expanded
- optional food preference
- optional allergy / special notes

The phone input is pre-filled from the linked `guests.phone` value. Blank phone is allowed unless SMS updates opt-in is selected; any provided phone must match strict compact country-code format with a leading `+` and digits only, for example `+46701234567`. Invalid phone values stay on the OSA panel with clear inline validation errors.

The Brevkort OSA UI uses a per-guest +1 toggle instead of the old generic extra guest count. The data model stores named +1 details and separate +1 SMS consent. Guests may submit named +1 details only when `guests.plus_one_allowed = true`; server-side validation rejects +1 payloads for guests where that flag is false. Choosing `Nej, bara jag` on a later edit saves `extra_guests = 0` and clears stored `plus_one_*` RSVP details.

When the linked guest already has an RSVP response, the invite page shows the current answer, `last_submitted_at`, and pre-fills the OSA form so the guest can update the same response from the same link. Reopening an invite also pre-fills the latest linked guest phone so the guest can change it on a later RSVP update.

Submission is handled by a server action that hashes the raw URL token and calls the `public.submit_rsvp_response` database function. That function revalidates the active full-scope invite token and atomically upserts the response into `public.rsvp_responses` for the token's `guest_id` and `wedding_id`, with `updated_via_token_id` set to the active invite token. The linked guest's `phone`, `sms_opt_in`, and opt-in/out timestamps are saved to `public.guests`; `invite_status` is preserved as opened-Invite activity and `rsvp_status` is updated in the same transaction to `rsvp yes`, `rsvp no`, or `rsvp maybe` to match the latest submitted attendance.

Invalid, inactive, archived-guest, or missing-token pages keep rendering the safe invalid-link message and never show the RSVP form.

## Local validation

```bash
supabase db reset
pnpm seed:local
pnpm lint
pnpm build
PORT=3100 pnpm test:e2e e2e/smoke.spec.ts e2e/rsvp.spec.ts e2e/wedding-updates.spec.ts e2e/guest-navigation-session.spec.ts e2e/admin-guests.spec.ts
```

Then log in as the seeded admin and validate the invite status workflow:

1. Visit a fresh valid invite link and verify the guest row moves from `not replied` to `opened`.
2. Reopen the same invite before RSVP and verify the guest row remains `opened` with `rsvp_status = not replied`.
3. Submit an RSVP and verify `rsvp_status` moves to the matching `rsvp yes/no/maybe` status without creating duplicate response rows while `invite_status` remains `opened`.
4. Reopen the invite after RSVP and verify `rsvp_status` stays `rsvp yes/no/maybe` instead of downgrading.
5. Update the RSVP and verify `rsvp_status` moves to the latest matching RSVP status.
6. Submit without a phone and verify the RSVP still saves.
7. Submit an invalid phone and verify the invite shows the phone-format validation error.
8. Submit a valid phone and verify it appears in the admin guest row.
9. Submit with SMS opt-in and verify the guest is eligible for SMS message counts.
10. Reopen the invite and verify the saved phone and SMS opt-in pre-fill and can be updated.
11. Create a published update in `/admin/updates` and verify it appears in the invite Updates section.
12. Change the update to draft or archived and verify it is hidden from the invite page.
13. Regenerate the link and verify the old link becomes invalid while the new link remains valid.
14. Open a valid invite and verify the browser receives the secure `wp_guest_navigation` cookie.
15. Open `/invite` and an invalid `/invite/:token` URL in a clean browser context and verify neither sets `wp_guest_navigation`.

For the guest-facing RSVP, updates, and guest navigation session flow, also run the local app and capture a `playwright-cli snapshot` after opening a valid `/invite/[token]` page.
