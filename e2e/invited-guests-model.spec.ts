import { expect } from "@playwright/test";

import { hashInviteToken } from "../lib/invite-token-crypto";
import { INVITE_STATUS, RSVP_STATUS } from "../lib/invite-status";
import { RSVP_ATTENDANCE } from "../lib/rsvp-attendance";

import { uniqueGuestName } from "./support/admin-guests";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";

test.describe("Invited Guest data model", () => {
  test("defaults active Guests and active Invite tokens to Invited Guest with full Invite access", async () => {
    const supabase = createE2eSupabaseAdminClient();
    const guestName = uniqueGuestName("Invited Defaults");
    const token = uniqueInviteToken("invited-guest-defaults");

    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .insert({
        email: "e2e-invited-defaults@example.com",
        full_name: guestName,
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id, guest_kind, invite_status, rsvp_status")
      .single();

    expect(guestError).toBeNull();
    expect(guest).toMatchObject({
      guest_kind: "invited",
      invite_status: "not replied",
      rsvp_status: "not replied",
    });

    if (!guest || typeof guest.id !== "string") {
      throw new Error("Expected inserted Guest id.");
    }

    const { data: inviteToken, error: tokenError } = await supabase
      .from("invite_tokens")
      .insert({
        guest_id: guest.id,
        is_active: true,
        token_hash: hashInviteToken(token),
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("access_scope, is_active")
      .single();

    expect(tokenError).toBeNull();
    expect(inviteToken).toMatchObject({
      access_scope: "full",
      is_active: true,
    });
  });

  test("records opened-Invite activity without downgrading dedicated RSVP status", async () => {
    const supabase = createE2eSupabaseAdminClient();
    const guestName = uniqueRsvpGuestName("Opened No Downgrade");
    const token = uniqueInviteToken("opened-no-downgrade");
    const { guestId } = await createInviteTestGuest({
      attendance: RSVP_ATTENDANCE.yes,
      email: "e2e-opened-no-downgrade@example.com",
      fullName: guestName,
      inviteStatus: INVITE_STATUS.rsvpYes,
      token,
    });

    const { error: resetInviteActivityError } = await supabase
      .from("guests")
      .update({ invite_status: INVITE_STATUS.notReplied })
      .eq("id", guestId)
      .eq("wedding_id", SEEDED_WEDDING_ID);

    expect(resetInviteActivityError).toBeNull();

    const { error: openedError } = await supabase.rpc("mark_invite_opened", {
      p_guest_id: guestId,
      p_wedding_id: SEEDED_WEDDING_ID,
    });

    expect(openedError).toBeNull();

    const { data: guestAfterOpen, error: guestAfterOpenError } = await supabase
      .from("guests")
      .select("invite_status, rsvp_status")
      .eq("id", guestId)
      .single();

    expect(guestAfterOpenError).toBeNull();
    expect(guestAfterOpen).toMatchObject({
      invite_status: INVITE_STATUS.opened,
      rsvp_status: RSVP_STATUS.rsvpYes,
    });
  });

  test("submitting RSVP updates dedicated RSVP status and preserves opened activity", async () => {
    const supabase = createE2eSupabaseAdminClient();
    const guestName = uniqueRsvpGuestName("Dedicated RSVP Update");
    const token = uniqueInviteToken("dedicated-rsvp-update");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-dedicated-rsvp-update@example.com",
      fullName: guestName,
      token,
    });

    const { error: submitError } = await supabase.rpc("submit_rsvp_response", {
      p_allergy_notes: "No hazelnuts.",
      p_attendance: RSVP_ATTENDANCE.no,
      p_extra_guests: 0,
      p_food_preference: "Vegetarian",
      p_phone: null,
      p_plus_one_allergy_notes: null,
      p_plus_one_email: null,
      p_plus_one_food_preference: null,
      p_plus_one_name: null,
      p_plus_one_phone: null,
      p_plus_one_sms_opt_in: false,
      p_sms_opt_in: false,
      p_token_hash: hashInviteToken(token),
    });

    expect(submitError).toBeNull();

    const { data: guestAfterRsvp, error: guestAfterRsvpError } = await supabase
      .from("guests")
      .select("invite_status, rsvp_status")
      .eq("id", guestId)
      .single();

    expect(guestAfterRsvpError).toBeNull();
    expect(guestAfterRsvp).toMatchObject({
      invite_status: INVITE_STATUS.opened,
      rsvp_status: RSVP_STATUS.rsvpNo,
    });
  });
});
