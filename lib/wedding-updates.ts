import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type PublishedWeddingUpdate = {
  id: string;
  title: string;
  message: string;
  link_url: string | null;
  updated_at: string;
};

type WeddingUpdateRow = PublishedWeddingUpdate;

function isWeddingUpdateRow(value: unknown): value is WeddingUpdateRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    isNullableString(value.link_url) &&
    typeof value.updated_at === "string"
  );
}

export async function getPublishedWeddingUpdates({
  limit = 5,
  weddingId,
}: {
  limit?: number;
  weddingId: string;
}) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wedding_updates")
    .select("id, title, message, link_url, updated_at")
    .eq("wedding_id", weddingId)
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load published wedding updates", error);
    return [];
  }

  return (data ?? []).filter(isWeddingUpdateRow);
}
