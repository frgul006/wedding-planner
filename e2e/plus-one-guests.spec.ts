import { expect } from "@playwright/test";

import { hashInviteToken } from "../lib/invite-token-crypto";
import { INVITE_STATUS, RSVP_STATUS } from "../lib/invite-status";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "../lib/rsvp-attendance";

import { deleteGuestRow, guestRowByName } from "./support/admin-guests";
import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  getRsvpResponseForGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";

type RsvpPlusOneGuest = {
  deleted_at: string | null;
  email: string | null;
  full_name: string;
  guest_kind: string;
  id: string;
  invited_guest_id: string | null;
  phone: string | null;
  rsvp_managed: boolean;
  rsvp_status: string;
  sms_opt_in: boolean;
  sms_opted_in_at: string | null;
  sms_opted_out_at: string | null;
};

async function submitRsvp({
  attendance = RSVP_ATTENDANCE.yes,
  extraGuests,
  guestPhone = null,
  plusOneAllergyNotes = null,
  plusOneEmail = null,
  plusOneFoodPreference = null,
  plusOneName = null,
  plusOnePhone = null,
  plusOneSmsOptIn = false,
  smsOptIn = false,
  token,
}: {
  attendance?: RsvpAttendance;
  extraGuests: 0 | 1;
  guestPhone?: string | null;
  plusOneAllergyNotes?: string | null;
  plusOneEmail?: string | null;
  plusOneFoodPreference?: string | null;
  plusOneName?: string | null;
  plusOnePhone?: string | null;
  plusOneSmsOptIn?: boolean;
  smsOptIn?: boolean;
  token: string;
}) {
  const supabase = createE2eSupabaseAdminClient();
  const { error } = await supabase.rpc("submit_rsvp_response", {
    p_allergy_notes: null,
    p_attendance: attendance,
    p_extra_guests: extraGuests,
    p_food_preference: null,
    p_phone: guestPhone,
    p_plus_one_allergy_notes: plusOneAllergyNotes,
    p_plus_one_email: plusOneEmail,
    p_plus_one_food_preference: plusOneFoodPreference,
    p_plus_one_name: plusOneName,
    p_plus_one_phone: plusOnePhone,
    p_plus_one_sms_opt_in: plusOneSmsOptIn,
    p_sms_opt_in: smsOptIn,
    p_token_hash: hashInviteToken(token),
  });

  expect(error).toBeNull();
}

