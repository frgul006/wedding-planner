import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAttributableGuestNavigationSession,
  type GuestNavigationSessionLookup,
} from "@/lib/guest-navigation-session";
import { getHubWedding, type HubWedding } from "@/lib/wedding-hub";

export type HubUploadAttribution = {
  guestNavigationSession: GuestNavigationSessionLookup | null;
  guestName: string | null;
};

export type HubContext = {
  wedding: HubWedding;
  attribution: HubUploadAttribution;
  uploadAllowed: boolean;
};

type ActiveHubGuestRow = {
  full_name: string | null;
};

function isActiveHubGuestRow(value: unknown): value is ActiveHubGuestRow {
  return (
    typeof value === "object" &&
    value !== null &&
    (typeof (value as { full_name?: unknown }).full_name === "string" ||
      (value as { full_name?: unknown }).full_name === null)
  );
}

async function resolveHubUploadAttribution({
  session,
  supabase,
  weddingId,
}: {
  session: GuestNavigationSessionLookup | null;
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<HubUploadAttribution> {
  const emptyAttribution = {
    guestName: null,
    guestNavigationSession: null,
  } satisfies HubUploadAttribution;

  if (!session?.guestId) {
    return emptyAttribution;
  }

  const { data, error } = await supabase
    .from("guests")
    .select("full_name")
    .eq("id", session.guestId)
    .eq("wedding_id", weddingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("Failed to resolve Wedding hub Guest access", error);
    return emptyAttribution;
  }

  if (!isActiveHubGuestRow(data)) {
    return emptyAttribution;
  }

  return {
    guestName: data.full_name,
    guestNavigationSession: session,
  };
}

export async function resolveWeddingHubAccess({
  supabase,
  existingCookieValue,
}: {
  supabase: SupabaseClient;
  existingCookieValue: string | null;
}): Promise<HubContext | null> {
  const wedding = await getHubWedding({ supabase });

  if (!wedding) {
    return null;
  }

  const session = await getAttributableGuestNavigationSession({
    existingCookieValue,
    supabase,
    weddingId: wedding.id,
  });
  const attribution = await resolveHubUploadAttribution({
    session,
    supabase,
    weddingId: wedding.id,
  });
  const uploadAllowed =
    wedding.allow_anonymous_hub_upload ||
    Boolean(attribution.guestNavigationSession?.guestId);

  return {
    wedding,
    attribution,
    uploadAllowed,
  };
}

export function isPhotoUploadAllowed(context: HubContext | null) {
  return Boolean(context?.uploadAllowed);
}
