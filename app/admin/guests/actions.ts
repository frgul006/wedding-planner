"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getGuestPayload(formData: FormData) {
  const fullName = cleanRequiredText(formData.get("full_name"));
  const email = cleanOptionalText(formData.get("email"));
  const phone = cleanOptionalText(formData.get("phone"));
  const notes = cleanOptionalText(formData.get("notes"));

  if (!fullName) {
    redirect("/admin/guests?error=missing-name");
  }

  if (!email && !phone) {
    redirect("/admin/guests?error=missing-contact");
  }

  return {
    full_name: fullName,
    email,
    phone,
    notes,
  };
}

export async function createGuestAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const payload = getGuestPayload(formData);

  const { error } = await supabase.from("guests").insert({
    ...payload,
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
  await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const payload = getGuestPayload(formData);

  const { error } = await supabase
    .from("guests")
    .update(payload)
    .eq("id", guestId)
    .is("deleted_at", null);

  if (error) {
    console.error("Failed to update guest", error);
    redirect("/admin/guests?error=update-failed");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=updated");
}

export async function softDeleteGuestAction(guestId: string) {
  await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("guests")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", guestId)
    .is("deleted_at", null);

  if (error) {
    console.error("Failed to delete guest", error);
    redirect("/admin/guests?error=delete-failed");
  }

  revalidatePath("/admin/guests");
  redirect("/admin/guests?status=deleted");
}
