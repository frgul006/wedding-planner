import { createHash, randomUUID } from "node:crypto";

import { E2E_GUEST_PREFIX } from "./admin-guests";
import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";

type Attendance = "yes" | "no" | "maybe";

type CreateInviteTestGuestOptions = {
  attendance?: Attendance;
  email?: string;
  extraGuests?: number;
  foodPreference?: string | null;
  fullName: string;
  inviteStatus?: "not replied" | "opened" | "rsvp yes" | "rsvp no" | "rsvp maybe";
  notes?: string | null;
  phone?: string | null;
  token: string;
};

export function hashInviteToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function uniqueInviteToken(label: string) {
  return `e2e-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${randomUUID()}`;
}

export async function createInviteTestGuest({
  attendance,
  email,
  extraGuests = 0,
  foodPreference = null,
  fullName,
  inviteStatus = "not replied",
  notes = null,
  phone = null,
  token,
}: CreateInviteTestGuestOptions) {
  const supabase = createE2eSupabaseAdminClient();
  const { data: guest, error: guestError } = await supabase
    .from("guests")
    .insert({
      email: email ?? `${token}@example.com`,
      full_name: fullName,
      invite_status: inviteStatus,
      notes,
      phone,
      wedding_id: SEEDED_WEDDING_ID,
    })
    .select("id")
    .single();

  if (guestError) {
    throw guestError;
  }

  const { data: inviteToken, error: tokenError } = await supabase
    .from("invite_tokens")
    .insert({
      guest_id: guest.id,
      is_active: true,
      token_hash: hashInviteToken(token),
      wedding_id: SEEDED_WEDDING_ID,
    })
    .select("id")
    .single();

  if (tokenError) {
    throw tokenError;
  }

  if (attendance) {
    const { error: rsvpError } = await supabase.from("rsvp_responses").insert({
      allergy_notes: notes,
      attendance,
      extra_guests: extraGuests,
      food_preference: foodPreference,
      guest_id: guest.id,
      updated_via_token_id: inviteToken.id,
      wedding_id: SEEDED_WEDDING_ID,
    });

    if (rsvpError) {
      throw rsvpError;
    }
  }

  if (typeof guest.id !== "string" || typeof inviteToken.id !== "string") {
    throw new Error("Expected Supabase to return inserted guest and invite token ids.");
  }

  return {
    guestId: guest.id,
    tokenId: inviteToken.id,
  };
}

export async function getRsvpResponseForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("rsvp_responses")
    .select("allergy_notes, attendance, extra_guests, food_preference, guest_id")
    .eq("guest_id", guestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getRsvpResponseCountForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { count, error } = await supabase
    .from("rsvp_responses")
    .select("id", { count: "exact", head: true })
    .eq("guest_id", guestId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export function uniqueRsvpGuestName(label: string) {
  return `${E2E_GUEST_PREFIX} RSVP ${label} ${Date.now()} ${randomUUID()}`;
}
