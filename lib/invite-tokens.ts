import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

const TOKEN_BYTES = 32;

type GuestRelation = {
  deleted_at: string | null;
  full_name: string | null;
};

type InviteWedding = {
  gift_info: string | null;
  google_maps_url: string | null;
  name: string;
  policy: string | null;
  spotify_playlist_url: string | null;
  time_plan: string[];
  venue_address: string | null;
  venue_name: string | null;
  wedding_date: string | null;
};

type WeddingRelation = Omit<InviteWedding, "name" | "time_plan"> & {
  name: string | null;
  time_plan: unknown;
};

type InviteTokenRow = {
  guests: GuestRelation | GuestRelation[] | null;
  weddings: WeddingRelation | WeddingRelation[] | null;
};

export type InviteTokenValidationResult =
  | {
      isValid: true;
      guest: {
        full_name: string;
      };
      wedding: InviteWedding;
    }
  | { isValid: false };

function getSingleRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] : relation;
}

function normalizeTimePlan(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

export function generateRawInviteToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInviteToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function buildInviteUrl(rawToken: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return new URL(`/invite/${rawToken}`, siteUrl).toString();
}

export async function regenerateInviteToken({
  guestId,
  supabase,
  weddingId,
}: {
  guestId: string;
  supabase: SupabaseClient;
  weddingId: string;
}) {
  const rawToken = generateRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const now = new Date().toISOString();

  const { error: invalidateError } = await supabase
    .from("invite_tokens")
    .update({
      is_active: false,
      invalidated_at: now,
      regenerated_at: now,
    })
    .eq("guest_id", guestId)
    .eq("wedding_id", weddingId)
    .eq("is_active", true);

  if (invalidateError) {
    throw invalidateError;
  }

  const { error: insertError } = await supabase.from("invite_tokens").insert({
    guest_id: guestId,
    wedding_id: weddingId,
    token_hash: tokenHash,
    is_active: true,
  });

  if (insertError) {
    throw insertError;
  }

  return {
    inviteUrl: buildInviteUrl(rawToken),
    rawToken,
  };
}

export async function validateInviteToken(
  rawToken: string,
): Promise<InviteTokenValidationResult> {
  if (!rawToken) {
    return { isValid: false };
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await supabase
    .from("invite_tokens")
    .select(
      `
        guests!invite_tokens_guest_wedding_fk!inner(
          deleted_at,
          full_name
        ),
        weddings!inner(
          gift_info,
          google_maps_url,
          name,
          policy,
          spotify_playlist_url,
          time_plan,
          venue_address,
          venue_name,
          wedding_date
        )
      `,
    )
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("Failed to validate invite token", error);
    }

    return { isValid: false };
  }

  const row = data as InviteTokenRow;
  const guest = getSingleRelation(row.guests);
  const wedding = getSingleRelation(row.weddings);

  if (!guest?.full_name || guest.deleted_at || !wedding?.name) {
    return { isValid: false };
  }

  return {
    isValid: true,
    guest: {
      full_name: guest.full_name,
    },
    wedding: {
      gift_info: wedding.gift_info,
      google_maps_url: wedding.google_maps_url,
      name: wedding.name,
      policy: wedding.policy,
      spotify_playlist_url: wedding.spotify_playlist_url,
      time_plan: normalizeTimePlan(wedding.time_plan),
      venue_address: wedding.venue_address,
      venue_name: wedding.venue_name,
      wedding_date: wedding.wedding_date,
    },
  };
}
