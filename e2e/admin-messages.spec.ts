import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import { addGuest, uniqueGuestName } from "./support/admin-guests";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_ADMIN, SEEDED_WEDDING_ID } from "./support/test-data";

async function getSeededAdminProfileId() {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_profiles")
    .select("id")
    .eq("email", SEEDED_ADMIN.email)
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .single();

  expect(error).toBeNull();
  expect(typeof data?.id).toBe("string");

  if (!data || typeof data.id !== "string") {
    throw new Error("Expected seeded admin profile.");
  }

  return data.id;
}

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

  test("previews and sends Invite SMS links without storing raw links", async ({ page }) => {
    const supabase = createE2eSupabaseAdminClient();
    const adminProfileId = await getSeededAdminProfileId();
    const eligibleName = uniqueGuestName("Invite SMS Eligible");
    const openedName = uniqueGuestName("Invite SMS Opened");
    const skippedName = uniqueGuestName("Invite SMS No Consent");
    const priorSentName = uniqueGuestName("Invite SMS Prior Sent");
    const template = `Hej {{first_name}}! E2E invite SMS ${Date.now()}: {{invite_link}}`;
    const now = new Date().toISOString();
    const { data: guests, error: guestsError } = await supabase
      .from("guests")
      .insert([
        {
          email: "e2e-invite-sms-eligible@example.com",
          full_name: eligibleName,
          guest_kind: "invited",
          invite_status: "not replied",
          phone: "+46709993331",
          rsvp_status: "not replied",
          sms_opt_in: true,
          sms_opted_in_at: now,
          wedding_id: SEEDED_WEDDING_ID,
        },
        {
          email: "e2e-invite-sms-opened@example.com",
          full_name: openedName,
          guest_kind: "invited",
          invite_status: "opened",
          phone: "+46709993332",
          rsvp_status: "not replied",
          sms_opt_in: true,
          sms_opted_in_at: now,
          wedding_id: SEEDED_WEDDING_ID,
        },
        {
          email: "e2e-invite-sms-skipped@example.com",
          full_name: skippedName,
          guest_kind: "invited",
          invite_status: "not replied",
          phone: "+46709993333",
          rsvp_status: "not replied",
          sms_opt_in: false,
          wedding_id: SEEDED_WEDDING_ID,
        },
        {
          email: "e2e-invite-sms-prior@example.com",
          full_name: priorSentName,
          guest_kind: "invited",
          invite_status: "not replied",
          phone: "+46709993334",
          rsvp_status: "not replied",
          sms_opt_in: true,
          sms_opted_in_at: now,
          wedding_id: SEEDED_WEDDING_ID,
        },
      ])
      .select("id, full_name, phone");

    expect(guestsError).toBeNull();
    const eligibleGuest = guests?.find((guest) => guest.full_name === eligibleName);
    const openedGuest = guests?.find((guest) => guest.full_name === openedName);
    const priorSentGuest = guests?.find((guest) => guest.full_name === priorSentName);

    if (!eligibleGuest?.id || !openedGuest?.id || !priorSentGuest?.id || !priorSentGuest.phone) {
      throw new Error("Expected Invite SMS test Guests.");
    }

    const { data: priorBlast, error: priorBlastError } = await supabase
      .from("message_blasts")
      .insert({
        audience: "all",
        body: "Prior Invite SMS template {{invite_link}}",
        created_by_admin_id: adminProfileId,
        message_kind: "invite_sms",
        send_status: "sent",
        sent_at: now,
        title: "Invite SMS",
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id")
      .single();

    expect(priorBlastError).toBeNull();
    expect(typeof priorBlast?.id).toBe("string");

    if (!priorBlast || typeof priorBlast.id !== "string") {
      throw new Error("Expected prior Invite SMS blast.");
    }

    const { error: priorDeliveryError } = await supabase.from("message_deliveries").insert({
      delivery_status: "sent",
      guest_id: priorSentGuest.id,
      message_blast_id: priorBlast.id,
      phone: priorSentGuest.phone,
      provider_message_id: "mock-prior-invite-sms",
      wedding_id: SEEDED_WEDDING_ID,
    });

    expect(priorDeliveryError).toBeNull();

    try {
      await signInAsSeededAdmin(page);
      await page.goto("/admin/messages");
      await expect(page.getByRole("heading", { name: "Send invite links" })).toBeVisible();

      await page.getByLabel("Invite SMS template").fill(template);
      await page.getByRole("button", { name: "Save and preview" }).click();

      await expect(page.getByText("Invite SMS template saved and preview refreshed.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Rendered example" })).toBeVisible();
      await expect(page.getByText(eligibleName).first()).toBeVisible();
      await expect(page.getByText(openedName).first()).toBeVisible();
      await expect(page.getByText(skippedName).first()).toBeVisible();
      await expect(page.getByText(priorSentName).first()).toBeVisible();
      await expect(page.getByText("Estimated")).toBeVisible();

      await page.getByLabel(/I understand this sends real Invite SMS messages/).check();
      await page.getByRole("button", { name: "Send Invite SMS to 1 Guest" }).click();
      await expect(page.getByText("Invite SMS sent to 1 guest.")).toBeVisible();

      const { data: bulkBlast, error: bulkBlastError } = await supabase
        .from("message_blasts")
        .select("body, id, message_kind")
        .eq("body", template)
        .eq("message_kind", "invite_sms")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      expect(bulkBlastError).toBeNull();
      expect(bulkBlast?.body).toBe(template);
      expect(bulkBlast?.body).toContain("{{invite_link}}");
      expect(bulkBlast?.body).not.toContain("/invite/");

      if (!bulkBlast || typeof bulkBlast.id !== "string") {
        throw new Error("Expected Invite SMS bulk blast.");
      }

      const { data: bulkDeliveries, error: bulkDeliveriesError } = await supabase
        .from("message_deliveries")
        .select("delivery_status, guest_id, invite_token_id, phone, provider_message_id")
        .eq("message_blast_id", bulkBlast.id);

      expect(bulkDeliveriesError).toBeNull();
      expect(bulkDeliveries).toHaveLength(1);
      expect(bulkDeliveries?.[0]).toMatchObject({
        delivery_status: "sent",
        guest_id: eligibleGuest.id,
        phone: "+46709993331",
      });
      expect(bulkDeliveries?.[0]?.provider_message_id).toContain("mock-");
      expect(typeof bulkDeliveries?.[0]?.invite_token_id).toBe("string");

      const openedSingleForm = page.locator("form").filter({ hasText: openedName }).last();
      await openedSingleForm.getByLabel("Confirm one real SMS and fresh Invite link").check();
      await openedSingleForm.getByRole("button", { name: "Send Invite SMS" }).click();
      await expect(page.getByText("Invite SMS sent to 1 guest.")).toBeVisible();

      await expect.poll(async () => {
        const { data: openedDeliveries, error: openedDeliveriesError } = await supabase
          .from("message_deliveries")
          .select("delivery_status, guest_id, invite_token_id")
          .eq("guest_id", openedGuest.id)
          .eq("delivery_status", "sent");

        if (openedDeliveriesError) {
          throw openedDeliveriesError;
        }

        return openedDeliveries?.filter(
          (delivery) => typeof delivery.invite_token_id === "string",
        ).length ?? 0;
      }).toBe(1);
    } finally {
      await supabase.from("message_blasts").delete().eq("body", template);
      await supabase.from("message_blasts").delete().eq("id", priorBlast.id);
    }
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
