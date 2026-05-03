# PRD: Admin Login and Route Guard

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Admin access

## Why this is needed

Only bride, groom, and staff should manage wedding data.

## Users

- Bride
- Groom
- Wedding staff

## User stories

- As an admin, I can go to `/admin` and log in.
- As an admin, I cannot open admin pages without login.
- As an admin, I can log out when I am done.

## Functional requirements

- Create an `/admin/login` page with email and password.
- Protect all URLs that start with `/admin/*`.
- If not logged in, redirect to `/admin/login`.
- After successful login, redirect to admin dashboard.
- Add a secure logout button in admin.
- Seed first admin account from secure setup.
- Allow logged-in admins to invite new admins by email.
- Admin identity is matched by email/username.

## Security requirements

- Store password checks safely (no plain-text passwords).
- Track failed login count and lock account after repeated bad logins for a short time.
- Add session timeout (for example, auto-log out after inactivity).
- Admin actions (including inviting admins) require authentication and role checks.

## Non-functional requirements

- Clear login error text on wrong details.
- Works on mobile and desktop.

## Acceptance criteria

- Unauthenticated user cannot access `/admin` pages.
- Wrong password shows a clear error and no session is created.
- Active session user can log out and is blocked from admin pages.
- First admin can be created from initial secure setup.
- Logged-in admin can invite another admin by email.

## Out of scope

- Social login
- Multi-admin roles in this first version