async function getRsvpManagedPlusOneGuests(invitedGuestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("guests")
    .select(
      "deleted_at, email, full_name, guest_kind, id, invited_guest_id, phone, rsvp_managed, rsvp_status, sms_opt_in, sms_opted_in_at, sms_opted_out_at",
    )
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .eq("invited_guest_id", invitedGuestId)
    .eq("guest_kind", "plus_one")
    .eq("rsvp_managed", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as RsvpPlusOneGuest[];
}

test.describe("RSVP-managed Plus-one Guests", () => {
  test("creates an active name-only Plus-one Guest from RSVP plus-one details", async () => {
    const guestName = uniqueRsvpGuestName("Plus One Create");
    const token = uniqueInviteToken("plus-one-create");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-plus-one-create@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await submitRsvp({
      extraGuests: 1,
      plusOneName: "E2E Name Only Plus One",
      token,
    });

    const plusOneGuests = await getRsvpManagedPlusOneGuests(guestId);
    expect(plusOneGuests).toHaveLength(1);
    expect(plusOneGuests[0]).toMatchObject({
      deleted_at: null,
      email: null,
      full_name: "E2E Name Only Plus One",
      guest_kind: "plus_one",
      invited_guest_id: guestId,
      phone: null,
      rsvp_managed: true,
      rsvp_status: RSVP_STATUS.rsvpYes,
      sms_opt_in: false,
    });
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      extra_guests: 1,
      plus_one_name: "E2E Name Only Plus One",
      plus_one_phone: null,
      plus_one_sms_opt_in: false,
    });
  });

  test("updates the same tied Plus-one Guest on later RSVP submissions", async () => {
    const guestName = uniqueRsvpGuestName("Plus One Update");
    const token = uniqueInviteToken("plus-one-update");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-plus-one-update@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await submitRsvp({
      extraGuests: 1,
      plusOneName: "E2E Original Plus One",
      token,
    });
    const [createdPlusOne] = await getRsvpManagedPlusOneGuests(guestId);

    await submitRsvp({
      attendance: RSVP_ATTENDANCE.maybe,
      extraGuests: 1,
      plusOneAllergyNotes: "No almonds.",
      plusOneEmail: "updated-plus-one@example.com",
      plusOneFoodPreference: "Vegetarian",
      plusOneName: "E2E Updated Plus One",
      plusOnePhone: "+46701112255",
      plusOneSmsOptIn: true,
      token,
    });

    const plusOneGuests = await getRsvpManagedPlusOneGuests(guestId);
    expect(plusOneGuests).toHaveLength(1);
    expect(plusOneGuests[0]).toMatchObject({
      deleted_at: null,
      email: "updated-plus-one@example.com",
      full_name: "E2E Updated Plus One",
      id: createdPlusOne?.id,
      phone: "+46701112255",
      rsvp_status: RSVP_STATUS.rsvpMaybe,
      sms_opt_in: true,
      sms_opted_in_at: expect.any(String),
      sms_opted_out_at: null,
    });
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      attendance: RSVP_ATTENDANCE.maybe,
      extra_guests: 1,
      plus_one_allergy_notes: "No almonds.",
      plus_one_email: "updated-plus-one@example.com",
      plus_one_food_preference: "Vegetarian",
      plus_one_name: "E2E Updated Plus One",
      plus_one_phone: "+46701112255",
      plus_one_sms_opt_in: true,
    });
  });

  test("archives the tied Plus-one Guest and revokes active scoped tokens when removed from RSVP", async () => {
    const guestName = uniqueRsvpGuestName("Plus One Remove");
    const token = uniqueInviteToken("plus-one-remove");
    const scopedToken = uniqueInviteToken("plus-one-remove-scoped");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-plus-one-remove@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await submitRsvp({
      extraGuests: 1,
      plusOneName: "E2E Removed Plus One",
      plusOnePhone: "+46701112266",
      plusOneSmsOptIn: true,
      token,
    });
    const [plusOne] = await getRsvpManagedPlusOneGuests(guestId);
    expect(plusOne?.id).toEqual(expect.any(String));

    const supabase = createE2eSupabaseAdminClient();
    const { error: tokenError } = await supabase.from("invite_tokens").insert({
      access_scope: "scoped",
      guest_id: plusOne.id,
      is_active: true,
      token_hash: hashInviteToken(scopedToken),
      wedding_id: SEEDED_WEDDING_ID,
    });
    expect(tokenError).toBeNull();

    await submitRsvp({
      extraGuests: 0,
      token,
    });

    const [archivedPlusOne] = await getRsvpManagedPlusOneGuests(guestId);
    expect(archivedPlusOne).toMatchObject({
      deleted_at: expect.any(String),
      id: plusOne?.id,
      sms_opt_in: false,
      sms_opted_out_at: expect.any(String),
    });
    const { data: scopedTokens, error: scopedTokenError } = await supabase
      .from("invite_tokens")
      .select("access_scope, is_active, invalidated_at")
      .eq("guest_id", plusOne.id)
      .eq("access_scope", "scoped");

    expect(scopedTokenError).toBeNull();
    expect(scopedTokens).toEqual([
      {
        access_scope: "scoped",
        invalidated_at: expect.any(String),
        is_active: false,
      },
    ]);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      extra_guests: 0,
      plus_one_name: null,
      plus_one_phone: null,
      plus_one_sms_opt_in: false,
    });
  });

  test("archiving an Invited Guest in admin archives tied Plus-one Guest and revokes scoped tokens", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Plus One Admin Archive");
    const token = uniqueInviteToken("plus-one-admin-archive");
    const scopedToken = uniqueInviteToken("plus-one-admin-archive-scoped");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-plus-one-admin-archive@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await submitRsvp({
      extraGuests: 1,
      plusOneName: "E2E Admin Archived Plus One",
      plusOnePhone: "+46701112267",
      plusOneSmsOptIn: true,
      token,
    });
    const [plusOne] = await getRsvpManagedPlusOneGuests(guestId);
    expect(plusOne?.id).toEqual(expect.any(String));

    const supabase = createE2eSupabaseAdminClient();
    const { error: tokenError } = await supabase.from("invite_tokens").insert({
      access_scope: "scoped",
      guest_id: plusOne.id,
      is_active: true,
      token_hash: hashInviteToken(scopedToken),
      wedding_id: SEEDED_WEDDING_ID,
    });
    expect(tokenError).toBeNull();

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await deleteGuestRow(await guestRowByName(page, guestName), true);
    await expect(page.getByText("Guest archived.")).toBeVisible();

    const [archivedPlusOne] = await getRsvpManagedPlusOneGuests(guestId);
    expect(archivedPlusOne).toMatchObject({
      deleted_at: expect.any(String),
      id: plusOne.id,
    });
    const { data: scopedTokens, error: scopedTokenError } = await supabase
      .from("invite_tokens")
      .select("access_scope, is_active, invalidated_at")
      .eq("guest_id", plusOne.id)
      .eq("access_scope", "scoped");

    expect(scopedTokenError).toBeNull();
    expect(scopedTokens).toEqual([
      {
        access_scope: "scoped",
        invalidated_at: expect.any(String),
        is_active: false,
      },
    ]);
  });

  test("does not backfill existing historical RSVP plus-one rows", async () => {
    const guestName = uniqueRsvpGuestName("Plus One Historical");
    const token = uniqueInviteToken("plus-one-historical");
    const { guestId } = await createInviteTestGuest({
      attendance: RSVP_ATTENDANCE.yes,
      email: "e2e-plus-one-historical@example.com",
      extraGuests: 1,
      fullName: guestName,
      inviteStatus: INVITE_STATUS.rsvpYes,
      plusOneAllowed: true,
      plusOneName: "E2E Historical Plus One",
      plusOnePhone: "+46701112277",
      plusOneSmsOptIn: true,
      token,
    });

    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      extra_guests: 1,
      plus_one_name: "E2E Historical Plus One",
    });
    expect(await getRsvpManagedPlusOneGuests(guestId)).toHaveLength(0);
  });

  test("renders Guest kind, tied Invited Guest, and RSVP-managed labels in admin", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Plus One Admin");
    const token = uniqueInviteToken("plus-one-admin");
    const plusOneName = "E2E Admin Plus One";
    const { guestId } = await createInviteTestGuest({
      email: "e2e-plus-one-admin@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await submitRsvp({
      extraGuests: 1,
      plusOneEmail: "admin-plus-one@example.com",
      plusOneName,
      plusOnePhone: "+46701112288",
      token,
    });
    expect(await getRsvpManagedPlusOneGuests(guestId)).toHaveLength(1);

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");

    const invitedRow = await guestRowByName(page, guestName);
    await expect(invitedRow.getByText("Invited Guest", { exact: true })).toBeVisible();

    const plusOneRow = await guestRowByName(page, plusOneName);
    await expect(plusOneRow.getByText("Plus-one Guest", { exact: true })).toBeVisible();
    await expect(plusOneRow.getByText(`Tied to ${guestName}`)).toBeVisible();
    await expect(plusOneRow.getByText("RSVP-managed", { exact: true })).toBeVisible();
    await expect(plusOneRow.locator('input[name="full_name"]')).toHaveAttribute(
      "readonly",
      "",
    );
  });
});
