import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createOrRefreshGuestNavigationSession,
  GUEST_NAVIGATION_COOKIE_NAME,
  getGuestNavigationCookieOptions,
} from "@/lib/guest-navigation-session";
import { hashInviteToken } from "@/lib/invite-token-crypto";
import { isRsvpAttendance, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingPartnerNameColumnError } from "@/lib/supabase/schema-compat";
import { normalizeTimePlanLines } from "@/lib/time-plan";
import { isNullableString, isRecord } from "@/lib/type-guards";

type GuestRelation = {
  deleted_at: string | null;
  full_name: string | null;
  phone: string | null;
  plus_one_allowed: boolean;
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
  plus_one_allergy_notes: string | null;
  plus_one_email: string | null;
  plus_one_food_preference: string | null;
  plus_one_name: string | null;
  plus_one_phone: string | null;
  plus_one_sms_opt_in: boolean;
  last_submitted_at: string;
};

export type InviteWedding = {
  child_policy: string | null;
  dress_code: string | null;
  partner_one_name: string | null;
  partner_two_name: string | null;
  gift_info: string | null;
  google_maps_url: string | null;
  invite_support_email: string | null;
  name: string;
  policy: string | null;
  spotify_playlist_url: string | null;
  time_plan: string[];
  venue_address: string | null;
  venue_area: string | null;
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

export type GrantedInviteAccess = InviteTokenIdentity & {
  status: "granted";
  guest: {
    full_name: string;
    phone: string | null;
    plus_one_allowed: boolean;
    sms_opt_in: boolean;
  };
  wedding: InviteWedding;
};

export type GrantedInviteAccessWithRsvp = GrantedInviteAccess & {
  rsvpResponse: InviteRsvpResponse | null;
};

export type DeniedInviteAccess = {
  status: "denied";
};

export type InviteAccessResult = GrantedInviteAccessWithRsvp | DeniedInviteAccess;
export type InviteAccessIdentityResult = GrantedInviteAccess | DeniedInviteAccess;

export type PreparedGuestNavigationSessionCookie = {
  name: typeof GUEST_NAVIGATION_COOKIE_NAME;
  options: ReturnType<typeof getGuestNavigationCookieOptions>;
  value: string;
};

const inviteTokenContextSelect = `
  id,
  guest_id,
  wedding_id,
  guests!invite_tokens_guest_wedding_fk!inner(
    deleted_at,
    full_name,
    phone,
    plus_one_allowed,
    sms_opt_in
  ),
  weddings!inner(
    child_policy,
    dress_code,
    gift_info,
    google_maps_url,
    invite_support_email,
    name,
    partner_one_name,
    partner_two_name,
    policy,
    spotify_playlist_url,
    time_plan,
    venue_address,
    venue_area,
    venue_name,
    wedding_date
  )
`;

const legacyInviteTokenContextSelect = `
  id,
  guest_id,
  wedding_id,
  guests!invite_tokens_guest_wedding_fk!inner(
    deleted_at,
    full_name,
    phone,
    plus_one_allowed,
    sms_opt_in
  ),
  weddings!inner(
    child_policy,
    dress_code,
    gift_info,
    google_maps_url,
    invite_support_email,
    name,
    policy,
    spotify_playlist_url,
    time_plan,
    venue_address,
    venue_area,
    venue_name,
    wedding_date
  )
`;

function getSingleRelation(relation: unknown) {
  return Array.isArray(relation) ? relation[0] : relation;
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

function withMissingPartnerNameColumnsOnWeddingRelation(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const weddings = Array.isArray(value.weddings)
    ? value.weddings.map(withMissingPartnerNameColumns)
    : withMissingPartnerNameColumns(value.weddings);

  return {
    ...value,
    weddings,
  };
}

function isGuestRelation(value: unknown): value is GuestRelation {
  return (
    isRecord(value) &&
    isNullableString(value.deleted_at) &&
    isNullableString(value.full_name) &&
    isNullableString(value.phone) &&
    typeof value.plus_one_allowed === "boolean" &&
    typeof value.sms_opt_in === "boolean"
  );
}

function isWeddingRelation(value: unknown): value is WeddingRelation {
  return (
    isRecord(value) &&
    isNullableString(value.child_policy) &&
    isNullableString(value.dress_code) &&
    isNullableString(value.gift_info) &&
    isNullableString(value.google_maps_url) &&
    isNullableString(value.invite_support_email) &&
    isNullableString(value.name) &&
    isNullableString(value.partner_one_name) &&
    isNullableString(value.partner_two_name) &&
    isNullableString(value.policy) &&
    isNullableString(value.spotify_playlist_url) &&
    isNullableString(value.venue_address) &&
    isNullableString(value.venue_area) &&
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
    isNullableString(value.plus_one_allergy_notes) &&
    isNullableString(value.plus_one_email) &&
    isNullableString(value.plus_one_food_preference) &&
    isNullableString(value.plus_one_name) &&
    isNullableString(value.plus_one_phone) &&
    typeof value.plus_one_sms_opt_in === "boolean" &&
    typeof value.last_submitted_at === "string"
  );
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
    plus_one_allergy_notes: value.plus_one_allergy_notes,
    plus_one_email: value.plus_one_email,
    plus_one_food_preference: value.plus_one_food_preference,
    plus_one_name: value.plus_one_name,
    plus_one_phone: value.plus_one_phone,
    plus_one_sms_opt_in: value.plus_one_sms_opt_in,
    last_submitted_at: value.last_submitted_at,
  };
}

function toGrantedInviteAccess({
  guest,
  guestId,
  inviteTokenId,
  wedding,
  weddingId,
}: InviteTokenIdentity & {
  guest: ValidGuestRelation;
  wedding: ValidWeddingRelation;
}): GrantedInviteAccess {
  return {
    status: "granted",
    guestId,
    inviteTokenId,
    weddingId,
    guest: {
      full_name: guest.full_name,
      phone: guest.phone,
      plus_one_allowed: guest.plus_one_allowed,
      sms_opt_in: guest.sms_opt_in,
    },
    wedding: {
      child_policy: wedding.child_policy,
      dress_code: wedding.dress_code,
      gift_info: wedding.gift_info,
      google_maps_url: wedding.google_maps_url,
      invite_support_email: wedding.invite_support_email,
      name: wedding.name,
      partner_one_name: wedding.partner_one_name,
      partner_two_name: wedding.partner_two_name,
      policy: wedding.policy,
      spotify_playlist_url: wedding.spotify_playlist_url,
      time_plan: normalizeTimePlanLines(wedding.time_plan),
      venue_address: wedding.venue_address,
      venue_area: wedding.venue_area,
      venue_name: wedding.venue_name,
      wedding_date: wedding.wedding_date,
    },
  };
}

async function resolveGrantedInviteAccess(
  rawToken: string,
  supabase: SupabaseClient,
): Promise<GrantedInviteAccess | null> {
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashInviteToken(rawToken);
  const result = await supabase
    .from("invite_tokens")
    .select(inviteTokenContextSelect)
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();
  let data: unknown = result.data;
  let error = result.error;

  if (isMissingPartnerNameColumnError(error)) {
    const fallbackResult = await supabase
      .from("invite_tokens")
      .select(legacyInviteTokenContextSelect)
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();

    data = withMissingPartnerNameColumnsOnWeddingRelation(fallbackResult.data);
    error = fallbackResult.error;
  }

  if (error || !data) {
    if (error) {
      console.error("Failed to resolve Invite access", error);
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

  return toGrantedInviteAccess({
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
  });
}

async function loadInviteRsvpResponse(
  grantedAccess: Pick<GrantedInviteAccess, "guestId" | "weddingId">,
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("rsvp_responses")
    .select(
      "allergy_notes, attendance, extra_guests, food_preference, plus_one_allergy_notes, plus_one_email, plus_one_food_preference, plus_one_name, plus_one_phone, plus_one_sms_opt_in, last_submitted_at",
    )
    .eq("guest_id", grantedAccess.guestId)
    .eq("wedding_id", grantedAccess.weddingId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load RSVP response for Invite access", error);
  }

  return normalizeRsvpResponse(data);
}

type ResolveInviteAccessOptions = {
  includeRsvpResponse?: boolean;
  supabase?: SupabaseClient;
};

type ResolveInviteAccessWithRsvpOptions = {
  includeRsvpResponse?: true;
  supabase?: SupabaseClient;
};

type ResolveInviteAccessIdentityOptions = {
  includeRsvpResponse: false;
  supabase?: SupabaseClient;
};

export async function resolveInviteAccess(
  rawToken: string,
  options: ResolveInviteAccessIdentityOptions,
): Promise<InviteAccessIdentityResult>;
export async function resolveInviteAccess(
  rawToken: string,
  options?: ResolveInviteAccessWithRsvpOptions,
): Promise<InviteAccessResult>;
export async function resolveInviteAccess(
  rawToken: string,
  options: ResolveInviteAccessOptions = {},
): Promise<InviteAccessResult | InviteAccessIdentityResult> {
  const supabase = options.supabase ?? createSupabaseAdminClient();
  const grantedAccess = await resolveGrantedInviteAccess(rawToken, supabase);

  if (!grantedAccess) {
    return { status: "denied" };
  }

  if (options.includeRsvpResponse === false) {
    return grantedAccess;
  }

  return {
    ...grantedAccess,
    rsvpResponse: await loadInviteRsvpResponse(grantedAccess, supabase),
  };
}

export async function recordInviteOpened(
  grantedAccess: Pick<GrantedInviteAccess, "guestId" | "weddingId">,
  options: { supabase?: SupabaseClient } = {},
) {
  const supabase = options.supabase ?? createSupabaseAdminClient();
  const { error } = await supabase.rpc("mark_invite_opened", {
    p_guest_id: grantedAccess.guestId,
    p_wedding_id: grantedAccess.weddingId,
  });

  if (error) {
    console.error("Failed to record Invite opened", error);
  }
}

export async function prepareGuestNavigationSession(
  grantedAccess: Pick<
    GrantedInviteAccess,
    "guestId" | "inviteTokenId" | "weddingId"
  >,
  {
    existingCookieValue,
    metadata,
    supabase = createSupabaseAdminClient(),
  }: {
    existingCookieValue: string | null;
    metadata: Record<string, string> | null;
    supabase?: SupabaseClient;
  },
): Promise<PreparedGuestNavigationSessionCookie | null> {
  const sessionCookie = await createOrRefreshGuestNavigationSession({
    existingCookieValue,
    guestId: grantedAccess.guestId,
    inviteTokenId: grantedAccess.inviteTokenId,
    metadata,
    supabase,
    weddingId: grantedAccess.weddingId,
  });

  if (!sessionCookie) {
    return null;
  }

  return {
    name: GUEST_NAVIGATION_COOKIE_NAME,
    value: sessionCookie.cookieValue,
    options: getGuestNavigationCookieOptions(sessionCookie.expiresAt),
  };
}
