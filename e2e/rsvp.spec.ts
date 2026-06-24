import { expect, type Locator, type Page } from "@playwright/test";

import { hashInviteToken } from "../lib/invite-token-crypto";
import { INVITE_STATUS, RSVP_STATUS } from "../lib/invite-status";
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
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { invitePathForToken } from "./support/urls";

function inviteOsaPathForToken(token: string) {
  return `${invitePathForToken(token)}#osa`;
}

const panelIds = ["inbjudan", "detaljer", "osa"] as const;
const panelLabels = {
  detaljer: "Detaljer",
  inbjudan: "Inbjudan",
  osa: "OSA",
} as const satisfies Record<(typeof panelIds)[number], string>;

async function expectInvitePanel(page: Page, activePanelId: (typeof panelIds)[number]) {
  for (const panelId of panelIds) {
    const panel = page.locator(`#${panelId}`);

    if (panelId === activePanelId) {
      await expect(panel, `${panelId} should be the visible invite panel`).toBeVisible();
      await expect(
        page.getByRole("link", { name: `Gå till ${panelLabels[panelId]}` }),
      ).toHaveAttribute("aria-current", "step");
    } else {
      await expect(panel, `${panelId} should be hidden when ${activePanelId} is active`)
        .toBeHidden();
    }
  }
}

async function dispatchTouchPointer(
  target: Locator,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  await target.dispatchEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    isPrimary: true,
    pointerId: 1,
    pointerType: "touch",
  });
}

async function chooseAttendance(page: Page, attendance: RsvpAttendance) {
  const names: Record<RsvpAttendance, RegExp> = {
    [RSVP_ATTENDANCE.maybe]: /^Kanske\s+återkommer$/,
    [RSVP_ATTENDANCE.no]: /^Nej\s+kan inte$/,
    [RSVP_ATTENDANCE.yes]: /^Ja\s+kommer$/,
  };

  await page.getByRole("radio", { name: names[attendance] }).check({ force: true });
}

async function delayNextInvitePost(page: Page) {
  let releaseSubmit: (() => void) | null = null;
  let resolveSubmitStarted!: () => void;
  const submitStarted = new Promise<void>((resolve) => {
    resolveSubmitStarted = resolve;
  });

  await page.route("**/invite/**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    resolveSubmitStarted();
    await new Promise<void>((resume) => {
      releaseSubmit = resume;
    });
    await route.continue();
  });

  return {
    release() {
      if (!releaseSubmit) {
        throw new Error("Invite POST was not intercepted before release.");
      }

      releaseSubmit();
    },
    submitStarted,
  };
}

