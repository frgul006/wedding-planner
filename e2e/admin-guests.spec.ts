import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import {
  addGuest,
  deleteGuestRow,
  expectGuestRowHidden,
  expectGuestRowVisible,
  getGuestByName,
  getInviteTokenRowsForGuest,
  guestRowByName,
  uniqueGuestName,
} from "./support/admin-guests";
import { testWithGuests as test } from "./support/fixtures";
import { expectedPublicOriginForPage, pathFromAbsoluteUrl } from "./support/urls";

test.describe("admin guest CRUD", () => {
  test("adds, validates, searches, sorts, edits, and archives guests in one edit session", async ({ page }) => {
    const firstGuestName = uniqueGuestName("Admin CRUD A");
    const secondGuestName = uniqueGuestName("Admin CRUD Z");
    const updatedGuestName = `${firstGuestName} Updated`;
    const searchPhone = "+46709990001";

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { exact: true, name: "Gäster" }).click();
    await expect(page.getByRole("heading", { name: "Hantera Gäster" })).toBeVisible();

    await page.getByRole("button", { name: "Lägg till Gäst-utkast" }).click();
    await page.locator("tbody tr").first().getByLabel(/Namn/).fill(uniqueGuestName("Missing Contact"));
    await expect(page.getByText("1 osparad rad")).toBeVisible();
    await page.getByRole("button", { name: "Spara ändringar" }).click();
    await expect(page.getByText("Ange e-post eller telefonnummer.")).toBeVisible();
    await page.getByRole("button", { name: "Kasta" }).click();

    await addGuest(page, {
      email: "e2e-admin-crud-a@example.com",
      fullName: firstGuestName,
      notes: "Initial e2e notes",
      phone: searchPhone,
      plusOneAllowed: true,
    });
    await addGuest(page, {
      email: "e2e-admin-crud-z@example.com",
      fullName: secondGuestName,
    });

    expect((await getGuestByName(firstGuestName))?.plus_one_allowed).toBe(true);
    expect((await getGuestByName(secondGuestName))?.plus_one_allowed).toBe(false);

    await page.getByLabel("Sök").fill(searchPhone.slice(-4));
    await expectGuestRowVisible(page, firstGuestName);
    await expect(page.locator("tbody tr")).toHaveCount(1);

    await page.getByLabel("Sök").fill("E2E Guest Admin CRUD");
    await page.getByLabel("Sortering").selectOption("name-desc");
    await expect(page.locator("tbody tr").first().getByLabel(/Namn/)).toHaveValue(secondGuestName);

    await page.getByLabel("Sortering").selectOption("name");
    const firstRow = await guestRowByName(page, firstGuestName);
    await firstRow.getByLabel(/Namn/).fill(updatedGuestName);
    await firstRow.getByLabel(/E-post/).fill("e2e-admin-crud-updated@example.com");
    await firstRow.getByLabel(/Telefon/).fill("+46709990002");
    await firstRow.locator('input[type="checkbox"]').nth(2).uncheck();
    await saveByStickyBar(page);

    await expect
      .poll(async () => (await getGuestByName(updatedGuestName))?.email)
      .toBe("e2e-admin-crud-updated@example.com");
    const updatedGuest = await getGuestByName(updatedGuestName);
    expect(updatedGuest).toMatchObject({
      email: "e2e-admin-crud-updated@example.com",
      phone: "+46709990002",
      plus_one_allowed: false,
    });

    await page.getByLabel("Sök").fill(updatedGuestName);
    await expectGuestRowVisible(page, updatedGuestName);

    await deleteGuestRow(await guestRowByName(page, updatedGuestName), true);
    await expectGuestRowHidden(page, updatedGuestName);
    expect((await getGuestByName(updatedGuestName))?.deleted_at).toEqual(expect.any(String));
  });
});

test.describe("admin invite token links", () => {
  test("generates private invite links and invalidates old links on regeneration", async ({ page }) => {
    const guestName = uniqueGuestName("Invite Link");

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await addGuest(page, {
      email: "e2e-invite-link@example.com",
      fullName: guestName,
      phone: "+46709990003",
    });

    let guestRow = await guestRowByName(page, guestName);
    await guestRow.getByRole("button", { name: "Skapa Invite-länk" }).click();
    const firstInviteInput = page.getByLabel(`Ny Invite-länk för ${guestName}`);
    await expect(firstInviteInput).toBeVisible();

    const firstInviteUrl = await firstInviteInput.inputValue();
    const expectedInviteOrigin = expectedPublicOriginForPage(page);
    const firstInvitePath = pathFromAbsoluteUrl(firstInviteUrl);
    expect(new URL(firstInviteUrl).origin).toBe(expectedInviteOrigin);
    expect(firstInvitePath).toContain("/invite/");

    const invitePage = await page.context().newPage();
    await invitePage.goto(firstInvitePath);
    await expect(invitePage.getByText(`Inbjudan till ${guestName}`)).toBeVisible();
    await invitePage.close();

    await page.reload();
    await expect(page.getByLabel(`Ny Invite-länk för ${guestName}`)).toHaveCount(0);

    guestRow = await guestRowByName(page, guestName);
    await guestRow.getByRole("button", { name: "Skapa om Invite-länk" }).click();
    const secondInviteInput = page.getByLabel(`Ny Invite-länk för ${guestName}`);
    await expect(secondInviteInput).toBeVisible();

    const secondInviteUrl = await secondInviteInput.inputValue();
    const secondInvitePath = pathFromAbsoluteUrl(secondInviteUrl);
    expect(new URL(secondInviteUrl).origin).toBe(expectedInviteOrigin);
    expect(secondInvitePath).toContain("/invite/");
    expect(secondInvitePath).not.toBe(firstInvitePath);

    await page.goto(firstInvitePath);
    await expect(page.getByRole("heading", { name: "Inbjudan saknas" })).toBeVisible();
    await page.goto(secondInvitePath);
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();

    const guest = await getGuestByName(guestName);
    expect(guest?.id).toEqual(expect.any(String));
    const tokens = await getInviteTokenRowsForGuest(guest!.id);
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.is_active)).toHaveLength(1);
    expect(tokens.filter((token) => token.invalidated_at)).toHaveLength(1);
    expect(tokens.every((token) => token.token_hash.length === 64)).toBe(true);
    expect(tokens.every((token) => !("raw_token" in token))).toBe(true);
  });
});

async function saveByStickyBar(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Spara ändringar" }).click();
  await expect(page.getByText(/Sparade \d+ ändring/)).toBeVisible();
}
