import { expect, test, type Page } from "@playwright/test";

import { deleteE2eGuests, getGuestByName, guestRowByName } from "./support/admin-guests";
import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  getRsvpResponseCountForGuest,
  getRsvpResponseForGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { invitePathForToken } from "./support/urls";

async function chooseAttendance(page: Page, attendance: "yes" | "no" | "maybe") {
  const names = {
    maybe: /^Maybe\b/,
    no: /^No\b/,
    yes: /^Yes\b/,
  } as const;

  await page.getByRole("radio", { name: names[attendance] }).check();
}

async function submitRsvp(page: Page, options: {
  allergyNotes?: string;
  attendance?: "yes" | "no" | "maybe";
  extraGuests?: string;
  foodPreference?: string;
  phone?: string;
}) {
  if (options.attendance) {
    await chooseAttendance(page, options.attendance);
  }

  if (options.phone !== undefined) {
    await page.getByPlaceholder("+46701234567").fill(options.phone);
  }

  if (options.extraGuests !== undefined) {
    await page.getByRole("spinbutton", { name: "Extra guest count" }).fill(
      options.extraGuests,
    );
  }

  if (options.foodPreference !== undefined) {
    await page.getByRole("combobox", { name: "Food preference" }).selectOption(
      options.foodPreference,
    );
  }

  if (options.allergyNotes !== undefined) {
    await page.getByRole("textbox", { name: "Allergy / special notes" }).fill(
      options.allergyNotes,
    );
  }

  await page.getByRole("button", { name: /^(Submit|Update) RSVP$/ }).click();
}

test.describe("RSVP, invite status, and phone capture", () => {
  test.beforeEach(async () => {
    await deleteE2eGuests();
  });

  test.afterEach(async () => {
    await deleteE2eGuests();
  });

  test("submits a first-time RSVP, updates invite status, and shows details in admin", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("First Time");
    const token = uniqueInviteToken("first-time-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-first-time@example.com",
      fullName: guestName,
      phone: null,
      token,
    });

    expect((await getGuestByName(guestName))?.invite_status).toBe("not replied");

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe("opened");

    await submitRsvp(page, {
      allergyNotes: "Peanuts and sesame.",
      attendance: "yes",
      extraGuests: "2",
      foodPreference: "Vegan",
      phone: "",
    });

    await expect(page.getByText("Thank you — your RSVP has been saved.")).toBeVisible();
    await expect(page.getByText("Current RSVP")).toBeVisible();
    await expect(page.getByText("Yes, I will be there")).toBeVisible();
    await expect(page.getByRole("button", { name: "Update RSVP" })).toBeVisible();

    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe("rsvp yes");
    expect((await getGuestByName(guestName))?.phone).toBeNull();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Peanuts and sesame.",
      attendance: "yes",
      extra_guests: 2,
      food_preference: "Vegan",
    });

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await page.getByLabel("Search name or phone").fill(guestName);
    await page.getByRole("button", { name: "Apply" }).click();
    const row = await guestRowByName(page, guestName);
    await expect(row.getByText("rsvp yes", { exact: true })).toBeVisible();
    await expect(row.getByText("Extra guests: 2")).toBeVisible();
    await expect(row.getByText("Food: Vegan")).toBeVisible();
    await expect(row.getByText("Notes: Peanuts and sesame.")).toBeVisible();
  });

  test("blocks invalid RSVP submissions with clear errors", async ({ page }) => {
    const guestName = uniqueRsvpGuestName("Validation");
    const token = uniqueInviteToken("validation-rsvp");
    await createInviteTestGuest({
      email: "e2e-rsvp-validation@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await submitRsvp(page, { extraGuests: "0" });
    await expect(
      page.getByText("Choose Yes, No, or Maybe before submitting."),
    ).toBeVisible();

    await submitRsvp(page, { attendance: "yes", extraGuests: "-1" });
    await expect(
      page.getByText("Extra guest count must be a whole number of 0 or more."),
    ).toBeVisible();

    await submitRsvp(page, {
      attendance: "yes",
      extraGuests: "0",
      phone: "0701234567",
    });
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Phone must use country-code format, e.g. +46701234567.",
    );
  });

  test("prefills and updates an existing RSVP without duplicate rows or status downgrade", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Update Existing");
    const token = uniqueInviteToken("update-existing-rsvp");
    const { guestId } = await createInviteTestGuest({
      attendance: "yes",
      email: "e2e-rsvp-update@example.com",
      extraGuests: 1,
      foodPreference: "Meat",
      fullName: guestName,
      inviteStatus: "rsvp yes",
      notes: "No shellfish.",
      phone: "+46700000000",
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText("Review or update your RSVP")).toBeVisible();
    await expect(page.getByText("Yes, I will be there")).toBeVisible();
    await expect(page.getByPlaceholder("+46701234567")).toHaveValue("+46700000000");
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe("rsvp yes");

    await submitRsvp(page, {
      allergyNotes: "Updated notes.",
      attendance: "maybe",
      extraGuests: "0",
      foodPreference: "Fish",
      phone: "+46708889999",
    });

    await expect(page.getByText("Thank you — your RSVP has been saved.")).toBeVisible();
    await expect(page.getByText("Maybe, I will confirm later")).toBeVisible();
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe("rsvp maybe");
    expect((await getGuestByName(guestName))?.phone).toBe("+46708889999");
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Updated notes.",
      attendance: "maybe",
      extra_guests: 0,
      food_preference: "Fish",
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText("Maybe, I will confirm later")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Maybe\b/ })).toBeChecked();
    await expect(page.getByPlaceholder("+46701234567")).toHaveValue("+46708889999");
  });
});
