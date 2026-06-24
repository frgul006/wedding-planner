import { expect, test } from "@playwright/test";

import {
  normalizeAdminGuestRosterSessionChanges,
  saveAdminGuestRosterSession,
  type AdminGuestRosterSessionRpcAdapter,
} from "../lib/admin-guest-roster-session";

function validChange(overrides = {}) {
  return {
    expectedUpdatedAt: "2026-06-24T08:00:00.000Z",
    id: "guest-1",
    rowKey: "guest-1",
    values: {
      email: " ada@example.com ",
      fullName: " Ada Lovelace ",
      notes: " Seating note ",
      phone: " +46701234567 ",
      plusOneAllowed: true,
      smsOptIn: true,
    },
    ...overrides,
  };
}

test.describe("Admin Gästlista samlad redigering", () => {
  test("normalizes trimmed values before RPC save", async () => {
    const calls: unknown[] = [];
    const rpcAdapter: AdminGuestRosterSessionRpcAdapter = {
      async rpc(functionName, args) {
        calls.push({ args, functionName });
        return { data: { saved_count: 1, status: "success" }, error: null };
      },
    };

    await expect(
      saveAdminGuestRosterSession({
        changes: [validChange()],
        rpcAdapter,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({ savedCount: 1, status: "success" });

    expect(calls).toEqual([
      {
        args: {
          p_changes: [
            {
              draft_id: null,
              email: "ada@example.com",
              expected_updated_at: "2026-06-24T08:00:00.000Z",
              full_name: "Ada Lovelace",
              id: "guest-1",
              notes: "Seating note",
              phone: "+46701234567",
              plus_one_allowed: true,
              row_key: "guest-1",
              sms_opt_in: true,
            },
          ],
          p_wedding_id: "wedding-1",
        },
        functionName: "save_admin_guest_roster_session",
      },
    ]);
  });

  test("returns validation errors before RPC", async () => {
    const rpcAdapter: AdminGuestRosterSessionRpcAdapter = {
      async rpc() {
        throw new Error("RPC should not be called");
      },
    };

    const result = await saveAdminGuestRosterSession({
      changes: [
        validChange({
          expectedUpdatedAt: undefined,
          values: {
            email: "",
            fullName: " ",
            notes: "",
            phone: "0701234567",
            plusOneAllowed: false,
            smsOptIn: true,
          },
        }),
      ],
      rpcAdapter,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({
      errors: {
        "guest-1": {
          fullName: "Namn krävs.",
          phone: "SMS kräver telefonnummer i format +46701234567.",
          row: "Raden saknar versionsstämpel. Ladda om sidan.",
        },
      },
      message: "Rätta markerade fält innan du sparar.",
      status: "validation-error",
    });
  });

  test("supports draft Invited Guest rows", () => {
    expect(
      normalizeAdminGuestRosterSessionChanges([
        validChange({
          draftId: "draft-1",
          expectedUpdatedAt: undefined,
          id: undefined,
          rowKey: "draft-1",
        }),
      ]),
    ).toMatchObject({
      errors: {},
      normalized: [
        {
          draft_id: "draft-1",
          expected_updated_at: null,
          id: null,
          row_key: "draft-1",
        },
      ],
    });
  });

  test("maps database validation errors back to row errors", async () => {
    const rpcAdapter: AdminGuestRosterSessionRpcAdapter = {
      async rpc() {
        return {
          data: {
            errors: {
              "guest-1": { row: "Raden ändrades av någon annan. Ladda om." },
            },
            status: "validation-error",
          },
          error: null,
        };
      },
    };

    await expect(
      saveAdminGuestRosterSession({
        changes: [validChange()],
        rpcAdapter,
        weddingId: "wedding-1",
      }),
    ).resolves.toEqual({
      errors: {
        "guest-1": { row: "Raden ändrades av någon annan. Ladda om." },
      },
      message: "Rätta markerade fält innan du sparar.",
      status: "validation-error",
    });
  });
});
