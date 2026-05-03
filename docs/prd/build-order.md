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
13. QR code setup for guest hub
14. Wedding hub upload flow (public)
15. Photo moderation and export

## Why this order

- Start with protected admin core and guest data.
- Add secure invite access + event page next.
- Build RSVP loop and status tracking before adding messaging.
- Add event-day shared QR flow near the end, with moderation last.