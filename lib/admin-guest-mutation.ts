import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getInviteAccessScopeForGuestKind,
  isGuestKind,
  type InviteAccessScope,
} from "@/lib/guest-access-policy";
import {
  archiveGuestLifecycle,
  type GuestLifecycleRpcAdapter,
} from "@/lib/guest-lifecycle";
import { isE164PhoneNumber } from "@/lib/phone";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type AdminGuestMutationErrorStatus =
  | "create-failed"
  | "invalid-sms-phone"
  | "missing-contact"
  | "missing-name"
  | "not-found"
  | "update-failed";

export type AdminGuestMutationStatus =
  | "created"
  | "updated"
  | AdminGuestMutationErrorStatus;

export type AdminGuestMutationResult = {
  status: AdminGuestMutationStatus;
};

export type AdminGuestMutationPayload = {
  email: string | null;
  full_name: string;
  notes: string | null;
  phone: string | null;
  plus_one_allowed: boolean;
  sms_opt_in: boolean;
};

export type AdminGuestCreateRow = AdminGuestMutationPayload & {
  sms_opted_in_at: string | null;
  sms_opted_out_at: string | null;
  wedding_id: string;
};

export type AdminGuestUpdateRow = AdminGuestMutationPayload & {
  sms_opted_in_at: string | null;
  sms_opted_out_at: string | null;
};

export type EditableAdminGuestRow = {
  id: string;
  rsvp_managed: boolean;
  sms_opt_in: boolean;
  sms_opted_in_at: string | null;
  sms_opted_out_at: string | null;
};

export type AdminGuestInviteLinkGuestRow = {
  guest_kind: unknown;
  id: string;
};

export type AdminGuestInviteLinkGenerator = (input: {
  accessScope: InviteAccessScope;
  guestId: string;
  weddingId: string;
}) => Promise<{ inviteUrl: string }>;

export type GenerateAdminGuestInviteLinkResult =
  | { guestId: string; inviteUrl: string; status: "generated" }
  | { guestId: string; status: "error" | "not-found" | "unavailable" };

export type AdminGuestArchiveMutationStatus =
  | "delete-failed"
  | "deleted"
  | "not-found";

export type AdminGuestArchiveMutationResult = {
  status: AdminGuestArchiveMutationStatus;
};

type AdminGuestMutationStoreError = object;

export type AdminGuestMutationStore = {
  createGuest(input: {
    guest: AdminGuestCreateRow;
  }): Promise<{ error: AdminGuestMutationStoreError | null }>;
  loadEditableGuest(input: {
    guestId: string;
    weddingId: string;
  }): Promise<{
    error: AdminGuestMutationStoreError | null;
    guest: EditableAdminGuestRow | null;
  }>;
  loadInviteLinkGuest(input: {
    guestId: string;
    weddingId: string;
  }): Promise<{
    error: AdminGuestMutationStoreError | null;
    guest: AdminGuestInviteLinkGuestRow | null;
  }>;
  updateGuest(input: {
    guest: AdminGuestUpdateRow;
    guestId: string;
    weddingId: string;
  }): Promise<{ error: AdminGuestMutationStoreError | null; updated: boolean }>;
};

type AdminGuestMutationLogger = {
  error: (...args: unknown[]) => void;
};

type AdminGuestPayloadParseResult =
  | { payload: AdminGuestMutationPayload; status: "ok" }
  | { status: Extract<AdminGuestMutationErrorStatus, "invalid-sms-phone" | "missing-contact" | "missing-name"> };

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso(now: () => Date) {
  return now().toISOString();
}

function isEditableAdminGuestRow(value: unknown): value is EditableAdminGuestRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.rsvp_managed === "boolean" &&
    typeof value.sms_opt_in === "boolean" &&
    isNullableString(value.sms_opted_in_at) &&
    isNullableString(value.sms_opted_out_at)
  );
}

function isAdminGuestInviteLinkGuestRow(
  value: unknown,
): value is AdminGuestInviteLinkGuestRow {
  return isRecord(value) && typeof value.id === "string" && "guest_kind" in value;
}

export function parseAdminGuestMutationPayload(
  formData: FormData,
): AdminGuestPayloadParseResult {
  const fullName = cleanRequiredText(formData.get("full_name"));
  const email = cleanOptionalText(formData.get("email"));
  const phone = cleanOptionalText(formData.get("phone"));
  const notes = cleanOptionalText(formData.get("notes"));
  const smsOptIn = formData.get("sms_opt_in") === "on";
  const plusOneAllowed = formData.get("plus_one_allowed") === "on";

  if (!fullName) {
    return { status: "missing-name" };
  }

  if (!email && !phone) {
    return { status: "missing-contact" };
  }

  if (smsOptIn && (!phone || !isE164PhoneNumber(phone))) {
    return { status: "invalid-sms-phone" };
  }

  return {
    payload: {
      email,
      full_name: fullName,
      notes,
      phone,
      plus_one_allowed: plusOneAllowed,
      sms_opt_in: smsOptIn,
    },
    status: "ok",
  };
}

