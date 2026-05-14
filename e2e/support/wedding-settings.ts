import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";

export const BASELINE_WEDDING_SETTINGS = {
  allow_anonymous_hub_upload: true,
  photo_upload_requires_review: false,
  gift_info: "Din närvaro är den bästa presenten.",
  google_maps_url: "https://maps.app.goo.gl/KCgGXBcyeanMhsZx5",
  name: "Fredrik <3 Matilda",
  policy: "Klädkod: festlig sommarformal",
  spotify_playlist_url: "https://open.spotify.com/",
  time_plan: ["16:30 - Välkomstdrinkar", "18:30 - Middag", "21:00 - Fest"],
  venue_address: "Veterinärgränd 6, Johanneshov",
  venue_name: "Cicada",
  wedding_date: "2026-09-26T14:30:00.000Z",
} as const;

export type WeddingSettingsPatch = Partial<{
  allow_anonymous_hub_upload: boolean;
  photo_upload_requires_review: boolean;
  gift_info: string | null;
  google_maps_url: string | null;
  name: string;
  policy: string | null;
  spotify_playlist_url: string | null;
  time_plan: readonly string[];
  venue_address: string | null;
  venue_name: string | null;
  wedding_date: string | null;
}>;

export async function updateWeddingSettings(patch: WeddingSettingsPatch) {
  const supabase = createE2eSupabaseAdminClient();
  const { error } = await supabase
    .from("weddings")
    .update(patch)
    .eq("id", SEEDED_WEDDING_ID);

  if (error) {
    throw error;
  }
}

export async function resetWeddingSettings() {
  await updateWeddingSettings(BASELINE_WEDDING_SETTINGS);
}
