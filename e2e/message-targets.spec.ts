import { expect, test } from "@playwright/test";

import {
  countMessageTargetsByAudience,
  filterMessageTargetsByAudience,
  selectEligibleMessageTargets,
  type MessageTarget,
  type MessageTargetGuestRow,
} from "../lib/message-targets";
import {
  sendMessageBlastCommand,
  type CreatedMessageDelivery,
  type MessageBlastStore,
  type SmsProviderAdapter,
} from "../lib/message-blast-command";

function guestRow(overrides: Partial<MessageTargetGuestRow> = {}): MessageTargetGuestRow {
  return {
    deleted_at: null,
    full_name: "Test Guest",
    guest_kind: "invited",
    id: "guest-1",
    invited_guest_id: null,
    phone: "+46700000001",
    rsvp_status: "rsvp yes",
    sms_opt_in: true,
    sms_opted_out_at: null,
    ...overrides,
  };
}

function target(overrides: Partial<MessageTarget> = {}): MessageTarget {
  return {
    audienceRsvpStatus: "rsvp yes",
    fullName: "Target Guest",
    guestId: "target-1",
    guestKind: "invited",
    phone: "+46700000001",
    ...overrides,
  };
}

function sortedGuestIds(targets: MessageTarget[]) {
  return targets.map((messageTarget) => messageTarget.guestId).sort();
}

class FakeMessageBlastStore implements MessageBlastStore {
  readonly blastUpdates: Array<{ sendStatus: string; sentAt: string }> = [];
  readonly createdDeliveryRows: CreatedMessageDelivery[] = [];
  readonly deliveryUpdates: Array<{
    deliveryId: string;
    deliveryStatus: string;
    errorText: string | null;
    providerMessageId: string | null;
  }> = [];

  constructor(private readonly targets: MessageTarget[]) {}

  async listMessageTargets() {
    return this.targets;
  }

  async createMessageBlast() {
    return { id: "blast-1" };
  }

  async createMessageDeliveries({ targets }: { targets: MessageTarget[] }) {
    const deliveries = targets.map((messageTarget, index) => ({
      guestId: messageTarget.guestId,
      id: `delivery-${index + 1}`,
      phone: messageTarget.phone,
    }));
    this.createdDeliveryRows.push(...deliveries);
    return deliveries;
  }

  async updateMessageDelivery(input: {
    deliveryId: string;
    deliveryStatus: "failed" | "sent";
    errorText: string | null;
    providerMessageId: string | null;
  }) {
    this.deliveryUpdates.push(input);
  }

  async updateMessageBlast(input: { sendStatus: "failed" | "partial" | "sent"; sentAt: string }) {
    this.blastUpdates.push(input);
  }
}

class DeliveryCreateFailureStore extends FakeMessageBlastStore {
  async createMessageDeliveries(_input: {
    blastId: string;
    targets: MessageTarget[];
    weddingId: string;
  }): Promise<CreatedMessageDelivery[]> {
    void _input;
    throw new Error("Delivery row insert failed");
  }
}

function fakeSmsProvider(sendSms: SmsProviderAdapter["sendSms"]): SmsProviderAdapter {
  return { sendSms };
}

async function withSilencedConsoleError<T>(run: () => Promise<T>) {
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    return await run();
  } finally {
    console.error = originalConsoleError;
  }
}

