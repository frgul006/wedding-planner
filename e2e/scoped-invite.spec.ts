import { expect, type Page } from "@playwright/test";

import {
  GUEST_NAVIGATION_COOKIE_NAME,
  hashGuestNavigationCookie,
} from "../lib/guest-navigation-session";
import { hashInviteToken } from "../lib/invite-token-crypto";
import { RSVP_STATUS } from "../lib/invite-status";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "../lib/rsvp-attendance";

import { getInviteTokenRowsForGuest, guestRowByName } from "./support/admin-guests";
import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  getRsvpResponseCountForGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import {
  expectedPublicOriginForPage,
  invitePathForToken,
  pathFromAbsoluteUrl,
} from "./support/urls";

type ScopedPlusOneFixture = {
  invitedGuestId: string;
  invitedToken: string;
  plusOneGuestId: string;
  plusOneName: string;
  scopedToken: string;
  scopedTokenId: string;
};

async function getGuestNavigationCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === GUEST_NAVIGATION_COOKIE_NAME);
}

async function getGuestNavigationSessionByCookieValue(cookieValue: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("guest_navigation_sessions")
    .select("cookie_hash, guest_id, invite_token_id, is_anonymous, wedding_id")
    .eq("cookie_hash", hashGuestNavigationCookie(cookieValue))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function submitRsvpByToken({
  attendance = RSVP_ATTENDANCE.yes,
  extraGuests = 0,
  plusOneName = null,
  token,
}: {
  attendance?: RsvpAttendance;
  extraGuests?: 0 | 1;
  plusOneName?: string | null;
  token: string;
}) {
  const supabase = createE2eSupabaseAdminClient();
  return supabase.rpc("submit_rsvp_response", {
    p_allergy_notes: null,
    p_attendance: attendance,
    p_extra_guests: extraGuests,
    p_food_preference: null,
    p_phone: null,
    p_plus_one_allergy_notes: null,
    p_plus_one_email: null,
    p_plus_one_food_preference: null,
    p_plus_one_name: plusOneName,
    p_plus_one_phone: null,
    p_plus_one_sms_opt_in: false,
    p_sms_opt_in: false,
    p_token_hash: hashInviteToken(token),
  });
}

async function getRsvpManagedPlusOneGuest(invitedGuestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("guests")
    .select("id, full_name")
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .eq("invited_guest_id", invitedGuestId)
    .eq("guest_kind", "plus_one")
    .eq("rsvp_managed", true)
    .is("deleted_at", null)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function createScopedPlusOneFixture(label: string): Promise<ScopedPlusOneFixture> {
  const invitedToken = uniqueInviteToken(`${label}-invited`);
  const scopedToken = uniqueInviteToken(`${label}-scoped`);
  const invitedName = uniqueRsvpGuestName(`${label} Invited`);
  const plusOneName = uniqueRsvpGuestName(`${label} Plus One`);
  const { guestId: invitedGuestId } = await createInviteTestGuest({
    email: `${invitedToken}@example.com`,
    fullName: invitedName,
    plusOneAllowed: true,
    token: invitedToken,
  });

  const { error: rsvpError } = await submitRsvpByToken({
    extraGuests: 1,
    plusOneName,
    token: invitedToken,
  });
  expect(rsvpError).toBeNull();

  const plusOne = await getRsvpManagedPlusOneGuest(invitedGuestId);
  const supabase = createE2eSupabaseAdminClient();
  const { data: scopedInviteToken, error: tokenError } = await supabase
    .from("invite_tokens")
    .insert({
      access_scope: "scoped",
      guest_id: plusOne.id,
      is_active: true,
      token_hash: hashInviteToken(scopedToken),
      wedding_id: SEEDED_WEDDING_ID,
    })
    .select("id")
    .single();

  if (tokenError) {
    throw tokenError;
  }

  return {
    invitedGuestId,
    invitedToken,
    plusOneGuestId: plusOne.id,
    plusOneName,
    scopedToken,
    scopedTokenId: scopedInviteToken.id,
  };
}

async function expectScopedInviteExperience(page: Page, plusOneName: string) {
  await expect(page.getByText(`Inbjudan till ${plusOneName}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Gå till Detaljer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gå till OSA" })).toHaveCount(0);
  await expect(page.locator("#osa")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Låt oss veta" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Skicka mitt svar|Spara ändringar|Uppdatera mitt svar/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Vidare till OSA/ })).toHaveCount(0);
}

test.describe("Scoped Invite access for Plus-one Guests", () => {
  test("grants non-RSVP Invite access and creates a Wedding hub navigation session", async ({
    page,
  }) => {
    const fixture = await createScopedPlusOneFixture("Scoped Access");

    await page.goto(invitePathForToken(fixture.scopedToken));
    await expectScopedInviteExperience(page, fixture.plusOneName);
    await expect(
      page.getByRole("navigation", { name: "Inbjudans paneler" }).getByText(/01\/02/),
    ).toBeVisible();
    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await expect(page.locator("#detaljer")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Inbjudans paneler" }).getByText(/02\/02/),
    ).toBeVisible();

    const cookie = await getGuestNavigationCookie(page);

    if (!cookie) {
      throw new Error("Expected scoped Invite access to set a guest navigation cookie.");
    }

    const session = await getGuestNavigationSessionByCookieValue(cookie.value);
    expect(session).toMatchObject({
      cookie_hash: hashGuestNavigationCookie(cookie.value),
      guest_id: fixture.plusOneGuestId,
      invite_token_id: fixture.scopedTokenId,
      is_anonymous: false,
      wedding_id: SEEDED_WEDDING_ID,
    });
  });

  test("denies revoked scoped tokens and archived Plus-one Guests", async ({ page }) => {
    const revokedFixture = await createScopedPlusOneFixture("Scoped Revoked");
    const archivedFixture = await createScopedPlusOneFixture("Scoped Archived");
    const supabase = createE2eSupabaseAdminClient();
    const now = new Date().toISOString();

    const { error: revokedError } = await supabase
      .from("invite_tokens")
      .update({ invalidated_at: now, is_active: false })
      .eq("id", revokedFixture.scopedTokenId);
    expect(revokedError).toBeNull();

    const { error: archivedError } = await supabase
      .from("guests")
      .update({ deleted_at: now })
      .eq("id", archivedFixture.plusOneGuestId);
    expect(archivedError).toBeNull();

    await page.goto(invitePathForToken(revokedFixture.scopedToken));
    await expect(page.getByRole("heading", { name: "Inbjudan saknas" })).toBeVisible();
    await expect(page.getByText(revokedFixture.plusOneName)).toHaveCount(0);

    await page.goto(invitePathForToken(archivedFixture.scopedToken));
    await expect(page.getByRole("heading", { name: "Inbjudan saknas" })).toBeVisible();
    await expect(page.getByText(archivedFixture.plusOneName)).toHaveCount(0);
  });

  test("rejects scoped tokens for RSVP writes while full tokens stay RSVP-capable", async () => {
    const fixture = await createScopedPlusOneFixture("Scoped RSVP Denied");

    const scopedResult = await submitRsvpByToken({
      attendance: RSVP_ATTENDANCE.no,
      token: fixture.scopedToken,
    });
    expect(scopedResult.error).toMatchObject({ code: "P0002" });
    expect(await getRsvpResponseCountForGuest(fixture.plusOneGuestId)).toBe(0);

    const fullResult = await submitRsvpByToken({
      attendance: RSVP_ATTENDANCE.maybe,
      token: fixture.invitedToken,
    });
    expect(fullResult.error).toBeNull();

    const supabase = createE2eSupabaseAdminClient();
    const { data: invitedGuest, error: invitedGuestError } = await supabase
      .from("guests")
      .select("rsvp_status")
      .eq("id", fixture.invitedGuestId)
      .single();

    expect(invitedGuestError).toBeNull();
    expect(invitedGuest).toMatchObject({ rsvp_status: RSVP_STATUS.rsvpMaybe });
  });

  test("admin can generate, copy, and regenerate scoped links for Plus-one Guests", async ({
    page,
  }) => {
    const fixture = await createScopedPlusOneFixture("Scoped Admin");
    const supabase = createE2eSupabaseAdminClient();
    const { error: seedTokenError } = await supabase
      .from("invite_tokens")
      .update({
        invalidated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq("id", fixture.scopedTokenId);
    expect(seedTokenError).toBeNull();

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");

    let plusOneRow = await guestRowByName(page, fixture.plusOneName);
    await plusOneRow.getByRole("button", { name: "Skapa begränsad Invite-länk" }).click();
    const firstInviteInput = page.getByLabel(`Ny begränsad Invite-länk för ${fixture.plusOneName}`);
    await expect(firstInviteInput).toBeVisible();
    const firstInviteUrl = await firstInviteInput.inputValue();
    const expectedInviteOrigin = expectedPublicOriginForPage(page);
    const firstInvitePath = pathFromAbsoluteUrl(firstInviteUrl);
    expect(new URL(firstInviteUrl).origin).toBe(expectedInviteOrigin);
    expect(firstInvitePath).toContain("/invite/");

    await page.context().grantPermissions(["clipboard-write"]);
    await plusOneRow.getByRole("button", { name: "Kopiera ny länk" }).click();
    await expect(plusOneRow.getByRole("button", { name: "Ny länk kopierad" })).toBeVisible();

    const scopedInvitePage = await page.context().newPage();
    await scopedInvitePage.goto(firstInvitePath);
    await expectScopedInviteExperience(scopedInvitePage, fixture.plusOneName);
    await scopedInvitePage.close();

    await page.reload();
    await expect(page.getByLabel(`Ny begränsad Invite-länk för ${fixture.plusOneName}`)).toHaveCount(0);
    plusOneRow = await guestRowByName(page, fixture.plusOneName);
    await plusOneRow.getByRole("button", { name: "Skapa om begränsad Invite-länk" }).click();
    const secondInviteInput = page.getByLabel(`Ny begränsad Invite-länk för ${fixture.plusOneName}`);
    await expect(secondInviteInput).toBeVisible();
    const secondInviteUrl = await secondInviteInput.inputValue();
    const secondInvitePath = pathFromAbsoluteUrl(secondInviteUrl);
    expect(new URL(secondInviteUrl).origin).toBe(expectedInviteOrigin);
    expect(secondInvitePath).toContain("/invite/");
    expect(secondInvitePath).not.toBe(firstInvitePath);

    await page.goto(firstInvitePath);
    await expect(page.getByRole("heading", { name: "Inbjudan saknas" })).toBeVisible();

    await page.goto(secondInvitePath);
    await expectScopedInviteExperience(page, fixture.plusOneName);

    const tokens = await getInviteTokenRowsForGuest(fixture.plusOneGuestId);
    expect(tokens).toHaveLength(3);
    expect(tokens.filter((token) => token.access_scope === "scoped")).toHaveLength(3);
    expect(tokens.filter((token) => token.is_active)).toHaveLength(1);
    expect(tokens.filter((token) => token.is_active)[0]?.access_scope).toBe("scoped");
  });
});
