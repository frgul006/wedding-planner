"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateAdminWeddingSettings } from "@/lib/wedding-settings";

export async function updateWeddingSettingsAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const result = await updateAdminWeddingSettings({
    formData,
    supabase,
    weddingId: adminProfile.wedding_id,
  });

  if (result.status !== "updated") {
    redirect(`/admin/settings?error=${result.status}`);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=updated");
}
