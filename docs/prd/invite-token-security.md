# PRD: Invite Token Generation and Security

**Version:** 0.2
**Status:** Implemented; upload attribution update pending
**Date:** 2026-05-09
**Scope:** Invite link creation, protection, and same-device guest attribution

## Why this is needed

Guest links must be private and hard to guess.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can create a private invite link for each guest.
- As an admin, I can regenerate a link if it is leaked.
- As a guest, I can only access data tied to my token.

## Functional requirements

- Generate one random token per guest.
- Token rules:
  - URL-safe text
  - At least 20 random characters
  - About 128 bits of randomness
- Token is mapped to guest record on server.
- Do not include guest id, name, or email in URL.
- Show link in guest list with copy button only when a raw token is newly generated.
- Raw tokens are not stored after creation.
- If an admin needs to copy a link again later, generate a new token and mark the old active token invalid.
- Regenerate button creates a new token and marks old token invalid.
- When a valid invite token is opened, create or refresh a `GuestNavigationSession` for that browser and set a secure opaque cookie.
- The guest navigation cookie is only for same-device convenience/attribution, such as linking later QR hub uploads to the guest; it must not grant extra access beyond what the route already allows.

## Security requirements

- Token lookups are done server-side before any PII is returned.
- Invalid token returns safe error page only.
- Do not expose raw tokens in downloadable public files.
- Guest navigation cookies must be random/unguessable, `HttpOnly`, `Secure`, `SameSite=Lax`, and signed or otherwise protected against tampering.
- Store only a hash of the guest navigation cookie value server-side.
- The guest navigation cookie must not contain raw invite tokens, guest ids, guest names, emails, phone numbers, or other PII.
- QR hub upload attribution must fail open while anonymous hub upload is enabled: if the cookie is missing, expired, invalid, or not linked to a guest, the upload remains anonymous rather than being blocked.
- If anonymous hub upload is disabled, missing or invalid cookie lookup must reject photo upload with a clear message instead of guessing identity.

## Acceptance criteria

- Test tokens cannot be guessed from one token to another.
- Regenerated token works and old token stops working.
- Invalid token returns no guest data.
- Opening a valid token creates or refreshes a secure guest navigation cookie without exposing the raw token to client-side JavaScript.
- A later QR hub upload from the same browser can be associated with the guest by server-side cookie lookup.
- A later QR hub upload without a valid cookie is accepted as anonymous when anonymous hub upload is enabled.

## Out of scope

- Password-required public links
- QR short-link alias service
