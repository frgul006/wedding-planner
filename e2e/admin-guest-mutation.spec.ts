import { expect, test } from "@playwright/test";

import {
  archiveAdminGuestMutation,
  createAdminGuestMutation,
  generateAdminGuestInviteLinkMutation,
  updateAdminGuestMutation,
  type AdminGuestCreateRow,
  type AdminGuestInviteLinkGenerator,
  type AdminGuestInviteLinkGuestRow,
  type AdminGuestMutationStore,
  type AdminGuestUpdateRow,
  type EditableAdminGuestRow,
} from "../lib/admin-guest-mutation";
import {
  getInviteAccessScopeForGuestKind,
  isValidInviteAccessScopeForGuestKind,
} from "../lib/guest-access-policy";
import type { GuestLifecycleRpcAdapter } from "../lib/guest-lifecycle";

class FakeAdminGuestMutationStore implements AdminGuestMutationStore {
  readonly createdGuests: AdminGuestCreateRow[] = [];
  readonly updatedGuests: Array<{
    guest: AdminGuestUpdateRow;
    guestId: string;
    weddingId: string;
  }> = [];
  readonly loadedInviteLinkGuests: Array<{
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
  currentInviteLinkGuest: AdminGuestInviteLinkGuestRow | null = {
    guest_kind: "invited",
    id: "guest-1",
  };
  inviteLinkLoadError: object | null = null;
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

  async loadInviteLinkGuest(input: { guestId: string; weddingId: string }) {
    this.loadedInviteLinkGuests.push(input);
    return {
      error: this.inviteLinkLoadError,
      guest: this.currentInviteLinkGuest,
    };
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

function inviteLinkGenerator() {
  const calls: Parameters<AdminGuestInviteLinkGenerator>[0][] = [];
  const generateInviteLink: AdminGuestInviteLinkGenerator = async (input) => {
    calls.push(input);
    return { inviteUrl: `https://example.test/invite/${input.accessScope}` };
  };

  return { calls, generateInviteLink };
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

  test("maps Guest kind to Invite access scope in one policy Module", () => {
    expect(getInviteAccessScopeForGuestKind("invited")).toBe("full");
    expect(getInviteAccessScopeForGuestKind("plus_one")).toBe("scoped");
    expect(
      isValidInviteAccessScopeForGuestKind({
        accessScope: "full",
        guestKind: "invited",
      }),
    ).toBe(true);
    expect(
      isValidInviteAccessScopeForGuestKind({
        accessScope: "scoped",
        guestKind: "invited",
      }),
    ).toBe(false);
  });

  test("generates Invite links with Guest-kind scoped access", async () => {
    const store = new FakeAdminGuestMutationStore();
    const invitedGenerator = inviteLinkGenerator();

    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: invitedGenerator.generateInviteLink,
        guestId: "guest-1",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({
      guestId: "guest-1",
      inviteUrl: "https://example.test/invite/full",
      status: "generated",
    });
    expect(invitedGenerator.calls).toEqual([
      {
        accessScope: "full",
        guestId: "guest-1",
        weddingId: "wedding-1",
      },
    ]);

    store.currentInviteLinkGuest = { guest_kind: "plus_one", id: "plus-one-1" };
    const plusOneGenerator = inviteLinkGenerator();
    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: plusOneGenerator.generateInviteLink,
        guestId: "plus-one-1",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({
      guestId: "plus-one-1",
      inviteUrl: "https://example.test/invite/scoped",
      status: "generated",
    });
    expect(plusOneGenerator.calls).toEqual([
      {
        accessScope: "scoped",
        guestId: "plus-one-1",
        weddingId: "wedding-1",
      },
    ]);
    expect(store.loadedInviteLinkGuests).toEqual([
      { guestId: "guest-1", weddingId: "wedding-1" },
      { guestId: "plus-one-1", weddingId: "wedding-1" },
    ]);
  });

  test("keeps Invite link generation failures behind the mutation Interface", async () => {
    const store = new FakeAdminGuestMutationStore();
    const generator = inviteLinkGenerator();

    store.currentInviteLinkGuest = null;
    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: generator.generateInviteLink,
        guestId: "missing-guest",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ guestId: "missing-guest", status: "not-found" });
    expect(generator.calls).toEqual([]);

    store.currentInviteLinkGuest = { guest_kind: null, id: "legacy-guest" };
    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: generator.generateInviteLink,
        guestId: "legacy-guest",
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ guestId: "legacy-guest", status: "unavailable" });
    expect(generator.calls).toEqual([]);

    const loadError = new Error("read failed");
    const log = logger();
    store.inviteLinkLoadError = loadError;
    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: generator.generateInviteLink,
        guestId: "guest-1",
        logger: log.logger,
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ guestId: "guest-1", status: "error" });
    expect(log.calls).toEqual([
      ["Failed to verify guest before invite token generation", loadError],
    ]);

    const tokenError = new Error("token failed");
    const tokenLog = logger();
    store.inviteLinkLoadError = null;
    store.currentInviteLinkGuest = { guest_kind: "invited", id: "guest-1" };
    await expect(
      generateAdminGuestInviteLinkMutation({
        generateInviteLink: async () => {
          throw tokenError;
        },
        guestId: "guest-1",
        logger: tokenLog.logger,
        store,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ guestId: "guest-1", status: "error" });
    expect(tokenLog.calls).toEqual([
      ["Failed to generate invite token", tokenError],
    ]);
  });

  test("maps Guest lifecycle archive results to Admin Guest mutation statuses", async () => {
    const calls: Array<{
      args: { p_guest_id: string; p_wedding_id: string };
      functionName: "archive_guest_lifecycle";
    }> = [];
    let rpcError: { code?: string; message?: string } | null = null;
    const rpcAdapter: GuestLifecycleRpcAdapter = {
      async rpc(functionName, args) {
        calls.push({ args, functionName });
        return { error: rpcError };
      },
    };

    await expect(
      archiveAdminGuestMutation({
        guestId: "guest-1",
        rpcAdapter,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "deleted" });

    rpcError = { code: "P0002", message: "Guest not found" };
    await expect(
      archiveAdminGuestMutation({
        guestId: "missing-guest",
        rpcAdapter,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "not-found" });

    const log = logger();
    rpcError = { code: "XX000", message: "boom" };
    await expect(
      archiveAdminGuestMutation({
        guestId: "guest-1",
        logger: log.logger,
        rpcAdapter,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ status: "delete-failed" });
    expect(log.calls).toEqual([
      ["Failed to archive Guest lifecycle", rpcError],
    ]);
    expect(calls).toContainEqual({
      args: { p_guest_id: "guest-1", p_wedding_id: "wedding-1" },
      functionName: "archive_guest_lifecycle",
    });
  });
});
