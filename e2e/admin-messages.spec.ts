import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import { addGuest, uniqueGuestName } from "./support/admin-guests";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";

test.describe("admin SMS messages", () => {
  test("shows the 46elks composer and recipient counts", async ({ page }) => {
    const guestName = uniqueGuestName("SMS Composer");

    await signInAsSeededAdmin(page);
    await page.goto("/admin/guests");
    await addGuest(page, {
      fullName: guestName,
      phone: "+46709991111",
      smsOptIn: true,
    });

    await page.goto("/admin");
    await page.getByRole("link", { name: "Send messages" }).click();

    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SMS composer" })).toBeVisible();
    await expect(page.getByText("Provider: 46elks.")).toBeVisible();
    await expect(page.getByText("All guests").first()).toBeVisible();
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByLabel("Body text")).toBeVisible();
    await expect(page.getByLabel("Audience")).toBeVisible();
    await expect(page.getByLabel(/I understand this sends real SMS messages/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send SMS now" })).toBeVisible();
  });

  test("sends only opted-in guests with valid phones in mock mode", async ({ page }) => {
    const supabase = createE2eSupabaseAdminClient();
    const eligibleName = uniqueGuestName("SMS Eligible");
    const plusOneName = uniqueGuestName("SMS Plus One");
    const skippedName = uniqueGuestName("SMS Skipped");
    const body = `E2E SMS mock body ${Date.now()}`;
    const now = new Date().toISOString();
    const { data: eligibleGuest, error: insertEligibleError } = await supabase
      .from("guests")
      .insert({
        email: "e2e-sms-eligible@example.com",
        full_name: eligibleName,
        guest_kind: "invited",
        invite_status: "opened",
        phone: "+46709992221",
        rsvp_status: "rsvp maybe",
        sms_opt_in: true,
        sms_opted_in_at: now,
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id")
      .single();

    expect(insertEligibleError).toBeNull();
    expect(typeof eligibleGuest?.id).toBe("string");

    if (!eligibleGuest || typeof eligibleGuest.id !== "string") {
      throw new Error("Expected eligible invited guest to be created.");
    }

    const { data: otherGuests, error: insertGuestsError } = await supabase
      .from("guests")
      .insert([
        {
          full_name: plusOneName,
          guest_kind: "plus_one",
          invited_guest_id: eligibleGuest.id,
          invite_status: "not replied",
          phone: "+46709992231",
          rsvp_status: "rsvp no",
          sms_opt_in: true,
          sms_opted_in_at: now,
          wedding_id: SEEDED_WEDDING_ID,
        },
        {
          email: "e2e-sms-skipped@example.com",
          full_name: skippedName,
          guest_kind: "invited",
          invite_status: "opened",
          phone: "+46709992222",
          rsvp_status: "rsvp maybe",
          sms_opt_in: false,
          wedding_id: SEEDED_WEDDING_ID,
        },
      ])
      .select("id, full_name");

    expect(insertGuestsError).toBeNull();
    const plusOneGuest = otherGuests?.find((guest) => guest.full_name === plusOneName);
    expect(typeof plusOneGuest?.id).toBe("string");

    if (!plusOneGuest || typeof plusOneGuest.id !== "string") {
      throw new Error("Expected eligible Plus-one Guest to be created.");
    }

    try {
      await signInAsSeededAdmin(page);
      await page.goto("/admin/messages");
      await expect(page.getByText("46elks mock send mode")).toBeVisible();

      await page.getByLabel("Title").fill("E2E SMS mock");
      await page.getByLabel("Body text").fill(body);
      await page.getByLabel("Audience").selectOption("rsvp maybe");
      await page.getByLabel(/I understand this sends real SMS messages/).check();
      await page.getByRole("button", { name: "Send SMS now" }).click();

      await expect(page.getByText("Message sent to 2 guests.")).toBeVisible();

      const { data: blast, error: blastError } = await supabase
        .from("message_blasts")
        .select("id, send_status")
        .eq("body", body)
        .single();

      expect(blastError).toBeNull();
      expect(blast?.send_status).toBe("sent");

      if (!blast || typeof blast.id !== "string") {
        throw new Error("Expected message blast to be created.");
      }

      const { data: deliveries, error: deliveriesError } = await supabase
        .from("message_deliveries")
        .select("delivery_status, guest_id, phone, provider_message_id")
        .eq("message_blast_id", blast.id);

      expect(deliveriesError).toBeNull();
      expect(deliveries).toHaveLength(2);
      expect(deliveries?.map((delivery) => delivery.phone).sort()).toEqual([
        "+46709992221",
        "+46709992231",
      ]);
      expect(deliveries?.map((delivery) => delivery.guest_id).sort()).toEqual(
        [eligibleGuest.id, plusOneGuest.id].sort(),
      );
      for (const delivery of deliveries ?? []) {
        expect(delivery.delivery_status).toBe("sent");
        expect(delivery.provider_message_id).toContain("mock-");
      }
    } finally {
      await supabase.from("message_blasts").delete().eq("body", body);
    }
  });
});
