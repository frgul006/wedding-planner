# Admin SMS messaging

Admin SMS messaging is implemented at `/admin/messages`. The page contains a generic SMS composer and a dedicated Invite SMS flow for sending individual Invite links.

## Provider

The first provider integration uses 46elks.

Required server-only environment variables:

```bash
ELK46_USER=replace-with-46elks-api-username
ELK46_PASSWORD=replace-with-46elks-api-password
```

Optional:

```bash
ELK46_FROM=Wedding
ELK46_TEST_PHONE_NUMBER=+46700000000
ELK46_MOCK_SEND=0
```

`ELK46_FROM` defaults to `Wedding` and must be either an E.164 phone number or 1-11 alphanumeric characters. `ELK46_MOCK_SEND=1` bypasses real provider calls for local/e2e testing. Do not prefix provider secrets with `NEXT_PUBLIC_`.

Run a direct provider smoke test with:

```bash
pnpm sms:test
```

That command sends a real SMS to `ELK46_TEST_PHONE_NUMBER` and may incur 46elks costs.

## Data model

SMS history is stored in:

- `public.message_blasts`
- `public.message_deliveries`

`message_blasts.message_kind` is `custom` for generic admin SMS and `invite_sms` for Invite SMS sends.

Both tables are wedding-scoped and protected by RLS. Active admins can view, create, and update rows for their own wedding.

`message_blasts.send_status` is one of:

- `queued`
- `sent`
- `partial`
- `failed`

`message_deliveries.delivery_status` is one of:

- `queued`
- `sent`
- `failed`

## Invite SMS behavior

The Invite SMS flow sends personal Invite links to Invited Guests from a saved Wedding-scoped template. The default template is:

```txt
Hej {{first_name}}! Välkomna att fira vår dag tillsammans med oss. Här är er personliga inbjudan där ni kan OSA: {{invite_link}} / Fredrik & Matilda
```

The template is edited and saved from `/admin/messages`. It must include `{{first_name}}` and `{{invite_link}}`; unknown placeholders are rejected. `{{first_name}}` renders the first word of `guests.full_name`. The preview uses a fake link and does not mutate Invite tokens. Test sends use `ELK46_TEST_PHONE_NUMBER`, a fixed sample first name, and a fake link; test sends are not saved to message history.

Bulk Invite SMS sends target active Invited Guests who are Message targets, have no prior `sent` Invite SMS delivery, have not opened their Invite, and have not submitted an RSVP. Plus-one Guests are excluded from bulk Invite SMS. Admins can explicitly send or resend one current Invited Guest Message target regardless of RSVP status. Each real Invite SMS send generates a fresh full Invite link and invalidates any previous active full link for that Invited Guest. Failed send attempts leave generated links active; later retries generate fresh links.

Invite SMS history reuses `message_blasts` and `message_deliveries` with `message_kind = invite_sms`. History stores template text and `invite_token_id` references, not raw Invite links. Before real non-mock sends, the app requires a configured production public URL and blocks local, preview, and staging origins.

## Generic SMS sending behavior

The admin composer supports these audiences:

- all guests
- RSVP yes
- RSVP no
- RSVP maybe

Only active, non-archived **Message target** Guests who have opted in to SMS updates, have no SMS opt-out timestamp, and have strict E.164 phone numbers, for example `+46701234567`, are included. Admin composer counts and sends use the same Message target selection. RSVP audiences use an Invited Guest's dedicated `rsvp_status`; Plus-one Guests inherit the tied Invited Guest's RSVP status for audience selection. Duplicate phone numbers are not deduped: each eligible Guest record gets its own delivery row. The optional title is prepended to the SMS body before sending.

Current delivery state is the provider send attempt state only. `sent` means 46elks accepted the SMS request; it does not mean carrier/device delivery. Delivery receipt tracking is intentionally out of scope for this implementation.

## Local validation

1. Apply Supabase migrations.
2. Sign in as the seeded admin.
3. Open `/admin/messages`.
4. Verify Message target counts and the composer render. Counts include only opted-in, non-opted-out Guests with valid E.164 phone numbers; Plus-one Guests appear in RSVP audiences through their tied Invited Guest's RSVP status.
5. Verify the Invite SMS card can save/preview the template, list eligible/skipped Guests, show duplicate-phone warnings, and send in mock mode.
6. Use `pnpm sms:test` for a one-recipient 46elks smoke test before sending real blasts.
