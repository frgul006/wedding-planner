import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateRawInviteToken,
  hashInviteToken,
} from "@/lib/invite-token-crypto";
import { isRsvpAttendance, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isNullableString, isRecord } from "@/lib/type-guards";

type GuestRelation = {
  deleted_at: string | null;
  full_name: string | null;
  phone: string | null;
  sms_opt_in: boolean;
};

export type InviteTokenIdentity = {
  guestId: string;
  inviteTokenId: string;
  weddingId: string;
};

export type InviteRsvpResponse = {
  allergy_notes: string | null;
  attendance: RsvpAttendance;
  extra_guests: number;
  food_preference: string | null;
  last_submitted_at: string;
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

type ValidGuestRelation = GuestRelation & {
  full_name: string;
};

type ValidWeddingRelation = WeddingRelation & {
  name: string;
};

type ValidInviteTokenContext = InviteTokenIdentity & {
  guest: ValidGuestRelation;
  wedding: ValidWeddingRelation;
};

type InviteTokenRow = {
  id: string;
  guest_id: string;
  guests: unknown;
  wedding_id: string;
  weddings: unknown;
};

type RsvpResponseRow = Omit<InviteRsvpResponse, "attendance"> & {
  attendance: string | null;
};

export type InviteTokenValidationResult =
  | {
      isValid: true;
      guestId: string;
      inviteTokenId: string;
      weddingId: string;
      guest: {
        full_name: string;
        phone: string | null;
        sms_opt_in: boolean;
      };
      rsvpResponse: InviteRsvpResponse | null;
      wedding: InviteWedding;
    }
  | { isValid: false };

function getSingleRelation(relation: unknown) {
  return Array.isArray(relation) ? relation[0] : relation;
}

function isGuestRelation(value: unknown): value is GuestRelation {
  return (
    isRecord(value) &&
    isNullableString(value.deleted_at) &&
    isNullableString(value.full_name) &&
    isNullableString(value.phone) &&
    typeof value.sms_opt_in === "boolean"
  );
}

function isWeddingRelation(value: unknown): value is WeddingRelation {
  return (
    isRecord(value) &&
    isNullableString(value.gift_info) &&
    isNullableString(value.google_maps_url) &&
    isNullableString(value.name) &&
    isNullableString(value.policy) &&
    isNullableString(value.spotify_playlist_url) &&
    isNullableString(value.venue_address) &&
    isNullableString(value.venue_name) &&
    isNullableString(value.wedding_date)
  );
}

function isInviteTokenRow(value: unknown): value is InviteTokenRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.guest_id === "string" &&
    typeof value.wedding_id === "string"
  );
}

function isRsvpResponseRow(value: unknown): value is RsvpResponseRow {
  return (
    isRecord(value) &&
    isNullableString(value.allergy_notes) &&
    isNullableString(value.attendance) &&
    typeof value.extra_guests === "number" &&
    isNullableString(value.food_preference) &&
    typeof value.last_submitted_at === "string"
  );
}

function normalizeTimePlan(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeRsvpResponse(value: unknown): InviteRsvpResponse | null {
  if (!isRsvpResponseRow(value)) {
    return null;
  }

  if (!isRsvpAttendance(value.attendance)) {
    return null;
  }

  return {
    allergy_notes: value.allergy_notes,
    attendance: value.attendance,
    extra_guests: value.extra_guests,
    food_preference: value.food_preference,
    last_submitted_at: value.last_submitted_at,
  };
}

export function buildInviteUrl(rawToken: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return new URL(`/invite/${rawToken}`, siteUrl).toString();
}

async function resolveValidInviteToken(
  rawToken: string,
  supabase?: SupabaseClient,
): Promise<ValidInviteTokenContext | null> {
  if (!rawToken) {
    return null;
  }

  const client = supabase ?? createSupabaseAdminClient();
  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await client
    .from("invite_tokens")
    .select(
      `
        id,
        guest_id,
        wedding_id,
        guests!invite_tokens_guest_wedding_fk!inner(
          deleted_at,
          full_name,
          phone,
          sms_opt_in
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
      console.error("Failed to resolve invite token", error);
    }

    return null;
  }

  if (!isInviteTokenRow(data)) {
    return null;
  }

  const guest = getSingleRelation(data.guests);
  const wedding = getSingleRelation(data.weddings);

  if (
    !isGuestRelation(guest) ||
    !isWeddingRelation(wedding) ||
    !guest.full_name ||
    guest.deleted_at ||
    !wedding.name
  ) {
    return null;
  }

  return {
    guest: {
      ...guest,
      full_name: guest.full_name,
    },
    guestId: data.guest_id,
    inviteTokenId: data.id,
    wedding: {
      ...wedding,
      name: wedding.name,
    },
    weddingId: data.wedding_id,
  };
}

export async function getActiveInviteTokenIdentity(
  rawToken: string,
  supabase?: SupabaseClient,
): Promise<InviteTokenIdentity | null> {
  const invite = await resolveValidInviteToken(rawToken, supabase);

  if (!invite) {
    return null;
  }

  return {
    guestId: invite.guestId,
    inviteTokenId: invite.inviteTokenId,
    weddingId: invite.weddingId,
  };
}

export async function markInviteOpened({
  guestId,
  weddingId,
}: {
  guestId: string;
  weddingId: string;
}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("mark_invite_opened", {
    p_guest_id: guestId,
    p_wedding_id: weddingId,
  });

  if (error) {
    console.error("Failed to mark invite opened", error);
  }
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
  const supabase = createSupabaseAdminClient();
  const invite = await resolveValidInviteToken(rawToken, supabase);

  if (!invite) {
    return { isValid: false };
  }

  const { guest, wedding } = invite;
  const { data: rsvpData, error: rsvpError } = await supabase
    .from("rsvp_responses")
    .select("allergy_notes, attendance, extra_guests, food_preference, last_submitted_at")
    .eq("guest_id", invite.guestId)
    .eq("wedding_id", invite.weddingId)
    .maybeSingle();

  if (rsvpError) {
    console.error("Failed to load RSVP response for invite token", rsvpError);
  }

  return {
    isValid: true,
    guestId: invite.guestId,
    inviteTokenId: invite.inviteTokenId,
    weddingId: invite.weddingId,
    guest: {
      full_name: guest.full_name,
      phone: guest.phone,
      sms_opt_in: guest.sms_opt_in,
    },
    rsvpResponse: normalizeRsvpResponse(rsvpData),
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
