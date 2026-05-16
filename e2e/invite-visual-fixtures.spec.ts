import { expect, test } from "@playwright/test";

import {
  getInviteVisualFixture,
  seedInviteVisualFixtures,
} from "./support/invite-visual-fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";

test.describe.serial("stable invite visual fixtures", () => {
  test.beforeAll(async () => {
    await seedInviteVisualFixtures();
  });

  test("resets only the visual fixture rows", async () => {
    const supabase = createE2eSupabaseAdminClient();
    const uniqueSuffix = Date.now();
    const unrelatedGuestName = `Unrelated Visual Guard ${uniqueSuffix}`;
    const unrelatedUpdateTitle = `Visual Fixture: Unrelated Guard ${uniqueSuffix}`;
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .insert({
        email: `unrelated-visual-guard-${uniqueSuffix}@example.com`,
        full_name: unrelatedGuestName,
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id")
      .single();
    expect(guestError).toBeNull();

    const { data: update, error: updateError } = await supabase
      .from("wedding_updates")
      .insert({
        message: "This row must survive visual fixture resets.",
        status: "published",
        title: unrelatedUpdateTitle,
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id")
      .single();
    expect(updateError).toBeNull();

    if (!guest?.id || !update?.id) {
      throw new Error("Expected unrelated guard rows to be inserted.");
    }

    try {
      await seedInviteVisualFixtures(supabase);

      const { data: persistedGuest, error: persistedGuestError } = await supabase
        .from("guests")
        .select("full_name")
        .eq("id", guest.id)
        .single();
      expect(persistedGuestError).toBeNull();
      expect(persistedGuest?.full_name).toBe(unrelatedGuestName);

      const { data: persistedUpdate, error: persistedUpdateError } = await supabase
        .from("wedding_updates")
        .select("title")
        .eq("id", update.id)
        .single();
      expect(persistedUpdateError).toBeNull();
      expect(persistedUpdate?.title).toBe(unrelatedUpdateTitle);
    } finally {
      await supabase.from("wedding_updates").delete().eq("id", update.id);
      await supabase.from("guests").delete().eq("id", guest.id);
    }
  });

  test("loads saved Nej, saved Kanske, +1-expanded, and published-update fixture URLs", async ({
    page,
  }) => {
    const rsvpNo = getInviteVisualFixture("rsvpNo");
    await page.goto(rsvpNo.osaPath);
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Nej\s+kan inte$/ })).toBeChecked();

    const rsvpMaybe = getInviteVisualFixture("rsvpMaybe");
    await page.goto(rsvpMaybe.osaPath);
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Kanske\s+återkommer$/ }))
      .toBeChecked();

    const plusOneExpanded = getInviteVisualFixture("plusOneExpanded");
    await page.goto(plusOneExpanded.osaPath);
    await expect(page.getByRole("heading", { name: "Uppdatera svar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ }))
      .toBeChecked();
    await expect(page.getByRole("textbox", { name: "Namn" }))
      .toHaveValue(plusOneExpanded.rsvp?.plusOneName ?? "");

    const updatesPublished = getInviteVisualFixture("updatesPublished");
    await page.goto(updatesPublished.detailsPath);
    await expect(page.getByRole("heading", { name: "Detaljer" })).toBeVisible();
    const updatesSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Uppdateringar" }),
    });
    await expect(
      updatesSection.getByRole("heading", { name: "Visual Fixture: Transport" }),
    ).toBeVisible();
    await expect(
      updatesSection.getByText("Bussar avgår från hotellet kl. 15:45."),
    ).toBeVisible();
  });
});