test.describe("Message targets", () => {
  test("count and audience selection use eligible Guest records with Plus-one RSVP inheritance", () => {
    const rows = [
      guestRow({ full_name: "Invited Yes", id: "invited-yes", rsvp_status: "rsvp yes" }),
      guestRow({
        full_name: "Plus One Yes",
        guest_kind: "plus_one",
        id: "plus-one-yes",
        invited_guest_id: "invited-yes",
        phone: "+46700000001",
        rsvp_status: "rsvp no",
      }),
      guestRow({
        full_name: "Invited No",
        id: "invited-no",
        phone: "+46700000002",
        rsvp_status: "rsvp no",
      }),
      guestRow({
        full_name: "Plus One No",
        guest_kind: "plus_one",
        id: "plus-one-no",
        invited_guest_id: "invited-no",
        phone: "+46700000003",
        rsvp_status: "rsvp yes",
      }),
      guestRow({
        full_name: "Invited Maybe",
        id: "invited-maybe",
        phone: "+46700000004",
        rsvp_status: "rsvp maybe",
      }),
      guestRow({ full_name: "Missing Phone", id: "missing-phone", phone: null }),
      guestRow({ full_name: "Invalid Phone", id: "invalid-phone", phone: "0700000000" }),
      guestRow({ full_name: "No Consent", id: "no-consent", sms_opt_in: false }),
      guestRow({
        full_name: "Opted Out",
        id: "opted-out",
        sms_opted_out_at: "2026-05-18T08:00:00.000Z",
      }),
      guestRow({
        deleted_at: "2026-05-18T08:00:00.000Z",
        full_name: "Archived",
        id: "archived",
      }),
    ];

    const targets = selectEligibleMessageTargets(rows);

    expect(sortedGuestIds(targets)).toEqual([
      "invited-maybe",
      "invited-no",
      "invited-yes",
      "plus-one-no",
      "plus-one-yes",
    ]);
    expect(targets.filter((messageTarget) => messageTarget.phone === "+46700000001")).toHaveLength(
      2,
    );
    expect(countMessageTargetsByAudience(targets)).toEqual({
      all: 5,
      "rsvp maybe": 1,
      "rsvp no": 2,
      "rsvp yes": 2,
    });
    expect(sortedGuestIds(filterMessageTargetsByAudience(targets, "rsvp yes"))).toEqual([
      "invited-yes",
      "plus-one-yes",
    ]);
    expect(sortedGuestIds(filterMessageTargetsByAudience(targets, "rsvp no"))).toEqual([
      "invited-no",
      "plus-one-no",
    ]);
  });

  test("MessageBlast command sends one delivery per target Guest even when phones match", async () => {
    const store = new FakeMessageBlastStore([
      target({ fullName: "Invited", guestId: "invited-1", phone: "+46700000001" }),
      target({
        fullName: "Plus One",
        guestId: "plus-one-1",
        guestKind: "plus_one",
        phone: "+46700000001",
      }),
    ]);
    const sends: Array<{ message: string; to: string }> = [];
    const provider = fakeSmsProvider(async (input) => {
      sends.push(input);
      return { providerMessageId: `provider-${sends.length}` };
    });

    const result = await sendMessageBlastCommand({
      adminId: "admin-1",
      audience: "rsvp yes",
      body: "Body",
      smsProvider: provider,
      store,
      title: "Title",
      weddingId: "wedding-1",
    });

    expect(result).toMatchObject({ failedCount: 0, sendStatus: "sent", sentCount: 2 });
    expect(store.createdDeliveryRows.map((delivery) => delivery.guestId)).toEqual([
      "invited-1",
      "plus-one-1",
    ]);
    expect(sends).toEqual([
      { message: "Title\nBody", to: "+46700000001" },
      { message: "Title\nBody", to: "+46700000001" },
    ]);
    expect(store.deliveryUpdates.map((update) => update.providerMessageId)).toEqual([
      "provider-1",
      "provider-2",
    ]);
    expect(store.blastUpdates.at(-1)?.sendStatus).toBe("sent");
  });

  test("MessageBlast command continues through provider failures and marks partial", async () => {
    const store = new FakeMessageBlastStore([
      target({ guestId: "target-1", phone: "+46700000001" }),
      target({ guestId: "target-2", phone: "+46700000002" }),
      target({ guestId: "target-3", phone: "+46700000003" }),
    ]);
    const attemptedPhones: string[] = [];
    const provider = fakeSmsProvider(async ({ to }) => {
      attemptedPhones.push(to);
      if (to === "+46700000002") {
        throw new Error("Provider rejected target-2");
      }
      return { providerMessageId: `provider-${to}` };
    });

    const result = await withSilencedConsoleError(() =>
      sendMessageBlastCommand({
        adminId: "admin-1",
        audience: "all",
        body: "Body",
        smsProvider: provider,
        store,
        title: null,
        weddingId: "wedding-1",
      }),
    );

    expect(attemptedPhones).toEqual(["+46700000001", "+46700000002", "+46700000003"]);
    expect(result).toMatchObject({ failedCount: 1, sendStatus: "partial", sentCount: 2 });
    expect(store.deliveryUpdates.map((update) => update.deliveryStatus)).toEqual([
      "sent",
      "failed",
      "sent",
    ]);
    expect(store.deliveryUpdates[1]?.errorText).toContain("Provider rejected target-2");
    expect(store.blastUpdates.at(-1)?.sendStatus).toBe("partial");
  });

  test("MessageBlast command marks the blast failed when delivery rows cannot be created", async () => {
    const store = new DeliveryCreateFailureStore([
      target({ guestId: "target-1", phone: "+46700000001" }),
    ]);
    const provider = fakeSmsProvider(async () => ({ providerMessageId: "not-called" }));

    await expect(
      withSilencedConsoleError(() =>
        sendMessageBlastCommand({
          adminId: "admin-1",
          audience: "all",
          body: "Body",
          smsProvider: provider,
          store,
          title: null,
          weddingId: "wedding-1",
        }),
      ),
    ).rejects.toThrow("Delivery row insert failed");
    expect(store.blastUpdates.at(-1)?.sendStatus).toBe("failed");
    expect(store.createdDeliveryRows).toEqual([]);
  });

  test("MessageBlast command marks failed when every provider send fails", async () => {
    const store = new FakeMessageBlastStore([
      target({ guestId: "target-1", phone: "+46700000001" }),
      target({ guestId: "target-2", phone: "+46700000002" }),
    ]);
    const provider = fakeSmsProvider(async () => {
      throw new Error("Provider unavailable");
    });

    const result = await withSilencedConsoleError(() =>
      sendMessageBlastCommand({
        adminId: "admin-1",
        audience: "all",
        body: "Body",
        smsProvider: provider,
        store,
        title: null,
        weddingId: "wedding-1",
      }),
    );

    expect(result).toMatchObject({ failedCount: 2, sendStatus: "failed", sentCount: 0 });
    expect(store.deliveryUpdates.map((update) => update.deliveryStatus)).toEqual(["failed", "failed"]);
    expect(store.blastUpdates.at(-1)?.sendStatus).toBe("failed");
  });
});
