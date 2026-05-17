import { expect, type Page } from "@playwright/test";

import {
  GUEST_NAVIGATION_COOKIE_NAME,
  hashGuestNavigationCookie,
} from "../lib/guest-navigation-session";
import { INVITE_STATUS } from "../lib/invite-status";
import { RSVP_ATTENDANCE } from "../lib/rsvp-attendance";

import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import { invitePathForToken } from "./support/urls";

async function getGuestNavigationCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === GUEST_NAVIGATION_COOKIE_NAME);
}

async function getGuestNavigationSessionByCookieValue(cookieValue: string) {
  const supabase = createE2eSupabaseAdminClient();
  const cookieHash = hashGuestNavigationCookie(cookieValue);
  const { data, error } = await supabase
    .from("guest_navigation_sessions")
    .select("cookie_hash, guest_id, invite_token_id, is_anonymous, wedding_id")
    .eq("cookie_hash", cookieHash)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getGuestNavigationSessionCountForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { count, error } = await supabase
    .from("guest_navigation_sessions")
    .select("id", { count: "exact", head: true })
    .eq("guest_id", guestId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function getGuestInviteStatus(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("guests")
    .select("invite_status")
    .eq("id", guestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.invite_status ?? null;
}

test.describe("guest navigation session attribution", () => {
  test("creates a secure opaque guest navigation cookie for a valid invite", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Navigation Cookie");
    const token = uniqueInviteToken("guest-navigation-cookie");
    const { guestId, tokenId } = await createInviteTestGuest({
      email: "e2e-guest-navigation@example.com",
      fullName: guestName,
      token,
    });

    expect(await getGuestInviteStatus(guestId)).toBe(INVITE_STATUS.notReplied);

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();

    const cookie = await getGuestNavigationCookie(page);

    if (!cookie) {
      throw new Error("Expected valid invite to set a guest navigation cookie.");
    }

    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1_000);
    expect(cookie.value).not.toContain(token);
    expect(cookie.value).not.toContain(guestId);

    const session = await getGuestNavigationSessionByCookieValue(cookie.value);

    expect(session).toMatchObject({
      cookie_hash: hashGuestNavigationCookie(cookie.value),
      guest_id: guestId,
      invite_token_id: tokenId,
      is_anonymous: false,
      wedding_id: SEEDED_WEDDING_ID,
    });
    expect(session?.cookie_hash).not.toBe(cookie.value);

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();
    await expect
      .poll(async () => getGuestInviteStatus(guestId))
      .toBe(INVITE_STATUS.opened);
    expect(await getGuestNavigationCookie(page)).toMatchObject({
      value: cookie.value,
    });
    expect(await getGuestNavigationSessionCountForGuest(guestId)).toBe(1);
  });

  test("records opened without downgrading a Guest that already RSVP'd", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Navigation No Downgrade");
    const token = uniqueInviteToken("guest-navigation-no-downgrade");
    const { guestId } = await createInviteTestGuest({
      attendance: RSVP_ATTENDANCE.yes,
      email: "e2e-guest-navigation-no-downgrade@example.com",
      fullName: guestName,
      inviteStatus: INVITE_STATUS.rsvpYes,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();
    await expect
      .poll(async () => getGuestInviteStatus(guestId))
      .toBe(INVITE_STATUS.rsvpYes);

    const cookie = await getGuestNavigationCookie(page);

    if (!cookie) {
      throw new Error("Expected granted Invite access to prepare a navigation cookie.");
    }

    expect(await getGuestNavigationSessionCountForGuest(guestId)).toBe(1);
  });

  test("does not set a guest navigation cookie for invalid or missing invites", async ({
    page,
  }) => {
    await page.goto("/invite/not-a-real-invite-token");
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toBeUndefined();

    await page.goto("/invite");
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toBeUndefined();
  });

  test("does not set a guest navigation cookie for inactive tokens or archived guests", async ({
    page,
  }) => {
    const inactiveGuestName = uniqueRsvpGuestName("Inactive Token Cookie");
    const inactiveToken = uniqueInviteToken("inactive-token-cookie");
    const archivedGuestName = uniqueRsvpGuestName("Archived Guest Cookie");
    const archivedToken = uniqueInviteToken("archived-guest-cookie");
    const { guestId: inactiveGuestId, tokenId: inactiveTokenId } =
      await createInviteTestGuest({
        email: "e2e-guest-navigation-inactive@example.com",
        fullName: inactiveGuestName,
        token: inactiveToken,
      });
    const { guestId: archivedGuestId } = await createInviteTestGuest({
      email: "e2e-guest-navigation-archived@example.com",
      fullName: archivedGuestName,
      token: archivedToken,
    });
    const supabase = createE2eSupabaseAdminClient();
    const { error: inactiveTokenError } = await supabase
      .from("invite_tokens")
      .update({
        invalidated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq("id", inactiveTokenId);
    const { error: archivedGuestError } = await supabase
      .from("guests")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", archivedGuestId);

    expect(inactiveTokenError).toBeNull();
    expect(archivedGuestError).toBeNull();

    await page.goto(invitePathForToken(inactiveToken));
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    await expect(page.getByText(inactiveGuestName)).toHaveCount(0);
    expect(await getGuestNavigationCookie(page)).toBeUndefined();
    expect(await getGuestNavigationSessionCountForGuest(inactiveGuestId)).toBe(0);

    await page.goto(invitePathForToken(archivedToken));
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    await expect(page.getByText(archivedGuestName)).toHaveCount(0);
    expect(await getGuestNavigationCookie(page)).toBeUndefined();
    expect(await getGuestNavigationSessionCountForGuest(archivedGuestId)).toBe(0);
  });

  test("does not overwrite an existing guest navigation cookie on invalid invites", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Invalid Keeps Cookie");
    const token = uniqueInviteToken("invalid-keeps-guest-navigation-cookie");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-guest-navigation-invalid@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();
    const originalCookie = await getGuestNavigationCookie(page);

    if (!originalCookie) {
      throw new Error("Expected valid invite to set a guest navigation cookie.");
    }

    await page.goto("/invite/not-a-real-invite-token");
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toMatchObject({
      value: originalCookie.value,
    });

    await page.goto("/invite");
    await expect(
      page.getByRole("heading", { name: "Inbjudan saknas" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toMatchObject({
      value: originalCookie.value,
    });
    expect(await getGuestNavigationSessionCountForGuest(guestId)).toBe(1);
  });
});
