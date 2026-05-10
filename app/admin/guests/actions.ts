"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { regenerateInviteToken } from "@/lib/invite-tokens";
import { isE164PhoneNumber } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export type GenerateInviteLinkState = {
  error?: string;
  guestId?: string;
  inviteUrl?: string;
};

function getGuestPayload(formData: FormData) {
  const fullName = cleanRequiredText(formData.get("full_name"));
  const email = cleanOptionalText(formData.get("email"));
  const phone = cleanOptionalText(formData.get("phone"));
  const notes = cleanOptionalText(formData.get("notes"));
  const smsOptIn = formData.get("sms_opt_in") === "on";

  if (!fullName) {
    redirect("/admin/guests?error=missing-name");
  }

  if (!email && !phone) {
    redirect("/admin/guests?error=missing-contact");
  }

  if (smsOptIn && (!phone || !isE164PhoneNumber(phone))) {
    redirect("/admin/guests?error=invalid-sms-phone");
  }

  return {
    full_name: fullName,
    email,
    notes,
    phone,
    sms_opt_in: smsOptIn,
  };
}

export async function createGuestAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const payload = getGuestPayload(formData);
  const now = new Date().toISOString();

  const { error } = await supabase.from("guests").insert({
    ...payload,
    sms_opted_in_at: payload.sms_opt_in ? now : null,
    sms_opted_out_at: null,
    wedding_id: adminProfile.wedding_id,
  });

  if (error) {
    console.error("Failed to create guest", error);
    redirect("/admin/guests?error=create-failed");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=created");
}

export async function updateGuestAction(guestId: string, formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const payload = getGuestPayload(formData);
  const { data: currentGuest, error: currentGuestError } = await supabase
    .from("guests")
    .select("id, sms_opt_in, sms_opted_in_at, sms_opted_out_at")
    .eq("id", guestId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (currentGuestError) {
    console.error("Failed to load guest before update", currentGuestError);
    redirect("/admin/guests?error=update-failed");
  }

  if (!currentGuest) {
    redirect("/admin/guests?error=not-found");
  }

  const now = new Date().toISOString();
  const smsOptedInAt = payload.sms_opt_in
    ? currentGuest.sms_opted_in_at ?? now
    : currentGuest.sms_opted_in_at;
  const smsOptedOutAt = payload.sms_opt_in
    ? null
    : currentGuest.sms_opt_in
      ? now
      : currentGuest.sms_opted_out_at;

  const { data, error } = await supabase
    .from("guests")
    .update({
      ...payload,
      sms_opted_in_at: smsOptedInAt,
      sms_opted_out_at: smsOptedOutAt,
    })
    .eq("id", guestId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to update guest", error);
    redirect("/admin/guests?error=update-failed");
  }

  if (!data) {
    redirect("/admin/guests?error=not-found");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=updated");
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
    .select("id")
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

  try {
    const { inviteUrl } = await regenerateInviteToken({
      guestId,
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

  const { data, error } = await supabase
    .from("guests")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", guestId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to delete guest", error);
    redirect("/admin/guests?error=delete-failed");
  }

  if (!data) {
    redirect("/admin/guests?error=not-found");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=deleted");
}
