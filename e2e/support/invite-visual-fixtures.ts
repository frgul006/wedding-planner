import { hashInviteToken } from "../../lib/invite-token-crypto";
import { isNullableString, isRecord } from "../../lib/type-guards";

import fixtureDataJson from "../fixtures/invite-visual-fixtures.json";
import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";
import { invitePathForToken } from "./urls";

type VisualAttendance = "maybe" | "no" | "yes";
type VisualInviteStatus =
  | "not replied"
  | "opened"
  | "rsvp maybe"
  | "rsvp no"
  | "rsvp yes";
type VisualUpdateStatus = "archived" | "draft" | "published";

type InviteVisualFixtureGuest = {
  email: string | null;
  fullName: string;
  id: string;
  inviteStatus: VisualInviteStatus;
  notes: string | null;
  phone: string | null;
  plusOneAllowed: boolean;
  smsOptIn: boolean;
};

type InviteVisualFixtureRsvp = {
  allergyNotes: string | null;
  attendance: VisualAttendance;
  extraGuests: number;
  foodPreference: string | null;
  lastSubmittedAt: string;
  plusOneAllergyNotes: string | null;
  plusOneEmail: string | null;
  plusOneFoodPreference: string | null;
  plusOneName: string | null;
  plusOnePhone: string | null;
  plusOneSmsOptIn: boolean;
};

type InviteVisualFixture = {
  guest: InviteVisualFixtureGuest;
  key: string;
  label: string;
  primaryHash: "detaljer" | "inbjudan" | "osa";
  rsvp: InviteVisualFixtureRsvp | null;
  token: string;
};

type InviteVisualUpdateFixture = {
  id: string;
  linkUrl: string | null;
  message: string;
  status: VisualUpdateStatus;
  title: string;
  updatedAt: string;
};

type InviteVisualFixtureData = {
  fixtures: InviteVisualFixture[];
  updates: InviteVisualUpdateFixture[];
  weddingId: string;
};

type InviteVisualFixtureWithPaths = InviteVisualFixture & {
  detailsPath: string;
  osaPath: string;
  path: string;
  primaryPath: string;
};

function isVisualAttendance(value: unknown): value is VisualAttendance {
  return value === "maybe" || value === "no" || value === "yes";
}

function isVisualInviteStatus(value: unknown): value is VisualInviteStatus {
  return (
    value === "not replied" ||
    value === "opened" ||
    value === "rsvp maybe" ||
    value === "rsvp no" ||
    value === "rsvp yes"
  );
}

function isVisualUpdateStatus(value: unknown): value is VisualUpdateStatus {
  return value === "archived" || value === "draft" || value === "published";
}

function isPrimaryHash(value: unknown): value is InviteVisualFixture["primaryHash"] {
  return value === "detaljer" || value === "inbjudan" || value === "osa";
}

function isInviteVisualFixtureGuest(value: unknown): value is InviteVisualFixtureGuest {
  return (
    isRecord(value) &&
    isNullableString(value.email) &&
    typeof value.fullName === "string" &&
    typeof value.id === "string" &&
    isVisualInviteStatus(value.inviteStatus) &&
    isNullableString(value.notes) &&
    isNullableString(value.phone) &&
    typeof value.plusOneAllowed === "boolean" &&
    typeof value.smsOptIn === "boolean"
  );
}

function isInviteVisualFixtureRsvp(value: unknown): value is InviteVisualFixtureRsvp {
  return (
    isRecord(value) &&
    isNullableString(value.allergyNotes) &&
    isVisualAttendance(value.attendance) &&
    typeof value.extraGuests === "number" &&
    isNullableString(value.foodPreference) &&
    typeof value.lastSubmittedAt === "string" &&
    isNullableString(value.plusOneAllergyNotes) &&
    isNullableString(value.plusOneEmail) &&
    isNullableString(value.plusOneFoodPreference) &&
    isNullableString(value.plusOneName) &&
    isNullableString(value.plusOnePhone) &&
    typeof value.plusOneSmsOptIn === "boolean"
  );
}

