import { expect, test } from "@playwright/test";

import {
  createAdminGuestMutation,
  updateAdminGuestMutation,
  type AdminGuestCreateRow,
  type AdminGuestMutationStore,
  type AdminGuestUpdateRow,
  type EditableAdminGuestRow,
} from "../lib/admin-guest-mutation";

class FakeAdminGuestMutationStore implements AdminGuestMutationStore {
  readonly createdGuests: AdminGuestCreateRow[] = [];
  readonly updatedGuests: Array<{
    guest: AdminGuestUpdateRow;
    guestId: string;
    weddingId: string;
  }> = [];

  createError: object | null = null;
  currentGuest: EditableAdminGuestRow | null = {
    id: "guest-1",
    rsvp_managed: false,
    sms_opt_in: false,
    sms_opted_in_at: null,
    sms_opted_out_at: null,
  };
  loadError: object | null = null;
  updateError: object | null = null;
  updateSucceeds = true;

  async createGuest({ guest }: { guest: AdminGuestCreateRow }) {
    this.createdGuests.push(guest);
    return { error: this.createError };
  }

  async loadEditableGuest() {
    return { error: this.loadError, guest: this.currentGuest };
  }

  async updateGuest(input: {
    guest: AdminGuestUpdateRow;
    guestId: string;
    weddingId: string;
  }) {
    this.updatedGuests.push(input);
    return { error: this.updateError, updated: this.updateSucceeds };
  }
}

function fixedNow() {
  return new Date("2026-05-19T08:30:00.000Z");
}

function createGuestForm({
  email = "guest@example.com",
  fullName = "Test Guest",
  notes = "",
  phone = "",
  plusOneAllowed = false,
  smsOptIn = false,
}: {
  email?: string;
  fullName?: string;
  notes?: string;
  phone?: string;
  plusOneAllowed?: boolean;
  smsOptIn?: boolean;
} = {}) {
  const formData = new FormData();
  formData.set("full_name", fullName);
  formData.set("email", email);
  formData.set("phone", phone);
  formData.set("notes", notes);

  if (plusOneAllowed) {
    formData.set("plus_one_allowed", "on");
  }

  if (smsOptIn) {
    formData.set("sms_opt_in", "on");
  }

  return formData;
}

function logger() {
  const calls: unknown[][] = [];
  return {
    calls,
    logger: { error: (...args: unknown[]) => calls.push(args) },
  };
}

test.describe("Admin Guest mutation Module", () => {
  test("creates Invited Guests with trimmed fields and SMS consent timestamps", async () => {
    const store = new FakeAdminGuestMutationStore();

    const result = await createAdminGuestMutation({
      formData: createGuestForm({
        email: "  ada@example.com  ",
        fullName: "  Ada Lovelace  ",
        notes: "  Seating note  ",
        phone: " +46700000001 ",
        plusOneAllowed: true,
        smsOptIn: true,
      }),
      now: fixedNow,
      store,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({ status: "created" });
    expect(store.createdGuests).toEqual([
      {
        email: "ada@example.com",
        full_name: "Ada Lovelace",
        notes: "Seating note",
        phone: "+46700000001",
        plus_one_allowed: true,
        sms_opt_in: true,
        sms_opted_in_at: "2026-05-19T08:30:00.000Z",
        sms_opted_out_at: null,
        wedding_id: "wedding-1",
      },
    ]);
  });

  test("returns validation statuses before touching the store", async () => {
    const store = new FakeAdminGuestMutationStore();

    await expect(
      createAdminGuestMutation({
        formData: createGuestForm({ fullName: "", phone: "+46700000001" }),
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "missing-name" });

    await expect(
      createAdminGuestMutation({
        formData: createGuestForm({ email: "", phone: "" }),
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "missing-contact" });

    await expect(
      createAdminGuestMutation({
        formData: createGuestForm({ email: "", phone: "0700000000", smsOptIn: true }),
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "invalid-sms-phone" });

    expect(store.createdGuests).toEqual([]);
    expect(store.updatedGuests).toEqual([]);
  });

  test("updates Guest fields while preserving SMS consent history", async () => {
    const store = new FakeAdminGuestMutationStore();
    store.currentGuest = {
      id: "guest-1",
      rsvp_managed: false,
      sms_opt_in: true,
      sms_opted_in_at: "2026-05-18T08:00:00.000Z",
      sms_opted_out_at: null,
    };

    const result = await updateAdminGuestMutation({
      formData: createGuestForm({
        email: "updated@example.com",
        fullName: "Updated Guest",
        notes: "updated notes",
        phone: "+46700000002",
        plusOneAllowed: false,
        smsOptIn: false,
      }),
      guestId: "guest-1",
      now: fixedNow,
      store,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({ status: "updated" });
    expect(store.updatedGuests).toEqual([
      {
        guest: {
          email: "updated@example.com",
          full_name: "Updated Guest",
          notes: "updated notes",
          phone: "+46700000002",
          plus_one_allowed: false,
          sms_opt_in: false,
          sms_opted_in_at: "2026-05-18T08:00:00.000Z",
          sms_opted_out_at: "2026-05-19T08:30:00.000Z",
        },
        guestId: "guest-1",
        weddingId: "wedding-1",
      },
    ]);
  });

  test("maps non-editable and missing Guests to server action statuses", async () => {
    const store = new FakeAdminGuestMutationStore();

    store.currentGuest = null;
    await expect(
      updateAdminGuestMutation({
        formData: createGuestForm(),
        guestId: "missing-guest",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "not-found" });
    expect(store.updatedGuests).toEqual([]);

    store.currentGuest = {
      id: "plus-one-1",
      rsvp_managed: true,
      sms_opt_in: false,
      sms_opted_in_at: null,
      sms_opted_out_at: null,
    };
    await expect(
      updateAdminGuestMutation({
        formData: createGuestForm(),
        guestId: "plus-one-1",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "update-failed" });
    expect(store.updatedGuests).toEqual([]);
  });

  test("logs store failures behind the Admin Guest mutation Interface", async () => {
    const store = new FakeAdminGuestMutationStore();
    const error = new Error("insert failed");
    const log = logger();
    store.createError = error;

    await expect(
      createAdminGuestMutation({
        formData: createGuestForm(),
        logger: log.logger,
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "create-failed" });

    expect(log.calls).toEqual([["Failed to create guest", error]]);
  });
});
