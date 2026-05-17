# Admin SMS messaging

Admin SMS messaging is implemented at `/admin/messages`.

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

## Sending behavior

The admin composer supports these audiences:

- all guests
- RSVP yes
- RSVP no
- RSVP maybe

Only active, non-archived guests who have opted in to SMS updates and have strict E.164 phone numbers, for example `+46701234567`, are included. RSVP audiences use each Guest's dedicated `rsvp_status`, not opened-Invite activity. The optional title is prepended to the SMS body before sending.

Current delivery state is the provider send attempt state only. `sent` means 46elks accepted the SMS request; it does not mean carrier/device delivery. Delivery receipt tracking is intentionally out of scope for this implementation.

## Local validation

1. Apply Supabase migrations.
2. Sign in as the seeded admin.
3. Open `/admin/messages`.
4. Verify recipient counts and the composer render. Counts include only opted-in guests with valid E.164 phone numbers.
5. Use `pnpm sms:test` for a one-recipient 46elks smoke test before sending real blasts.
