import { isMissingPartnerNameColumnError } from "@/lib/supabase/schema-compat";

import { normalizeTimePlanEntries, type WeddingTimePlanEntry } from "./time-plan";
import { isNullableString, isRecord } from "./type-guards";

import type { SupabaseClient } from "@supabase/supabase-js";

export const WEDDING_HUB_PATH = "/wedding-hub";

const HUB_WEDDING_SELECT =
  "id, allow_anonymous_hub_upload, photo_upload_requires_review, name, partner_one_name, partner_two_name, spotify_playlist_url, time_plan, venue_name, wedding_date";
const LEGACY_HUB_WEDDING_SELECT =
  "id, allow_anonymous_hub_upload, photo_upload_requires_review, name, spotify_playlist_url, time_plan, venue_name, wedding_date";

export type HubWedding = {
  id: string;
  allow_anonymous_hub_upload: boolean;
  photo_upload_requires_review: boolean;
  name: string;
  partner_one_name: string | null;
  partner_two_name: string | null;
  spotify_playlist_url: string | null;
  time_plan: WeddingTimePlanEntry[];
  venue_name: string | null;
  wedding_date: string | null;
};

export function getConfiguredWeddingId() {
  return process.env.WEDDING_ID ?? process.env.NEXT_PUBLIC_WEDDING_ID ?? null;
}

function withMissingPartnerNameColumns(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    partner_one_name: null,
    partner_two_name: null,
  };
}

function normalizeHubWedding(value: unknown): HubWedding | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.allow_anonymous_hub_upload !== "boolean" ||
    typeof value.photo_upload_requires_review !== "boolean" ||
    typeof value.name !== "string" ||
    !isNullableString(value.partner_one_name) ||
    !isNullableString(value.partner_two_name) ||
    !isNullableString(value.spotify_playlist_url) ||
    !isNullableString(value.venue_name) ||
    !isNullableString(value.wedding_date)
  ) {
    return null;
  }

  return {
    id: value.id,
    allow_anonymous_hub_upload: value.allow_anonymous_hub_upload,
    photo_upload_requires_review: value.photo_upload_requires_review,
    name: value.name,
    partner_one_name: value.partner_one_name,
    partner_two_name: value.partner_two_name,
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: normalizeTimePlanEntries(value.time_plan),
    venue_name: value.venue_name,
    wedding_date: value.wedding_date,
  };
}

export async function getHubWedding({
  supabase,
}: {
  supabase: SupabaseClient;
}): Promise<HubWedding | null> {
  const configuredWeddingId = getConfiguredWeddingId();

  if (configuredWeddingId) {
    const result = await supabase
      .from("weddings")
      .select(HUB_WEDDING_SELECT)
      .eq("id", configuredWeddingId)
      .maybeSingle();
    let data: unknown = result.data;
    let error = result.error;

    if (isMissingPartnerNameColumnError(error)) {
      const fallbackResult = await supabase
        .from("weddings")
        .select(LEGACY_HUB_WEDDING_SELECT)
        .eq("id", configuredWeddingId)
        .maybeSingle();

      data = withMissingPartnerNameColumns(fallbackResult.data);
      error = fallbackResult.error;
    }

    if (error) {
      console.error("Failed to load configured wedding hub settings", error);
      return null;
    }

    return normalizeHubWedding(data);
  }

  const result = await supabase
    .from("weddings")
    .select(HUB_WEDDING_SELECT)
    .order("created_at", { ascending: true })
    .limit(2);
  let data: unknown = result.data;
  let error = result.error;

  if (isMissingPartnerNameColumnError(error)) {
    const fallbackResult = await supabase
      .from("weddings")
      .select(LEGACY_HUB_WEDDING_SELECT)
      .order("created_at", { ascending: true })
      .limit(2);

    data = Array.isArray(fallbackResult.data)
      ? fallbackResult.data.map(withMissingPartnerNameColumns)
      : fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    console.error("Failed to load wedding hub settings", error);
    return null;
  }

  if (!Array.isArray(data) || data.length !== 1) {
    if (Array.isArray(data) && data.length > 1) {
      console.error(
        "Multiple weddings found for public hub. Set WEDDING_ID to choose the shared QR wedding.",
      );
    }

    return null;
  }

  return normalizeHubWedding(data[0]);
}
