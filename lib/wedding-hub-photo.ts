import type { SupabaseClient } from "@supabase/supabase-js";

import { getHubWedding, type HubWedding } from "./wedding-hub";
import {
  getAttributableGuestNavigationSession,
  type GuestNavigationSessionLookup,
} from "./guest-navigation-session";

export type HubUploadAttribution = {
  guestNavigationSession: GuestNavigationSessionLookup | null;
  guestName: string | null;
};

export type HubContext = {
  wedding: HubWedding;
  attribution: HubUploadAttribution;
  uploadAllowed: boolean;
  spotifyUrl: string | null;
};

type GuestRecord = { full_name: string | null };

function isGuestRecord(value: unknown): value is GuestRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (typeof (value as { full_name?: unknown }).full_name === "string" ||
      (value as { full_name?: unknown }).full_name === null)
  );
}

export async function resolveWeddingHubContext({
  supabase,
  existingCookieValue,
}: {
  supabase: SupabaseClient;
  existingCookieValue: string | null;
}) {
  const wedding = await getHubWedding({ supabase });

  if (!wedding) {
    return null;
  }

  const attributionSession = await getAttributableGuestNavigationSession({
    existingCookieValue,
    supabase,
    weddingId: wedding.id,
  });

  const attribution: HubUploadAttribution = {
    guestNavigationSession: attributionSession,
    guestName: null,
  };

  if (attributionSession?.guestId) {
    const { data, error } = await supabase
      .from("guests")
      .select("full_name")
      .eq("id", attributionSession.guestId)
      .eq("wedding_id", wedding.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!error && isGuestRecord(data)) {
      attribution.guestName = data.full_name;
    }

    if (error) {
      console.error("Failed to resolve attributed guest", error);
    }
  }

  const canUpload =
    wedding.allow_anonymous_hub_upload ||
    Boolean(attribution.guestNavigationSession?.guestId);

  const spotifyUrl = wedding.spotify_playlist_url;

  return {
    wedding,
    attribution,
    uploadAllowed: canUpload,
    spotifyUrl,
  } satisfies HubContext;
}

export function isPhotoUploadAllowed(context: HubContext | null) {
  return Boolean(context?.uploadAllowed);
}