function isInviteVisualFixture(value: unknown): value is InviteVisualFixture {
  return (
    isRecord(value) &&
    isInviteVisualFixtureGuest(value.guest) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    isPrimaryHash(value.primaryHash) &&
    (value.rsvp === null || isInviteVisualFixtureRsvp(value.rsvp)) &&
    typeof value.token === "string"
  );
}

function isInviteVisualUpdateFixture(
  value: unknown,
): value is InviteVisualUpdateFixture {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNullableString(value.linkUrl) &&
    typeof value.message === "string" &&
    isVisualUpdateStatus(value.status) &&
    typeof value.title === "string" &&
    typeof value.updatedAt === "string"
  );
}

function parseInviteVisualFixtureData(value: unknown): InviteVisualFixtureData {
  if (!isRecord(value)) {
    throw new Error("Invite visual fixture data must be an object.");
  }

  const { fixtures, updates, weddingId } = value;

  if (typeof weddingId !== "string") {
    throw new Error("Invite visual fixture data is missing weddingId.");
  }

  if (!Array.isArray(fixtures) || !fixtures.every(isInviteVisualFixture)) {
    throw new Error("Invite visual fixture data has invalid fixtures.");
  }

  if (!Array.isArray(updates) || !updates.every(isInviteVisualUpdateFixture)) {
    throw new Error("Invite visual fixture data has invalid updates.");
  }

  return {
    fixtures,
    updates,
    weddingId,
  };
}

const fixtureData = parseInviteVisualFixtureData(fixtureDataJson);

if (fixtureData.weddingId !== SEEDED_WEDDING_ID) {
  throw new Error("Invite visual fixtures must target the seeded wedding.");
}

function pathWithHash(token: string, hash: InviteVisualFixture["primaryHash"]) {
  return `${invitePathForToken(token)}#${hash}`;
}

function withPaths(fixture: InviteVisualFixture): InviteVisualFixtureWithPaths {
  const path = invitePathForToken(fixture.token);

  return {
    ...fixture,
    detailsPath: pathWithHash(fixture.token, "detaljer"),
    osaPath: pathWithHash(fixture.token, "osa"),
    path,
    primaryPath: pathWithHash(fixture.token, fixture.primaryHash),
  };
}

export const inviteVisualFixtureRoutes = fixtureData.fixtures.map(withPaths);

export function getInviteVisualFixture(key: string) {
  const fixture = inviteVisualFixtureRoutes.find((candidate) => candidate.key === key);

  if (!fixture) {
    throw new Error(`Unknown invite visual fixture: ${key}`);
  }

  return fixture;
}

export async function invalidateInviteVisualFixtureToken(
  fixture: InviteVisualFixtureWithPaths,
  supabase = createE2eSupabaseAdminClient(),
) {
  const { data, error } = await supabase
    .from("invite_tokens")
    .update({
      invalidated_at: new Date().toISOString(),
      is_active: false,
    })
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .eq("token_hash", hashInviteToken(fixture.token))
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  if (!data || typeof data.id !== "string") {
    throw new Error(`Expected invite visual fixture token for ${fixture.key}.`);
  }
}

export async function resetInviteVisualFixtures(
  supabase = createE2eSupabaseAdminClient(),
) {
  const guestIds = fixtureData.fixtures.map((fixture) => fixture.guest.id);
  const updateIds = fixtureData.updates.map((update) => update.id);

  if (updateIds.length) {
    const { error: updateIdDeleteError } = await supabase
      .from("wedding_updates")
      .delete()
      .eq("wedding_id", SEEDED_WEDDING_ID)
      .in("id", updateIds);

    if (updateIdDeleteError) {
      throw updateIdDeleteError;
    }
  }

  const { error: guestDeleteError } = await supabase
    .from("guests")
    .delete()
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .in("id", guestIds);

  if (guestDeleteError) {
    throw guestDeleteError;
  }
}

