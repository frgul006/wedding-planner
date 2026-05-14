import { expect, type Page } from "@playwright/test";

import { INVITE_STATUS } from "../lib/invite-status";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "../lib/rsvp-attendance";

import { getGuestByName, guestRowByName } from "./support/admin-guests";
import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  getRsvpResponseCountForGuest,
  getRsvpResponseForGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithGuests as test } from "./support/fixtures";
import { invitePathForToken } from "./support/urls";

async function chooseAttendance(page: Page, attendance: RsvpAttendance) {
  const names: Record<RsvpAttendance, RegExp> = {
    [RSVP_ATTENDANCE.maybe]: /^Maybe\b/,
    [RSVP_ATTENDANCE.no]: /^No\b/,
    [RSVP_ATTENDANCE.yes]: /^Yes\b/,
  };

  await page.getByRole("radio", { name: names[attendance] }).check();
}

async function submitRsvp(page: Page, options: {
  allergyNotes?: string;
  attendance?: RsvpAttendance;
  extraGuests?: string;
  foodPreference?: string;
  phone?: string;
  plusOne?: {
    name: string;
    phone?: string;
    smsOptIn?: boolean;
  };
  smsOptIn?: boolean;
}) {
  if (options.attendance) {
    await chooseAttendance(page, options.attendance);
  }

  if (options.phone !== undefined) {
    await page.getByPlaceholder("+46701234567").fill(options.phone);
  }

  if (options.smsOptIn !== undefined) {
    const smsCheckbox = page.getByLabel(/Send me important SMS updates/);

    if (options.smsOptIn) {
      await smsCheckbox.check();
    } else {
      await smsCheckbox.uncheck();
    }
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

  if (options.plusOne) {
    await page.locator("form").last().evaluate(
      (form, plusOne) => {
        const fields = {
          plus_one_name: plusOne.name,
          plus_one_phone: plusOne.phone ?? "",
          plus_one_sms_opt_in: plusOne.smsOptIn ? "on" : "",
        };

        for (const [name, value] of Object.entries(fields)) {
          let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);

          if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            form.append(input);
          }

          input.value = value;
        }
      },
      options.plusOne,
    );
  }

  await page.getByRole("button", { name: /^(Submit|Update) RSVP$/ }).click();
}

test.describe("RSVP, invite status, and phone capture", () => {
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

    expect((await getGuestByName(guestName))?.invite_status).toBe(
      INVITE_STATUS.notReplied,
    );

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.opened);

    await submitRsvp(page, {
      allergyNotes: "Peanuts and sesame.",
      attendance: RSVP_ATTENDANCE.yes,
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
      .toBe(INVITE_STATUS.rsvpYes);
    const guestAfterRsvp = await getGuestByName(guestName);
    expect(guestAfterRsvp?.phone).toBeNull();
    expect(guestAfterRsvp?.sms_opt_in).toBe(false);
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Peanuts and sesame.",
      attendance: RSVP_ATTENDANCE.yes,
      extra_guests: 2,
      food_preference: "Vegan",
    });

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await page.getByLabel("Search name or phone").fill(guestName);
    await page.getByRole("button", { name: "Apply" }).click();
    const row = await guestRowByName(page, guestName);
    await expect(row.getByText(INVITE_STATUS.rsvpYes, { exact: true })).toBeVisible();
    await expect(row.getByText("Extra guests: 2")).toBeVisible();
    await expect(row.getByText("Food: Vegan")).toBeVisible();
    await expect(row.getByText("Notes: Peanuts and sesame.")).toBeVisible();
  });

  test("persists named +1 details when submitted for an allowed guest", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Allowed Plus One");
    const token = uniqueInviteToken("allowed-plus-one-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-plus-one@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();

    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      extraGuests: "1",
      phone: "",
      plusOne: {
        name: "E2E Plus One",
        phone: "+46701112233",
        smsOptIn: true,
      },
    });

    await expect(page.getByText("Thank you — your RSVP has been saved.")).toBeVisible();
    await expect(page.getByText("+1: E2E Plus One")).toBeVisible();
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      attendance: RSVP_ATTENDANCE.yes,
      extra_guests: 1,
      plus_one_name: "E2E Plus One",
      plus_one_phone: "+46701112233",
      plus_one_sms_opt_in: true,
    });
  });

  test("rejects named +1 details for a guest without +1 permission", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Blocked Plus One");
    const token = uniqueInviteToken("blocked-plus-one-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-plus-one-blocked@example.com",
      fullName: guestName,
      plusOneAllowed: false,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();

    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      extraGuests: "1",
      phone: "",
      plusOne: {
        name: "Unexpected Plus One",
        phone: "+46701112234",
      },
    });

    await expect(
      page.getByText("We could not save your RSVP. Please check the form and try again."),
    ).toBeVisible();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);
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

    await submitRsvp(page, { attendance: RSVP_ATTENDANCE.yes, extraGuests: "-1" });
    await expect(
      page.getByText("Extra guest count must be a whole number of 0 or more."),
    ).toBeVisible();

    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      extraGuests: "0",
      phone: "0701234567",
    });
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Phone must use country-code format, e.g. +46701234567. It is required for SMS updates.",
    );
  });

  test("prefills and updates an existing RSVP without duplicate rows or status downgrade", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Update Existing");
    const token = uniqueInviteToken("update-existing-rsvp");
    const { guestId } = await createInviteTestGuest({
      attendance: RSVP_ATTENDANCE.yes,
      email: "e2e-rsvp-update@example.com",
      extraGuests: 1,
      foodPreference: "Meat",
      fullName: guestName,
      inviteStatus: INVITE_STATUS.rsvpYes,
      notes: "No shellfish.",
      phone: "+46700000000",
      plusOneAllowed: true,
      plusOneName: "Existing Plus One",
      plusOnePhone: "+46701112235",
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText("Review or update your RSVP")).toBeVisible();
    await expect(page.getByText("Yes, I will be there")).toBeVisible();
    await expect(page.getByPlaceholder("+46701234567")).toHaveValue("+46700000000");
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.rsvpYes);

    await submitRsvp(page, {
      allergyNotes: "Updated notes.",
      attendance: RSVP_ATTENDANCE.maybe,
      extraGuests: "0",
      foodPreference: "Fish",
      phone: "+46708889999",
      smsOptIn: true,
    });

    await expect(page.getByText("Thank you — your RSVP has been saved.")).toBeVisible();
    await expect(page.getByText("Maybe, I will confirm later")).toBeVisible();
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.rsvpMaybe);
    const guestAfterUpdate = await getGuestByName(guestName);
    expect(guestAfterUpdate?.phone).toBe("+46708889999");
    expect(guestAfterUpdate?.sms_opt_in).toBe(true);
    expect(guestAfterUpdate?.sms_opted_in_at).toEqual(expect.any(String));
    expect(guestAfterUpdate?.sms_opted_out_at).toBeNull();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Updated notes.",
      attendance: RSVP_ATTENDANCE.maybe,
      extra_guests: 0,
      food_preference: "Fish",
      plus_one_name: "Existing Plus One",
      plus_one_phone: "+46701112235",
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText("Maybe, I will confirm later")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Maybe\b/ })).toBeChecked();
    await expect(page.getByPlaceholder("+46701234567")).toHaveValue("+46708889999");
    await expect(page.getByLabel(/Send me important SMS updates/)).toBeChecked();
  });
});