async function submitRsvp(page: Page, options: {
  allergyNotes?: string;
  attendance?: RsvpAttendance;
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
    await page.getByRole("textbox", { name: "Telefon" }).first().fill(options.phone);
  }

  if (options.smsOptIn !== undefined) {
    const smsCheckbox = page.getByLabel(/Skicka mig viktiga SMS/);

    if (options.smsOptIn) {
      await smsCheckbox.check();
    } else {
      await smsCheckbox.uncheck();
    }
  }

  if (options.foodPreference !== undefined) {
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
      options.foodPreference,
    );
  }

  if (options.allergyNotes !== undefined) {
    await page.getByRole("textbox", { name: "Allergier & övriga önskemål" }).first().fill(
      options.allergyNotes,
    );
  }

  if (options.plusOne) {
    const plusOneRadio = page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ });

    if (await plusOneRadio.isVisible()) {
      await plusOneRadio.check({ force: true });
      await page.getByRole("textbox", { name: "Namn" }).fill(options.plusOne.name);

      if (options.plusOne.phone !== undefined) {
        await page.getByRole("textbox", { name: "Telefon" }).nth(1).fill(
          options.plusOne.phone,
        );
      }

      if (options.plusOne.smsOptIn !== undefined) {
        const plusOneSmsCheckbox = page.getByLabel(/Skicka även SMS/);

        if (options.plusOne.smsOptIn) {
          await plusOneSmsCheckbox.check();
        } else {
          await plusOneSmsCheckbox.uncheck();
        }
      }
    } else {
      await page.locator("form").last().evaluate(
        (form, plusOne) => {
          const fields = {
            include_plus_one: "true",
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
  }

  await page.getByRole("button", { name: /^(Skicka mitt svar|Spara ändringar)/ }).click();
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

    await page.goto(inviteOsaPathForToken(token));
    const osaPanel = page.locator("#osa");
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();
    const panelNavigation = page.getByRole("navigation", { name: "Inbjudans paneler" });
    await expect(panelNavigation.getByText(/03\/03/)).toBeVisible();
    await expect(panelNavigation.getByText("OSA", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gå till OSA" }))
      .toHaveAttribute("aria-current", "step");
    await expect(osaPanel.getByText("Svara när du kan", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "OSA" })).toHaveCount(0);
    await expect(
      osaPanel.getByText(
        "Svara eller uppdatera ditt svar här när du vet om du kan komma.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(osaPanel.getByText("Sida tre", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.opened);

    await submitRsvp(page, {
      allergyNotes: "Peanuts and sesame.",
      attendance: RSVP_ATTENDANCE.yes,
      foodPreference: "Vegan",
      phone: "",
    });

    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
    await expect(osaPanel.getByText("jag kommer gärna")).toBeVisible();
    await expect(page.getByRole("button", { name: "Uppdatera mitt svar" })).toBeVisible();
    await expect(osaPanel.getByText("Svara när du kan", { exact: true })).toHaveCount(0);
    await expect(osaPanel.getByText("Sida tre", { exact: true })).toHaveCount(0);

    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.opened);
    await expect
      .poll(async () => (await getGuestByName(guestName))?.rsvp_status)
      .toBe(RSVP_STATUS.rsvpYes);
    const guestAfterRsvp = await getGuestByName(guestName);
    expect(guestAfterRsvp?.phone).toBeNull();
    expect(guestAfterRsvp?.sms_opt_in).toBe(false);
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Peanuts and sesame.",
      attendance: RSVP_ATTENDANCE.yes,
      extra_guests: 0,
      food_preference: "Vegan",
    });

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await page.getByLabel("Search name or phone").fill(guestName);
    await page.getByRole("button", { name: "Apply" }).click();
    const row = await guestRowByName(page, guestName);
    await expect(row.getByText("OSA: OSA ja", { exact: true })).toBeVisible();
    await expect(row.getByText("Mat: Vegan")).toBeVisible();
    await expect(row.getByText("Allergier: Peanuts and sesame.")).toBeVisible();
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

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();

    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      phone: "",
      plusOne: {
        name: "E2E Plus One",
        phone: "+46701112233",
        smsOptIn: true,
      },
    });

    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
    await expect(page.getByText("E2E Plus One")).toBeVisible();
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      attendance: RSVP_ATTENDANCE.yes,
      extra_guests: 1,
      plus_one_name: "E2E Plus One",
      plus_one_phone: "+46701112233",
      plus_one_sms_opt_in: true,
    });
  });

  test("rejects extra guest counts above the Brevkort +1 contract", async () => {
    const guestName = uniqueRsvpGuestName("Too Many Plus Ones");
    const token = uniqueInviteToken("too-many-plus-ones-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-too-many-plus-ones@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });
    const supabase = createE2eSupabaseAdminClient();
    const { error } = await supabase.rpc("submit_rsvp_response", {
      p_allergy_notes: null,
      p_attendance: RSVP_ATTENDANCE.yes,
      p_extra_guests: 2,
      p_food_preference: null,
      p_phone: null,
      p_plus_one_allergy_notes: null,
      p_plus_one_email: null,
      p_plus_one_food_preference: null,
      p_plus_one_name: "Too Many Guests",
      p_plus_one_phone: null,
      p_plus_one_sms_opt_in: false,
      p_sms_opt_in: false,
      p_token_hash: hashInviteToken(token),
    });

    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("Invalid extra guest count");
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);
  });

  test("requires phone numbers before SMS opt-in for the guest and +1", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Sms Phone Required");
    const token = uniqueInviteToken("sms-phone-required-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-sms-phone-required@example.com",
      fullName: guestName,
      plusOneAllowed: true,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();

    await page.getByLabel(/Skicka mig viktiga SMS/).check();
    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();

    await expect(
      page.getByText("Lägg till ett telefonnummer om du vill få SMS-uppdateringar."),
    ).toBeVisible();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);

    await page.getByLabel(/Skicka mig viktiga SMS/).uncheck();
    await page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ }).check({ force: true });
    await page.getByRole("textbox", { name: "Namn" }).fill("SMS Plus One");
    await page.getByLabel(/Skicka även SMS/).check();
    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();

    await expect(
      page.getByText(
        "Lägg till din gästs telefonnummer om hen ska få SMS-uppdateringar.",
      ),
    ).toBeVisible();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);
  });

  test("shows submitting state and preserves values while save is pending", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Submitting State");
    const token = uniqueInviteToken("submitting-state-rsvp");
    await createInviteTestGuest({
      email: "e2e-rsvp-submitting-state@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
      "Pending vegetarian meal",
    );

    const delayedSubmit = await delayNextInvitePost(page);
    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();
    await delayedSubmit.submitStarted;

    await expect(page.getByRole("button", { name: "Skickar…" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
      "Pending vegetarian meal",
    );

    delayedSubmit.release();
    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
  });

  test("preserves RSVP edits and validation while navigating away and back", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Panel Draft");
    const token = uniqueInviteToken("panel-draft-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-panel-draft@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expectInvitePanel(page, "osa");
    await page.getByRole("textbox", { name: "Telefon" }).first().fill("0701234567");
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
      "Draft saffron risotto",
    );
    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();
    await expect(
      page.getByText(
        "Använd internationellt format utan mellanslag, t.ex. +46701234567.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Föregående panel" }).click();
    await expectInvitePanel(page, "detaljer");
    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expectInvitePanel(page, "osa");
    await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
      "Draft saffron risotto",
    );
    await expect(
      page.getByText(
        "Använd internationellt format utan mellanslag, t.ex. +46701234567.",
      ),
    ).toBeVisible();

    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await expectInvitePanel(page, "detaljer");
    await page.getByRole("link", { name: "Gå till OSA" }).click();
    await expectInvitePanel(page, "osa");
    await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
      "Draft saffron risotto",
    );

    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await expectInvitePanel(page, "detaljer");
    await page.getByRole("link", { name: /^Vidare till OSA/ }).click();
    await expectInvitePanel(page, "osa");
    await expect(page.getByRole("textbox", { name: "Telefon" }).first()).toHaveValue(
      "0701234567",
    );
    await expect(
      page.getByText(
        "Använd internationellt format utan mellanslag, t.ex. +46701234567.",
      ),
    ).toBeVisible();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);
  });

  test("lets guests navigate while an RSVP submit finishes in the background", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Pending Panel Navigation");
    const token = uniqueInviteToken("pending-panel-navigation-rsvp");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-rsvp-pending-panel-navigation@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expectInvitePanel(page, "osa");
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
      "Background submit meal",
    );

    const delayedSubmit = await delayNextInvitePost(page);
    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();
    await delayedSubmit.submitStarted;
    await expect(page.getByRole("button", { name: "Skickar…" })).toBeDisabled();

    await page.getByRole("button", { name: "Föregående panel" }).click();
    await expectInvitePanel(page, "detaljer");

    delayedSubmit.release();
    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
    await expectInvitePanel(page, "osa");
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      attendance: RSVP_ATTENDANCE.yes,
      food_preference: "Background submit meal",
    });
  });

  test("keeps RSVP drafts across reduced-motion panel switches", async ({ page }) => {
    const guestName = uniqueRsvpGuestName("Reduced Motion Draft");
    const token = uniqueInviteToken("reduced-motion-draft-rsvp");
    await createInviteTestGuest({
      email: "e2e-rsvp-reduced-motion-draft@example.com",
      fullName: guestName,
      token,
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(inviteOsaPathForToken(token));
    await expectInvitePanel(page, "osa");
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
      "Reduced-motion mushroom tart",
    );

    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await expectInvitePanel(page, "detaljer");
    await page.getByRole("link", { name: "Gå till OSA" }).click();
    await expectInvitePanel(page, "osa");
    await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
      "Reduced-motion mushroom tart",
    );
  });

  test("does not drag panels from RSVP form controls", async ({ page }) => {
    const guestName = uniqueRsvpGuestName("Form Control Swipe");
    const token = uniqueInviteToken("form-control-swipe-rsvp");
    await createInviteTestGuest({
      email: "e2e-rsvp-form-control-swipe@example.com",
      fullName: guestName,
      token,
    });

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(inviteOsaPathForToken(token));
    await expectInvitePanel(page, "osa");

    const carousel = page.getByTestId("invite-panel-carousel");
    const foodPreference = page.getByRole("textbox", { name: "Matpreferens" }).first();
    await dispatchTouchPointer(foodPreference, "pointerdown", 80, 610);
    await dispatchTouchPointer(carousel, "pointermove", 330, 610);
    await dispatchTouchPointer(carousel, "pointerup", 330, 610);
    await expectInvitePanel(page, "osa");
    await expect(page).toHaveURL(/#osa$/);

    const yesAttendance = page.getByRole("radio", { name: /^Ja\s+kommer$/ });
    await dispatchTouchPointer(yesAttendance, "pointerdown", 80, 430);
    await dispatchTouchPointer(carousel, "pointermove", 330, 430);
    await dispatchTouchPointer(carousel, "pointerup", 330, 430);
    await expectInvitePanel(page, "osa");
    await expect(page).toHaveURL(/#osa$/);
  });

  test("shows a save error and preserves values when the token is invalidated", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Save Error");
    const token = uniqueInviteToken("save-error-rsvp");
    const { guestId, tokenId } = await createInviteTestGuest({
      email: "e2e-rsvp-save-error@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();
    await page.getByRole("textbox", { name: "Telefon" }).first().fill("+46701234567");
    await page.getByRole("textbox", { name: "Matpreferens" }).first().fill("Save error vegetarian");

    const supabase = createE2eSupabaseAdminClient();
    const { error } = await supabase
      .from("invite_tokens")
      .update({
        invalidated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq("id", tokenId);

    expect(error).toBeNull();

    await page.getByRole("button", { name: /^Skicka mitt svar/ }).click();

    await expect(page.getByText("Kunde inte spara")).toBeVisible();
    await expect(
      page.getByText(
        "Inbjudningslänken kunde inte verifieras. Be om en ny länk och försök igen.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Telefon" }).first()).toHaveValue(
      "+46701234567",
    );
    await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
      "Save error vegetarian",
    );
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(0);
  });

  test("clears named +1 details when an allowed guest removes the +1", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Remove Plus One");
    const token = uniqueInviteToken("remove-plus-one-rsvp");
    const { guestId } = await createInviteTestGuest({
      attendance: RSVP_ATTENDANCE.yes,
      email: "e2e-rsvp-remove-plus-one@example.com",
      extraGuests: 1,
      fullName: guestName,
      inviteStatus: INVITE_STATUS.rsvpYes,
      phone: "+46700000001",
      plusOneAllowed: true,
      plusOneAllergyNotes: "No nuts.",
      plusOneEmail: "existing-plus-one@example.com",
      plusOneFoodPreference: "Vegetarian",
      plusOneName: "Existing Plus One",
      plusOnePhone: "+46701112236",
      plusOneSmsOptIn: true,
      token,
    });

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ })).toBeChecked();

    await page.getByRole("radio", { name: /^Nej\s+bara jag$/ }).check({ force: true });
    await expect(page.getByRole("textbox", { name: "Namn" })).toBeHidden();
    await page.getByRole("button", { name: /^Spara ändringar/ }).click();

    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      attendance: RSVP_ATTENDANCE.yes,
      extra_guests: 0,
      plus_one_allergy_notes: null,
      plus_one_email: null,
      plus_one_food_preference: null,
      plus_one_name: null,
      plus_one_phone: null,
      plus_one_sms_opt_in: false,
    });

    await page.getByRole("button", { name: "Uppdatera mitt svar" }).click();
    await expect(page.getByRole("radio", { name: /^Nej\s+bara jag$/ })).toBeChecked();
    await page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ }).check({ force: true });
    await expect(page.getByRole("textbox", { name: "Namn" })).toHaveValue("");
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

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Låt oss veta" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /^Nej\s+bara jag$/ })).toHaveCount(0);

    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      phone: "",
      plusOne: {
        name: "Unexpected Plus One",
        phone: "+46701112234",
      },
    });

    await expect(
      page.getByText("Du kan inte lägga till en +1 på den här inbjudan."),
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

    await page.goto(inviteOsaPathForToken(token));
    await submitRsvp(page, {
      attendance: RSVP_ATTENDANCE.yes,
      phone: "0701234567",
    });
    await expect(
      page.getByText(
        "Använd internationellt format utan mellanslag, t.ex. +46701234567.",
      ),
    ).toBeVisible();
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

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Ja\s+kommer$/ })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Telefon" }).first()).toHaveValue("+46700000000");
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.opened);
    await expect
      .poll(async () => (await getGuestByName(guestName))?.rsvp_status)
      .toBe(RSVP_STATUS.rsvpYes);

    await submitRsvp(page, {
      allergyNotes: "Updated notes.",
      attendance: RSVP_ATTENDANCE.maybe,
      foodPreference: "Fish",
      phone: "+46708889999",
      smsOptIn: true,
    });

    const osaPanel = page.locator("#osa");
    await expect(page.getByRole("heading", { name: `Tack ${guestName.split(" ").at(0)}` })).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/invite/${token}\\?rsvp_status=submitted#osa$`),
    );
    await expect(osaPanel.getByText("jag återkommer")).toBeVisible();
    await page.getByRole("button", { name: "Uppdatera mitt svar" }).click();
    await expect(page).toHaveURL(new RegExp(`/invite/${token}#osa$`));
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect
      .poll(async () => (await getGuestByName(guestName))?.invite_status)
      .toBe(INVITE_STATUS.opened);
    await expect
      .poll(async () => (await getGuestByName(guestName))?.rsvp_status)
      .toBe(RSVP_STATUS.rsvpMaybe);
    const guestAfterUpdate = await getGuestByName(guestName);
    expect(guestAfterUpdate?.phone).toBe("+46708889999");
    expect(guestAfterUpdate?.sms_opt_in).toBe(true);
    expect(guestAfterUpdate?.sms_opted_in_at).toEqual(expect.any(String));
    expect(guestAfterUpdate?.sms_opted_out_at).toBeNull();
    expect(await getRsvpResponseCountForGuest(guestId)).toBe(1);
    expect(await getRsvpResponseForGuest(guestId)).toMatchObject({
      allergy_notes: "Updated notes.",
      attendance: RSVP_ATTENDANCE.maybe,
      extra_guests: 1,
      food_preference: "Fish",
      plus_one_name: "Existing Plus One",
      plus_one_phone: "+46701112235",
    });

    await page.goto(inviteOsaPathForToken(token));
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Kanske\s+återkommer$/ })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Telefon" }).first()).toHaveValue("+46708889999");
    await expect(page.getByLabel(/Skicka mig viktiga SMS/)).toBeChecked();
  });
});
