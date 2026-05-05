import { expect, test } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import {
  addGuest,
  deleteE2eGuests,
  deleteGuestRow,
  expectGuestRowHidden,
  expectGuestRowVisible,
  getGuestByName,
  getInviteTokenRowsForGuest,
  guestRowByName,
  saveGuestRow,
  uniqueGuestName,
} from "./support/admin-guests";
import { pathFromAbsoluteUrl } from "./support/urls";

test.describe("admin guest CRUD", () => {
  test.beforeEach(async () => {
    await deleteE2eGuests();
  });

  test.afterEach(async () => {
    await deleteE2eGuests();
  });

  test("adds, validates, searches, sorts, edits, and archives guests", async ({ page }) => {
    const firstGuestName = uniqueGuestName("Admin CRUD A");
    const secondGuestName = uniqueGuestName("Admin CRUD Z");
    const updatedGuestName = `${firstGuestName} Updated`;
    const searchPhone = "+46709990001";

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage guests" }).click();
    await expect(page.getByRole("heading", { name: "Guests" })).toBeVisible();

    await page.getByLabel("Full name", { exact: true }).fill(
      uniqueGuestName("Missing Contact"),
    );
    await page.getByRole("button", { name: "Add guest" }).click();
    await expect(page.getByText("Add at least an email or phone number.")).toBeVisible();

    await addGuest(page, {
      email: "e2e-admin-crud-a@example.com",
      fullName: firstGuestName,
      notes: "Initial e2e notes",
      phone: searchPhone,
    });
    await addGuest(page, {
      email: "e2e-admin-crud-z@example.com",
      fullName: secondGuestName,
    });

    await page.getByLabel("Search name or phone").fill(searchPhone.slice(-4));
    await page.getByRole("button", { name: "Apply" }).click();
    await expectGuestRowVisible(page, firstGuestName);
    await expectGuestRowHidden(page, secondGuestName);

    await page.getByLabel("Search name or phone").fill("E2E Guest Admin CRUD");
    await page.locator('select[name="status"]').selectOption("not replied");
    await page.locator('select[name="sort"]').selectOption("name-desc");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Showing 2 active guests.")).toBeVisible();
    await expectGuestRowVisible(page, secondGuestName);
    await expectGuestRowVisible(page, firstGuestName);

    const rows = page.locator("tbody tr");
    await expect(rows.nth(0).locator('input[name="full_name"]')).toHaveValue(
      secondGuestName,
    );
    await expect(rows.nth(1).locator('input[name="full_name"]')).toHaveValue(
      firstGuestName,
    );

    const firstRow = await guestRowByName(page, firstGuestName);
    await firstRow.locator('input[name="full_name"]').fill(updatedGuestName);
    await firstRow.locator('input[name="email"]').fill("e2e-admin-crud-updated@example.com");
    await firstRow.locator('input[name="phone"]').fill("+46709990002");
    await firstRow.locator('textarea[name="notes"]').fill("Updated e2e notes");
    await saveGuestRow(firstRow);
    await expect(page.getByText("Guest updated.")).toBeVisible();

    await page.getByLabel("Search name or phone").fill(updatedGuestName);
    await page.locator('select[name="status"]').selectOption("");
    await page.locator('select[name="sort"]').selectOption("name");
    await page.getByRole("button", { name: "Apply" }).click();
    await expectGuestRowVisible(page, updatedGuestName);

    const editedRow = await guestRowByName(page, updatedGuestName);
    await deleteGuestRow(editedRow, false);
    await expectGuestRowVisible(page, updatedGuestName);

    await deleteGuestRow(editedRow, true);
    await expect(page.getByText("Guest archived.")).toBeVisible();
    await expectGuestRowHidden(page, updatedGuestName);

    const archivedGuest = await getGuestByName(updatedGuestName);
    expect(archivedGuest?.deleted_at).toEqual(expect.any(String));
  });
});

test.describe("admin invite token links", () => {
  test.beforeEach(async () => {
    await deleteE2eGuests();
  });

  test.afterEach(async () => {
    await deleteE2eGuests();
  });

  test("generates private invite links and invalidates old links on regeneration", async ({
    page,
  }) => {
    const guestName = uniqueGuestName("Invite Token");

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await addGuest(page, {
      email: "e2e-invite-token@example.com",
      fullName: guestName,
    });

    let guestRow = await guestRowByName(page, guestName);
    await guestRow.getByRole("button", { name: "Generate invite link" }).click();
    const firstInviteInput = page.getByLabel(`New invite link for ${guestName}`);
    await expect(firstInviteInput).toBeVisible();
    const firstInviteUrl = await firstInviteInput.inputValue();
    const firstInvitePath = pathFromAbsoluteUrl(firstInviteUrl);
    expect(firstInvitePath).toContain("/invite/");

    const invitePage = await page.context().newPage();
    await invitePage.goto(firstInvitePath);
    await expect(invitePage.getByText(`Private invite for ${guestName}`)).toBeVisible();
    await invitePage.close();

    await page.reload();
    await expect(page.getByLabel(`New invite link for ${guestName}`)).toHaveCount(0);
    guestRow = await guestRowByName(page, guestName);
    await guestRow.getByRole("button", { name: "Regenerate invite link" }).click();
    const secondInviteInput = page.getByLabel(`New invite link for ${guestName}`);
    await expect(secondInviteInput).toBeVisible();
    const secondInviteUrl = await secondInviteInput.inputValue();
    const secondInvitePath = pathFromAbsoluteUrl(secondInviteUrl);
    expect(secondInvitePath).toContain("/invite/");
    expect(secondInvitePath).not.toBe(firstInvitePath);

    await page.goto(firstInvitePath);
    await expect(page.getByRole("heading", { name: "Invite link not valid" })).toBeVisible();

    await page.goto(secondInvitePath);
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();

    const guest = await getGuestByName(guestName);
    expect(guest?.id).toEqual(expect.any(String));
    const tokens = await getInviteTokenRowsForGuest(guest!.id);
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.is_active)).toHaveLength(1);
    expect(tokens.filter((token) => !token.is_active && token.invalidated_at)).toHaveLength(1);
  });
});
