import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";

type TimePlanPatchEntry = string | { label: string; time: string };

export const BASELINE_WEDDING_SETTINGS = {
  allow_anonymous_hub_upload: true,
  photo_upload_requires_review: false,
  child_policy: "Vi älskar era barn, men firar vuxet den här kvällen.",
  dress_code: "Klädkod: festlig sommarformal",
  gift_info: "Din närvaro är den bästa presenten.",
  google_maps_url: "https://maps.app.goo.gl/KCgGXBcyeanMhsZx5",
  invite_support_email: "osa@example.com",
  name: "Fredrik <3 Matilda",
  partner_one_name: "Fredrik",
  partner_two_name: "Matilda",
  policy: "Tunnelbanan stannar nära lokalen.",
  spotify_playlist_url: "https://open.spotify.com/",
  time_plan: [
    { time: "16:30", label: "Välkomstdrinkar" },
    { time: "18:30", label: "Middag" },
    { time: "21:00", label: "Fest" },
  ],
  venue_address: "Veterinärgränd 6, Johanneshov",
  venue_area: "Johanneshov",
  venue_name: "Cicada",
  wedding_date: "2026-09-26T14:30:00.000Z",
  wedding_end_date: null,
} as const;

export type WeddingSettingsPatch = Partial<{
  allow_anonymous_hub_upload: boolean;
  photo_upload_requires_review: boolean;
  child_policy: string | null;
  dress_code: string | null;
  gift_info: string | null;
  google_maps_url: string | null;
  invite_support_email: string | null;
  name: string;
  partner_one_name: string | null;
  partner_two_name: string | null;
  policy: string | null;
  spotify_playlist_url: string | null;
  time_plan: readonly TimePlanPatchEntry[];
  venue_address: string | null;
  venue_area: string | null;
  venue_name: string | null;
  wedding_date: string | null;
  wedding_end_date: string | null;
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
