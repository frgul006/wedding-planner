# Wedding App Build Order (Small PRD Scope)

## Recommended delivery order

1. Admin authentication + `/admin` route guard
2. Admin guest CRUD
3. Invite token security
4. Wedding event settings
5. Invite event info and gifts
6. Public invite page
7. RSVP form submission
8. RSVP view/update
9. Invite status workflow
10. Phone capture for RSVP
11. Invite updates feed
12. Admin messaging system
    - Keep the merged 46elks SMS work before starting photo admin screens, because both areas touch admin navigation and may add database migrations.
13. QR code setup for guest hub shell
    - Admin can download/print one QR code.
    - QR opens the shared `/wedding-hub` route.
    - Hub can show the Spotify playlist action immediately.
    - Photo upload may be shown as a disabled/coming-soon entry point only; real upload behavior is item 16.
14. Guest session attribution foundation
    - Opening a valid personal invite link creates/refreshes a secure guest navigation cookie.
    - This can be built after messaging and before public photo upload so QR uploads can be attributed when possible.
15. Photo storage and settings foundation
    - Supabase Storage private bucket setup.
    - `PhotoUpload` metadata table/model, including upload verification status.
    - `photo_upload_requires_review` wedding setting, default off/open.
    - Confirm `allow_anonymous_hub_upload` remains default on.
16. Wedding hub upload flow (public)
    - Turns the item 13 photo entry point into a working upload flow.
    - Direct signed browser uploads to Supabase Storage.
    - Anonymous QR uploads by default, with same-device guest inference from the secure cookie when available.
17. Photo moderation and export

## Why this order

- Start with protected admin core and guest data.
- Add secure invite access + event page next.
- Build RSVP loop and status tracking before adding messaging.
- Keep SMS messaging before photo admin work to avoid admin UI and migration conflicts.
- Add the event-day shared QR shell near the end so the venue entry point and playlist action can be tested before photo storage work.
- Build guest attribution and storage foundations before public uploads, so uploads have the right privacy, moderation, and metadata behavior on day one.
- Keep moderation/export last because it depends on uploaded photo metadata and review status.