export function createSupabaseAdminGuestMutationStore(
  supabase: SupabaseClient,
): AdminGuestMutationStore {
  return {
    async createGuest({ guest }) {
      const { error } = await supabase.from("guests").insert(guest);
      return { error };
    },
    async loadEditableGuest({ guestId, weddingId }) {
      const { data, error } = await supabase
        .from("guests")
        .select("id, rsvp_managed, sms_opt_in, sms_opted_in_at, sms_opted_out_at")
        .eq("id", guestId)
        .eq("wedding_id", weddingId)
        .is("deleted_at", null)
        .maybeSingle();

      return {
        error,
        guest: isEditableAdminGuestRow(data) ? data : null,
      };
    },
    async loadInviteLinkGuest({ guestId, weddingId }) {
      const { data, error } = await supabase
        .from("guests")
        .select("guest_kind, id")
        .eq("id", guestId)
        .eq("wedding_id", weddingId)
        .is("deleted_at", null)
        .maybeSingle();

      return {
        error,
        guest: isAdminGuestInviteLinkGuestRow(data) ? data : null,
      };
    },
    async updateGuest({ guest, guestId, weddingId }) {
      const { data, error } = await supabase
        .from("guests")
        .update(guest)
        .eq("id", guestId)
        .eq("wedding_id", weddingId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();

      return { error, updated: Boolean(data) };
    },
  };
}

export async function createAdminGuestMutation({
  formData,
  logger = console,
  now = () => new Date(),
  store,
  weddingId,
}: {
  formData: FormData;
  logger?: AdminGuestMutationLogger;
  now?: () => Date;
  store: AdminGuestMutationStore;
  weddingId: string;
}): Promise<AdminGuestMutationResult> {
  const parsed = parseAdminGuestMutationPayload(formData);

  if (parsed.status !== "ok") {
    return { status: parsed.status };
  }

  const { error } = await store.createGuest({
    guest: {
      ...parsed.payload,
      sms_opted_in_at: parsed.payload.sms_opt_in ? nowIso(now) : null,
      sms_opted_out_at: null,
      wedding_id: weddingId,
    },
  });

  if (error) {
    logger.error("Failed to create guest", error);
    return { status: "create-failed" };
  }

  return { status: "created" };
}

export async function updateAdminGuestMutation({
  formData,
  guestId,
  logger = console,
  now = () => new Date(),
  store,
  weddingId,
}: {
  formData: FormData;
  guestId: string;
  logger?: AdminGuestMutationLogger;
  now?: () => Date;
  store: AdminGuestMutationStore;
  weddingId: string;
}): Promise<AdminGuestMutationResult> {
  const currentGuest = await store.loadEditableGuest({ guestId, weddingId });

  if (currentGuest.error) {
    logger.error("Failed to load guest before update", currentGuest.error);
    return { status: "update-failed" };
  }

  if (!currentGuest.guest) {
    return { status: "not-found" };
  }

  if (currentGuest.guest.rsvp_managed) {
    return { status: "update-failed" };
  }

  const parsed = parseAdminGuestMutationPayload(formData);

  if (parsed.status !== "ok") {
    return { status: parsed.status };
  }

  const changedAt = nowIso(now);
  const smsOptedInAt = parsed.payload.sms_opt_in
    ? currentGuest.guest.sms_opted_in_at ?? changedAt
    : currentGuest.guest.sms_opted_in_at;
  const smsOptedOutAt = parsed.payload.sms_opt_in
    ? null
    : currentGuest.guest.sms_opt_in
      ? changedAt
      : currentGuest.guest.sms_opted_out_at;

  const { error, updated } = await store.updateGuest({
    guest: {
      ...parsed.payload,
      sms_opted_in_at: smsOptedInAt,
      sms_opted_out_at: smsOptedOutAt,
    },
    guestId,
    weddingId,
  });

  if (error) {
    logger.error("Failed to update guest", error);
    return { status: "update-failed" };
  }

  if (!updated) {
    return { status: "not-found" };
  }

  return { status: "updated" };
}

export async function generateAdminGuestInviteLinkMutation({
  generateInviteLink,
  guestId,
  logger = console,
  store,
  weddingId,
}: {
  generateInviteLink: AdminGuestInviteLinkGenerator;
  guestId: string;
  logger?: AdminGuestMutationLogger;
  store: AdminGuestMutationStore;
  weddingId: string;
}): Promise<GenerateAdminGuestInviteLinkResult> {
  const currentGuest = await store.loadInviteLinkGuest({ guestId, weddingId });

  if (currentGuest.error) {
    logger.error(
      "Failed to verify guest before invite token generation",
      currentGuest.error,
    );
    return { guestId, status: "error" };
  }

  if (!currentGuest.guest) {
    return { guestId, status: "not-found" };
  }

  const guestKind = currentGuest.guest.guest_kind;

  if (!isGuestKind(guestKind)) {
    return { guestId, status: "unavailable" };
  }

  try {
    const accessScope = getInviteAccessScopeForGuestKind(guestKind);
    const { inviteUrl } = await generateInviteLink({
      accessScope,
      guestId,
      weddingId,
    });

    return { guestId, inviteUrl, status: "generated" };
  } catch (error) {
    logger.error("Failed to generate invite token", error);
    return { guestId, status: "error" };
  }
}

export async function archiveAdminGuestMutation({
  guestId,
  logger = console,
  rpcAdapter,
  weddingId,
}: {
  guestId: string;
  logger?: AdminGuestMutationLogger;
  rpcAdapter: GuestLifecycleRpcAdapter;
  weddingId: string;
}): Promise<AdminGuestArchiveMutationResult> {
  const result = await archiveGuestLifecycle({
    guestId,
    logger,
    rpcAdapter,
    weddingId,
  });

  if (result.status === "archived") {
    return { status: "deleted" };
  }

  if (result.status === "not_found") {
    return { status: "not-found" };
  }

  return { status: "delete-failed" };
}
