# Invite tokens

Private guest invite links are backed by `public.invite_tokens`.

## Security model

- Raw invite tokens are generated server-side with 32 random bytes and encoded with URL-safe base64.
- Only a SHA-256 hash of the raw token is stored in the database.
- `token_hash` is globally unique.
- A partial unique index allows only one active token per guest.
- Regenerating a link invalidates the previous active token before creating a new active token.
- Raw links are shown in the admin UI only in the immediate generate/regenerate result and are not stored client-side by the app.

## Admin behavior

On `/admin/guests`:

- Guests without an active token show **Generate invite link**.
- Guests with an active token show **Regenerate invite link**.
- After generation, the raw `/invite/:token` URL is displayed with a copy button.
- Reloading the page hides the raw URL; admins must regenerate if they need a new copy.

## Public validation

`/invite/[token]` validates a token by hashing the path token and looking up an active `invite_tokens` row. `/invite` without a token does not validate anything and renders the same safe invalid-link page.

- Valid active token: displays the guest name and wedding event information from the linked `weddings` row.
- Invalid, inactive, archived-guest, or missing token: displays a generic invalid-link message without guest or wedding data.

## Invite opened status

After `/invite/[token]` successfully validates an active token, the server calls `public.mark_invite_opened(p_guest_id, p_wedding_id)`. The function updates the linked guest from `not replied` to `opened` only when that is still the current status. Existing `opened` and `rsvp yes/no/maybe` statuses are left unchanged, so reopening an invite after RSVP never downgrades the admin-visible status.

## Guest-facing event information

Valid invite pages show the current wedding settings:

- wedding name
- wedding date and time, formatted with Swedish `Intl` defaults for `Europe/Stockholm`
- venue name and address
- Google Maps link when a safe `http` or `https` URL is configured
- time plan entries
- policy / dress code
- gift information
- Spotify playlist link when a safe `http` or `https` URL is configured

Missing optional text or list fields show `Coming soon`; missing map or playlist URLs show non-clickable coming-soon text. Valid invite pages also show an interactive RSVP form and a non-interactive `Updates coming soon` placeholder. The real invite updates feed remains build item 11.

## RSVP submission

Valid `/invite/[token]` pages let the linked guest submit or update:

- attendance: `yes`, `no`, or `maybe`
- extra guest count, defaulting to `0`
- optional food preference
- optional allergy / special notes

When the linked guest already has an RSVP response, the invite page shows the current answer, `last_submitted_at`, and pre-fills the form so the guest can update the same response from the same link.

Submission is handled by a server action that hashes the raw URL token and calls the `public.submit_rsvp_response` database function. That function revalidates the active invite token and atomically upserts the response into `public.rsvp_responses` for the token's `guest_id` and `wedding_id`, with `updated_via_token_id` set to the active invite token. The linked guest's `invite_status` is updated in the same transaction to `rsvp yes`, `rsvp no`, or `rsvp maybe` to match the latest submitted attendance.

Invalid, inactive, archived-guest, or missing-token pages keep rendering the generic invalid-link message and never show the RSVP form.

## Local validation

```bash
supabase db reset
pnpm seed:local
pnpm lint
pnpm build
```

Then log in as the seeded admin and validate the invite status workflow:

1. Visit a fresh valid invite link and verify the guest row moves from `not replied` to `opened`.
2. Reopen the same invite before RSVP and verify the guest row remains `opened`.
3. Submit an RSVP and verify the guest row moves to the matching `rsvp yes/no/maybe` status without creating duplicate response rows.
4. Reopen the invite after RSVP and verify the status stays `rsvp yes/no/maybe` instead of downgrading to `opened`.
5. Update the RSVP and verify the guest row moves to the latest matching RSVP status.
6. Regenerate the link and verify the old link becomes invalid while the new link remains valid.

For the guest-facing RSVP flow, also run the local app and capture a `playwright-cli snapshot` after reopening a successful `/invite/[token]` submission.
