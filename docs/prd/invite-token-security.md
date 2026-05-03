# PRD: Invite Token Generation and Security

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Invite link creation and protection

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

## Security requirements

- Token lookups are done server-side before any PII is returned.
- Invalid token returns safe error page only.
- Do not expose raw tokens in downloadable public files.

## Acceptance criteria

- Test tokens cannot be guessed from one token to another.
- Regenerated token works and old token stops working.
- Invalid token returns no guest data.

## Out of scope

- Password-required public links
- QR short-link alias service
