"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  createAdminGuestMutation,
  createSupabaseAdminGuestMutationStore,
  updateAdminGuestMutation,
} from "@/lib/admin-guest-mutation";
import { archiveGuestLifecycle } from "@/lib/guest-lifecycle";
import type { InviteAccessScope } from "@/lib/invite-access";
import { regenerateInviteToken } from "@/lib/invite-tokens";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GenerateInviteLinkState = {
  error?: string;
  guestId?: string;
  inviteUrl?: string;
};

function getInviteAccessScopeForGuestKind(guestKind: string): InviteAccessScope | null {
  if (guestKind === "invited") {
    return "full";
  }

  if (guestKind === "plus_one") {
    return "scoped";
  }

  return null;
}

function redirectToGuestMutationResult(result: { status: string }): never {
  if (result.status === "created" || result.status === "updated") {
    redirect(`/admin/guests?status=${result.status}`);
  }

  redirect(`/admin/guests?error=${result.status}`);
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

export async function generateInviteLinkAction(
  guestId: string,
  previousState: GenerateInviteLinkState,
): Promise<GenerateInviteLinkState> {
  void previousState;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();

  const { data: guest, error: guestError } = await supabase
    .from("guests")
    .select("guest_kind, id")
    .eq("id", guestId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (guestError) {
    console.error("Failed to verify guest before invite token generation", guestError);
    return { guestId, error: "Could not generate invite link." };
  }

  if (!guest) {
    return { guestId, error: "Guest was not found or is already archived." };
  }

  const accessScope = getInviteAccessScopeForGuestKind(guest.guest_kind);

  if (!accessScope) {
    return { guestId, error: "Invite links are only available for Guests." };
  }

  try {
    const requestOrigin = getRequestOriginFromHeaders(await headers());
    const { inviteUrl } = await regenerateInviteToken({
      accessScope,
      guestId,
      requestOrigin,
      supabase,
      weddingId: adminProfile.wedding_id,
    });

    revalidatePath("/admin/guests");
    return { guestId, inviteUrl };
  } catch (error) {
    console.error("Failed to generate invite token", error);
    return { guestId, error: "Could not generate invite link." };
  }
}

export async function softDeleteGuestAction(guestId: string) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await archiveGuestLifecycle({
    guestId,
    rpcAdapter: supabase,
    weddingId: adminProfile.wedding_id,
  });

  if (result.status === "not_found") {
    redirect("/admin/guests?error=not-found");
  }

  if (result.status === "error") {
    redirect("/admin/guests?error=delete-failed");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=deleted");
}
