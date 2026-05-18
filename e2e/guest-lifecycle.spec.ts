import { expect, test } from "@playwright/test";

import {
  archiveGuestLifecycle,
  type ArchiveGuestLifecycleRpcArgs,
  type GuestLifecycleRpcAdapter,
} from "../lib/guest-lifecycle";

type RpcError = {
  code?: string;
  message?: string;
};

function createRpcAdapter({
  error = null,
  onRpc,
}: {
  error?: RpcError | null;
  onRpc?: (
    functionName: "archive_guest_lifecycle",
    args: ArchiveGuestLifecycleRpcArgs,
  ) => void;
} = {}) {
  let callCount = 0;
  const adapter: GuestLifecycleRpcAdapter = {
    async rpc(functionName, args) {
      callCount += 1;
      onRpc?.(functionName, args);

      return { error };
    },
  };

  return {
    adapter,
    getCallCount: () => callCount,
  };
}

test.describe("Guest lifecycle Module", () => {
  test("archives through the archive_guest_lifecycle RPC", async () => {
    let rpcFunctionName: "archive_guest_lifecycle" | null = null;
    let rpcArgs: ArchiveGuestLifecycleRpcArgs | null = null;
    const rpc = createRpcAdapter({
      onRpc(functionName, args) {
        rpcFunctionName = functionName;
        rpcArgs = args;
      },
    });

    const result = await archiveGuestLifecycle({
      guestId: "guest-1",
      logger: { error: () => undefined },
      rpcAdapter: rpc.adapter,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({ status: "archived" });
    expect(rpc.getCallCount()).toBe(1);
    expect(rpcFunctionName).toBe("archive_guest_lifecycle");
    expect(rpcArgs).toEqual({
      p_guest_id: "guest-1",
      p_wedding_id: "wedding-1",
    });
  });

  test("maps missing Guests to not_found", async () => {
    const errorCalls: unknown[][] = [];
    const rpc = createRpcAdapter({
      error: { code: "P0002", message: "Guest not found or already archived" },
    });

    const result = await archiveGuestLifecycle({
      guestId: "missing-guest",
      logger: { error: (...args) => errorCalls.push(args) },
      rpcAdapter: rpc.adapter,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({ status: "not_found" });
    expect(errorCalls).toHaveLength(0);
  });

  test("returns generic archive errors for the server action Adapter", async () => {
    const rpcError = { code: "23514", message: "constraint failed" };
    const errorCalls: unknown[][] = [];
    const rpc = createRpcAdapter({ error: rpcError });

    const result = await archiveGuestLifecycle({
      guestId: "guest-1",
      logger: { error: (...args) => errorCalls.push(args) },
      rpcAdapter: rpc.adapter,
      weddingId: "wedding-1",
    });

    expect(result).toEqual({ error: rpcError, status: "error" });
    expect(errorCalls).toEqual([["Failed to archive Guest lifecycle", rpcError]]);
  });
});