export async function seedInviteVisualFixtures(
  supabase = createE2eSupabaseAdminClient(),
) {
  await resetInviteVisualFixtures(supabase);

  const now = new Date().toISOString();
  const guestRows = fixtureData.fixtures.map((fixture) => ({
    deleted_at: null,
    email: fixture.guest.email,
    full_name: fixture.guest.fullName,
    id: fixture.guest.id,
    invite_status: fixture.guest.inviteStatus,
    notes: fixture.guest.notes,
    phone: fixture.guest.phone,
    plus_one_allowed: fixture.guest.plusOneAllowed,
    sms_opt_in: fixture.guest.smsOptIn,
    sms_opted_in_at: fixture.guest.smsOptIn ? now : null,
    sms_opted_out_at: null,
    wedding_id: SEEDED_WEDDING_ID,
  }));

  const { error: guestsError } = await supabase.from("guests").insert(guestRows);

  if (guestsError) {
    throw guestsError;
  }

  const tokenIdsByFixtureKey = new Map<string, string>();

  for (const fixture of fixtureData.fixtures) {
    const { data: inviteToken, error: tokenError } = await supabase
      .from("invite_tokens")
      .insert({
        guest_id: fixture.guest.id,
        invalidated_at: null,
        is_active: true,
        regenerated_at: null,
        token_hash: hashInviteToken(fixture.token),
        wedding_id: SEEDED_WEDDING_ID,
      })
      .select("id")
      .single();

    if (tokenError) {
      throw tokenError;
    }

    if (!inviteToken || typeof inviteToken.id !== "string") {
      throw new Error("Expected invite visual fixture token id.");
    }

    tokenIdsByFixtureKey.set(fixture.key, inviteToken.id);
  }

  const rsvpRows = fixtureData.fixtures.flatMap((fixture) => {
    if (!fixture.rsvp) {
      return [];
    }

    const tokenId = tokenIdsByFixtureKey.get(fixture.key);

    if (!tokenId) {
      throw new Error(`Missing token id for ${fixture.key}.`);
    }

    return [{
      allergy_notes: fixture.rsvp.allergyNotes,
      attendance: fixture.rsvp.attendance,
      extra_guests: fixture.rsvp.extraGuests,
      food_preference: fixture.rsvp.foodPreference,
      guest_id: fixture.guest.id,
      last_submitted_at: fixture.rsvp.lastSubmittedAt,
      plus_one_allergy_notes: fixture.rsvp.plusOneAllergyNotes,
      plus_one_email: fixture.rsvp.plusOneEmail,
      plus_one_food_preference: fixture.rsvp.plusOneFoodPreference,
      plus_one_name: fixture.rsvp.plusOneName,
      plus_one_phone: fixture.rsvp.plusOnePhone,
      plus_one_sms_opt_in: fixture.rsvp.plusOneSmsOptIn,
      plus_one_sms_opted_in_at: fixture.rsvp.plusOneSmsOptIn
        ? fixture.rsvp.lastSubmittedAt
        : null,
      plus_one_sms_opted_out_at: null,
      updated_via_token_id: tokenId,
      wedding_id: SEEDED_WEDDING_ID,
    }];
  });

  if (rsvpRows.length) {
    const { error: rsvpError } = await supabase.from("rsvp_responses").insert(rsvpRows);

    if (rsvpError) {
      throw rsvpError;
    }
  }

  if (fixtureData.updates.length) {
    const updateRows = fixtureData.updates.map((update) => ({
      created_by_admin_id: null,
      id: update.id,
      link_url: update.linkUrl,
      message: update.message,
      status: update.status,
      title: update.title,
      updated_at: update.updatedAt,
      wedding_id: SEEDED_WEDDING_ID,
    }));
    const { error: updatesError } = await supabase
      .from("wedding_updates")
      .insert(updateRows);

    if (updatesError) {
      throw updatesError;
    }
  }

  return inviteVisualFixtureRoutes;
}
