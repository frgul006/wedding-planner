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
import { regenerateInviteToken } from "@/lib/invite-tokens";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GenerateInviteLinkState = {
  error?: string;
  guestId?: string;
  inviteUrl?: string;
};

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
  const store = createSupabaseAdminGuestMutationStore(supabase);
  const result = await generateAdminGuestInviteLinkMutation({
    generateInviteLink: async ({
      accessScope,
      guestId: inviteGuestId,
      weddingId,
    }) => {
      const requestOrigin = getRequestOriginFromHeaders(await headers());
      return regenerateInviteToken({
        accessScope,
        guestId: inviteGuestId,
        requestOrigin,
        supabase,
        weddingId,
      });
    },
    guestId,
    store,
    weddingId: adminProfile.wedding_id,
  });

  if (result.status === "generated") {
    revalidatePath("/admin/guests");
    return { guestId, inviteUrl: result.inviteUrl };
  }

  if (result.status === "not-found") {
    return { guestId, error: "Guest was not found or is already archived." };
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
