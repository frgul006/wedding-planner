export type ArchiveGuestLifecycleRpcArgs = {
  p_guest_id: string;
  p_wedding_id: string;
};

type GuestLifecycleDatabaseError = {
  code?: string;
  message?: string;
};

export type GuestLifecycleRpcAdapter = {
  rpc(
    functionName: "archive_guest_lifecycle",
    args: ArchiveGuestLifecycleRpcArgs,
  ): PromiseLike<{ error: GuestLifecycleDatabaseError | null }>;
};

export type ArchiveGuestLifecycleResult =
  | { status: "archived" }
  | { status: "not_found" }
  | { error: GuestLifecycleDatabaseError; status: "error" };

type GuestLifecycleLogger = {
  error: (...args: unknown[]) => void;
};

type ArchiveGuestLifecycleInput = {
  guestId: string;
  logger?: GuestLifecycleLogger;
  rpcAdapter: GuestLifecycleRpcAdapter;
  weddingId: string;
};

function isNotFoundArchiveError(error: GuestLifecycleDatabaseError) {
  return error.code === "P0002";
}

export async function archiveGuestLifecycle({
  guestId,
  logger = console,
  rpcAdapter,
  weddingId,
}: ArchiveGuestLifecycleInput): Promise<ArchiveGuestLifecycleResult> {
  const { error } = await rpcAdapter.rpc("archive_guest_lifecycle", {
    p_guest_id: guestId,
    p_wedding_id: weddingId,
  });

  if (!error) {
    return { status: "archived" };
  }

  if (isNotFoundArchiveError(error)) {
    return { status: "not_found" };
  }

  logger.error("Failed to archive Guest lifecycle", error);
  return { error, status: "error" };
}
