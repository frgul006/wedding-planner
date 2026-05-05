"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { parseOptionalHttpUrl } from "@/lib/safe-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isWeddingUpdateStatus } from "@/lib/wedding-update-status";

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatus(value: FormDataEntryValue | null) {
  if (!isWeddingUpdateStatus(value)) {
    return null;
  }

  return value;
}

function revalidateUpdatePaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/updates");
  revalidatePath("/invite/[token]", "page");
}

export async function createWeddingUpdateAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const title = cleanRequiredText(formData.get("title"));
  const message = cleanRequiredText(formData.get("message"));
  const status = parseStatus(formData.get("status"));
  const link = parseOptionalHttpUrl(formData.get("link_url"));

  if (!title) {
    redirect("/admin/updates?error=missing-title");
  }

  if (!message) {
    redirect("/admin/updates?error=missing-message");
  }

  if (!status) {
    redirect("/admin/updates?error=invalid-status");
  }

  if (!link.isValid) {
    redirect("/admin/updates?error=invalid-link");
  }

  const { data, error } = await supabase
    .from("wedding_updates")
    .insert({
      wedding_id: adminProfile.wedding_id,
      title,
      message,
      link_url: link.url,
      status,
      created_by_admin_id: adminProfile.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to create wedding update", error);
    redirect("/admin/updates?error=create-failed");
  }

  if (!data) {
    redirect("/admin/updates?error=create-failed");
  }

  revalidateUpdatePaths();
  redirect("/admin/updates?status=created");
}

export async function updateWeddingUpdateAction(
  weddingUpdateId: string,
  formData: FormData,
) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const title = cleanRequiredText(formData.get("title"));
  const message = cleanRequiredText(formData.get("message"));
  const status = parseStatus(formData.get("status"));
  const link = parseOptionalHttpUrl(formData.get("link_url"));

  if (!title) {
    redirect("/admin/updates?error=missing-title");
  }

  if (!message) {
    redirect("/admin/updates?error=missing-message");
  }

  if (!status) {
    redirect("/admin/updates?error=invalid-status");
  }

  if (!link.isValid) {
    redirect("/admin/updates?error=invalid-link");
  }

  const { data, error } = await supabase
    .from("wedding_updates")
    .update({
      title,
      message,
      link_url: link.url,
      status,
    })
    .eq("id", weddingUpdateId)
    .eq("wedding_id", adminProfile.wedding_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to update wedding update", error);
    redirect("/admin/updates?error=update-failed");
  }

  if (!data) {
    redirect("/admin/updates?error=not-found");
  }

  revalidateUpdatePaths();
  redirect("/admin/updates?status=updated");
}
