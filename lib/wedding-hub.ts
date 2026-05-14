import { isNullableString, isRecord, isStringArray } from "./type-guards";

import type { SupabaseClient } from "@supabase/supabase-js";

export const WEDDING_HUB_PATH = "/wedding-hub";

const HUB_WEDDING_SELECT =
  "id, allow_anonymous_hub_upload, photo_upload_requires_review, name, spotify_playlist_url, time_plan, venue_name, wedding_date";

export type HubWedding = {
  id: string;
  allow_anonymous_hub_upload: boolean;
  photo_upload_requires_review: boolean;
  name: string;
  spotify_playlist_url: string | null;
  time_plan: string[];
  venue_name: string | null;
  wedding_date: string | null;
};

export function getConfiguredWeddingId() {
  return process.env.WEDDING_ID ?? process.env.NEXT_PUBLIC_WEDDING_ID ?? null;
}

function getConfiguredSiteOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const siteUrl = configuredUrl ?? vercelUrl;

  if (!siteUrl) {
    return null;
  }

  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}

function normalizeHubWedding(value: unknown): HubWedding | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.allow_anonymous_hub_upload !== "boolean" ||
    typeof value.photo_upload_requires_review !== "boolean" ||
    typeof value.name !== "string" ||
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
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: isStringArray(value.time_plan) ? value.time_plan : [],
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
    const { data, error } = await supabase
      .from("weddings")
      .select(HUB_WEDDING_SELECT)
      .eq("id", configuredWeddingId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load configured wedding hub settings", error);
      return null;
    }

    return normalizeHubWedding(data);
  }

  const { data, error } = await supabase
    .from("weddings")
    .select(HUB_WEDDING_SELECT)
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) {
    console.error("Failed to load wedding hub settings", error);
    return null;
  }

  if (!data || data.length !== 1) {
    if (data && data.length > 1) {
      console.error(
        "Multiple weddings found for public hub. Set WEDDING_ID to choose the shared QR wedding.",
      );
    }

    return null;
  }

  return normalizeHubWedding(data[0]);
}

export function getMonogram(name: string) {
  const cleanedName = name.replace(/<3|&|\+|och|and/gi, " ");
  const parts = cleanedName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.charAt(0).toUpperCase() ?? "W";
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0).toUpperCase() : "H";

  return `${first}&${second}`;
}

export function getWeddingHubUrl(requestUrl?: string) {
  const configuredOrigin = getConfiguredSiteOrigin();
  const fallbackOrigin = requestUrl ? new URL(requestUrl).origin : "http://localhost:3000";

  return new URL(WEDDING_HUB_PATH, configuredOrigin ?? fallbackOrigin).toString();
}
