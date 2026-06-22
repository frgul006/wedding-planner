# Include current Invite links in Calendar action files

Calendar action `.ics` files include the guest's current personal **Invite** link so guests can reopen wedding details from their calendar entry. This deliberately accepts that the token may sync to calendar providers and devices; the link still follows normal **Invite access** revocation and regeneration rules, so the Calendar action does not create a separate long-lived access path.
