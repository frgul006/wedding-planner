"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTimePlanText } from "@/lib/time-plan";

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseWeddingDate(value: FormDataEntryValue | null) {
  const rawValue = cleanOptionalText(value);

  if (!rawValue) {
    return null;
  }

  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    redirect("/admin/settings?error=invalid-date");
  }

  return date.toISOString();
}

export async function updateWeddingSettingsAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const name = cleanRequiredText(formData.get("name"));

  if (!name) {
    redirect("/admin/settings?error=missing-name");
  }

  const { data, error } = await supabase
    .from("weddings")
    .update({
      name,
      partner_one_name: cleanOptionalText(formData.get("partner_one_name")),
      partner_two_name: cleanOptionalText(formData.get("partner_two_name")),
      wedding_date: parseWeddingDate(formData.get("wedding_date")),
      venue_name: cleanOptionalText(formData.get("venue_name")),
      venue_address: cleanOptionalText(formData.get("venue_address")),
      venue_area: cleanOptionalText(formData.get("venue_area")),
      google_maps_url: cleanOptionalText(formData.get("google_maps_url")),
      time_plan: parseTimePlanText(formData.get("time_plan")),
      policy: cleanOptionalText(formData.get("policy")),
      dress_code: cleanOptionalText(formData.get("dress_code")),
      child_policy: cleanOptionalText(formData.get("child_policy")),
      gift_info: cleanOptionalText(formData.get("gift_info")),
      spotify_playlist_url: cleanOptionalText(formData.get("spotify_playlist_url")),
      invite_support_email: cleanOptionalText(formData.get("invite_support_email")),
      allow_anonymous_hub_upload: formData.get("allow_anonymous_hub_upload") === "on",
      photo_upload_requires_review: formData.get("photo_upload_requires_review") === "on",
    })
    .eq("id", adminProfile.wedding_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to update wedding settings", error);
    redirect("/admin/settings?error=update-failed");
  }

  if (!data) {
    redirect("/admin/settings?error=not-found");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=updated");
}
