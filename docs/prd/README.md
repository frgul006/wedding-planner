# Wedding App PRD Index

## Build order (smallest-first scope)

(Also documented in `build-order.md`)

1. **Admin authentication and route guard**
   - `admin-auth-and-route-guard.md`
2. **Admin guest CRUD**
   - `admin-guest-crud.md`
3. **Invite token security**
   - `invite-token-security.md`
4. **Wedding event settings**
   - `wedding-event-settings.md`
5. **Invite event info and gifts**
   - `invite-event-info-and-gifts.md`
6. **Public invite page**
   - `public-invite-page.md`
7. **RSVP form submission**
   - `rsvp-form-submission.md`
8. **RSVP view and update**
   - `rsvp-view-update.md`
9. **Invite status workflow**
   - `invite-status-workflow.md`
10. **Phone capture for RSVP**
   - `phone-capture-for-rsvp.md`
11. **Invite updates feed**
   - `invite-updates-feed.md`
12. **Admin messaging system**
   - `admin-messaging-system.md`
   - Keep the merged 46elks SMS work before photo admin screens to reduce admin navigation and migration conflicts.
13. **QR code setup for guest hub shell**
   - `qr-code-generation.md`
   - Download/print the QR and open the shared hub route; real photo upload is item 16.
14. **Guest session attribution foundation**
   - `invite-token-security.md`
   - `public-invite-page.md`
   - `../data-model.md`
15. **Photo storage and settings foundation**
   - `wedding-event-settings.md`
   - `photo-upload-public.md`
   - `photo-review-and-export.md`
   - `../data-model.md`
16. **Wedding hub upload flow (public)**
   - `photo-upload-public.md`
   - Turns the item 13 photo entry point into working Supabase Storage uploads.
17. **Photo moderation and export**
   - `photo-review-and-export.md`

## Future / optional

- **SMS delivery reports**
  - `sms-delivery-reports.md`

All files are written in simple, ELI5-friendly structure and wording.
