"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  archiveAdminGuestMutation,
  createAdminGuestMutation,
  createSupabaseAdminGuestMutationStore,
  generateAdminGuestInviteLinkMutation,
  updateAdminGuestMutation,
} from "@/lib/admin-guest-mutation";
import { loadAdminGuestRoster } from "@/lib/admin-guest-roster";
import {
  saveAdminGuestRosterSession,
  type AdminGuestRosterSessionChange,
  type AdminGuestRosterSessionErrors,
} from "@/lib/admin-guest-roster-session";
import { regenerateInviteToken } from "@/lib/invite-tokens";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecord } from "@/lib/type-guards";

export type GenerateInviteLinkState = {
  error?: string;
  guestId?: string;
  inviteUrl?: string;
};

export type SaveGuestRosterSessionActionResult = Awaited<
  ReturnType<typeof saveAdminGuestRosterSession>
> & {
  rows?: Awaited<ReturnType<typeof loadAdminGuestRoster>>["rows"];
};

export type ArchiveSelectedGuestsActionResult =
  | {
      archivedCount: number;
      revokedScopedTokenCount: number;
      status: "success";
    }
  | {
      errors: AdminGuestRosterSessionErrors;
      message: string;
      status: "validation-error";
    }
  | { message: string; status: "error" };

function redirectToGuestMutationResult(result: { status: string }): never {
  if (result.status === "created" || result.status === "updated") {
    redirect(`/admin/guests?status=${result.status}`);
  }

  redirect(`/admin/guests?error=${result.status}`);
}

function isArchiveRpcSuccess(value: unknown): value is {
  archived_count: number;
  revoked_scoped_token_count: number;
  status: "success";
} {
  return (
    isRecord(value) &&
    value.status === "success" &&
    typeof value.archived_count === "number" &&
    typeof value.revoked_scoped_token_count === "number"
  );
}

function isArchiveRpcValidationError(value: unknown): value is {
  errors: AdminGuestRosterSessionErrors;
  message?: string;
  status: "validation-error";
} {
  return (
    isRecord(value) &&
    value.status === "validation-error" &&
    isRecord(value.errors)
  );
}

function coerceArchiveErrors(value: unknown): AdminGuestRosterSessionErrors {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([rowKey, rowErrors]) => {
      if (!isRecord(rowErrors) || typeof rowErrors.row !== "string") {
        return [];
      }

      return [[rowKey, { row: rowErrors.row }]];
    }),
  );
}

export async function createGuestAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await createAdminGuestMutation({
    formData,
    store: createSupabaseAdminGuestMutationStore(supabase),
    weddingId: adminProfile.wedding_id,
  });

  if (result.status !== "created") {
    redirectToGuestMutationResult(result);
  }

  revalidatePath("/admin/guests");
  redirectToGuestMutationResult(result);
}

export async function updateGuestAction(guestId: string, formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await updateAdminGuestMutation({
    formData,
    guestId,
    store: createSupabaseAdminGuestMutationStore(supabase),
    weddingId: adminProfile.wedding_id,
  });

  if (result.status !== "updated") {
    redirectToGuestMutationResult(result);
  }

  revalidatePath("/admin/guests");
  redirectToGuestMutationResult(result);
}

export async function saveGuestRosterSessionAction(
  changes: AdminGuestRosterSessionChange[],
): Promise<SaveGuestRosterSessionActionResult> {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await saveAdminGuestRosterSession({
    changes,
    rpcAdapter: supabase,
    weddingId: adminProfile.wedding_id,
  });

  if (result.status !== "success") {
    return result;
  }

  revalidatePath("/admin/guests");
  const roster = await loadAdminGuestRoster({
    filters: { query: "", sort: "name", status: "" },
    supabase,
    weddingId: adminProfile.wedding_id,
  });

  return { ...result, rows: roster.rows };
}

export async function archiveSelectedGuestsAction(
  guestIds: string[],
): Promise<ArchiveSelectedGuestsActionResult> {
  if (guestIds.length === 0) {
    return {
      archivedCount: 0,
      revokedScopedTokenCount: 0,
      status: "success",
    };
  }

  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("archive_admin_guests_lifecycle", {
    p_guest_ids: guestIds,
    p_wedding_id: adminProfile.wedding_id,
  });

  if (error) {
    console.error("Failed archive selected Guests", error);
    return { message: "Kunde inte arkivera markerade Gäster.", status: "error" };
  }

  if (isArchiveRpcSuccess(data)) {
    revalidatePath("/admin/guests");
    return {
      archivedCount: data.archived_count,
      revokedScopedTokenCount: data.revoked_scoped_token_count,
      status: "success",
    };
  }

  if (isArchiveRpcValidationError(data)) {
    return {
      errors: coerceArchiveErrors(data.errors),
      message: data.message ?? "Ingen Gäst arkiverades.",
      status: "validation-error",
    };
  }

  console.error("Unexpected archive selected Guests result", data);
  return { message: "Kunde inte tolka svaret från databasen.", status: "error" };
}

export async function generateInviteLinkAction(
  guestId: string,
  previousState: GenerateInviteLinkState,
): Promise<GenerateInviteLinkState> {
  void previousState;

  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const result = await generateAdminGuestInviteLinkMutation({
    generateInviteLink: ({ accessScope, guestId: inviteGuestId, weddingId }) =>
      regenerateInviteToken({
        accessScope,
        guestId: inviteGuestId,
        requestOrigin,
        supabase,
        weddingId,
      }),
    guestId,
    store: createSupabaseAdminGuestMutationStore(supabase),
    weddingId: adminProfile.wedding_id,
  });

  if (result.status === "generated") {
    revalidatePath("/admin/guests");
    return { guestId, inviteUrl: result.inviteUrl };
  }

  if (result.status === "not-found") {
    return { guestId, error: "Guest was not found or already archived." };
  }

  if (result.status === "unavailable") {
    return { guestId, error: "Invite links are only available for Guests." };
  }

  return { guestId, error: "Could not generate invite link." };
}

export async function softDeleteGuestAction(guestId: string) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await archiveAdminGuestMutation({
    guestId,
    rpcAdapter: supabase,
    weddingId: adminProfile.wedding_id,
  });

  if (result.status !== "deleted") {
    redirect(`/admin/guests?error=${result.status}`);
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=deleted");
}
