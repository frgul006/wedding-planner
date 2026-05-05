import { randomUUID } from "node:crypto";

import type { WeddingUpdateStatus } from "../../lib/wedding-update-status";

import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";

export const E2E_UPDATE_PREFIX = "E2E Update";

type CreateWeddingUpdateOptions = {
  createdByAdminId?: string | null;
  linkUrl?: string | null;
  message: string;
  status?: WeddingUpdateStatus;
  title: string;
  updatedAt?: string;
};

export async function deleteE2eWeddingUpdates() {
  const supabase = createE2eSupabaseAdminClient();
  const { error } = await supabase
    .from("wedding_updates")
    .delete()
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .like("title", `${E2E_UPDATE_PREFIX}%`);

  if (error) {
    throw error;
  }
}

export async function createWeddingUpdate({
  createdByAdminId = null,
  linkUrl = null,
  message,
  status = "published",
  title,
  updatedAt,
}: CreateWeddingUpdateOptions) {
  const supabase = createE2eSupabaseAdminClient();
  const insertValues = {
    created_by_admin_id: createdByAdminId,
    link_url: linkUrl,
    message,
    status,
    title,
    wedding_id: SEEDED_WEDDING_ID,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
  const { data, error } = await supabase
    .from("wedding_updates")
    .insert(insertValues)
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  if (typeof data.id !== "string") {
    throw new Error("Expected Supabase to return inserted wedding update id.");
  }

  return data.id;
}

export function uniqueWeddingUpdateTitle(label: string) {
  return `${E2E_UPDATE_PREFIX} ${label} ${Date.now()} ${randomUUID()}`;
}
