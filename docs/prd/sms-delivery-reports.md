# PRD: SMS Delivery Reports

**Version:** 0.1
**Status:** Future / Optional
**Date:** 2026-05-09
**Scope:** Carrier/provider delivery status tracking for SMS blasts

## Why this is needed

Admins may want to know whether 46elks and downstream carriers reported an SMS as delivered or failed after the initial send request.

The current SMS messaging implementation only records whether 46elks accepted the send request (`sent`) or whether the request failed (`failed`). It does not track carrier/device delivery.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can see when an SMS was accepted by 46elks.
- As an admin, I can optionally see later provider delivery reports when carriers confirm delivery or failure.
- As an admin, I can distinguish provider acceptance from actual delivery.

## Functional requirements

- Send 46elks SMS requests with a `whendelivered` callback URL.
- Add a webhook route for 46elks delivery reports.
- Verify callback authenticity using a shared secret or authenticated callback URL.
- Match callback message `id` to `message_deliveries.provider_message_id`.
- Update delivery rows from `sent` to provider-reported terminal states.
- Show delivery report timestamps in message history.

## Non-functional requirements

- Webhook must be idempotent.
- Webhook must not expose guest phone numbers or message body in logs.
- Failed webhook responses should be avoided because 46elks retries failed callbacks.

## Acceptance criteria

- A message accepted by 46elks first appears as `sent`.
- A later 46elks delivery report can update the row to delivered or failed.
- Admin UI clearly explains that delivered means provider/carrier delivery confirmation, not that the guest opened or read the SMS.
- Unknown or missing provider IDs do not update any delivery rows and are logged safely.

## Out of scope

- Read/open tracking. SMS does not provide read receipts.
- Two-way guest replies.
- Automatic retry/resend of failed SMS messages.
