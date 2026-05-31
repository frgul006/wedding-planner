#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const WEDDING_ID = "00000000-0000-0000-0000-000000000001";
const ADA_GUEST_ID = "10000000-0000-0000-0000-000000000001";
const ALAN_GUEST_ID = "10000000-0000-0000-0000-000000000003";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "password123456";
const FIRST_TIME_RSVP_TOKEN = "local-ada-first-time-rsvp";
const EXISTING_RSVP_TOKEN = "local-alan-existing-rsvp";
const INVITE_VISUAL_FIXTURE_DATA_PATH = resolve(
  process.cwd(),
  "e2e/fixtures/invite-visual-fixtures.json",
);
const inviteVisualFixtureData = JSON.parse(
  readFileSync(INVITE_VISUAL_FIXTURE_DATA_PATH, "utf8"),
);

if (inviteVisualFixtureData.weddingId !== WEDDING_ID) {
  throw new Error("Invite visual fixtures must target the seeded wedding.");
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Is .env.local configured?`);
  }

  return value;
}

function hashInviteToken(rawToken) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function buildLocalInviteUrl(rawToken) {
  return `http://localhost:3000/invite/${rawToken}`;
}

function buildLocalInviteUrlWithHash(rawToken, hash) {
  return `${buildLocalInviteUrl(rawToken)}#${hash}`;
}

function getInviteOpenedStatus(inviteStatus) {
  return inviteStatus.startsWith("rsvp ") ? "opened" : inviteStatus;
}

function getRsvpStatus(inviteStatus) {
  return inviteStatus.startsWith("rsvp ") ? inviteStatus : "not replied";
}

async function upsertLocalInviteToken({ guestId, rawToken, supabase }) {
  const now = new Date().toISOString();
  const tokenHash = hashInviteToken(rawToken);

  const { error: invalidateError } = await supabase
    .from("invite_tokens")
    .update({
      is_active: false,
      invalidated_at: now,
      regenerated_at: now,
    })
    .eq("guest_id", guestId)
    .eq("wedding_id", WEDDING_ID)
    .eq("is_active", true);

  if (invalidateError) {
    throw invalidateError;
  }

  const { data, error } = await supabase
    .from("invite_tokens")
    .upsert(
      {
        access_scope: "full",
        guest_id: guestId,
        wedding_id: WEDDING_ID,
        token_hash: tokenHash,
        is_active: true,
        invalidated_at: null,
        regenerated_at: now,
      },
      { onConflict: "token_hash" },
    )
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return {
    id: data.id,
    inviteUrl: buildLocalInviteUrl(rawToken),
  };
}

async function resetInviteVisualFixtures(supabase) {
  const guestIds = inviteVisualFixtureData.fixtures.map(
    (fixture) => fixture.guest.id,
  );
  const updateIds = inviteVisualFixtureData.updates.map((update) => update.id);

  if (updateIds.length) {
    const { error: updateIdDeleteError } = await supabase
      .from("wedding_updates")
      .delete()
      .eq("wedding_id", WEDDING_ID)
      .in("id", updateIds);

    if (updateIdDeleteError) {
      throw updateIdDeleteError;
    }
  }

  const { error: guestDeleteError } = await supabase
    .from("guests")
    .delete()
    .eq("wedding_id", WEDDING_ID)
    .in("id", guestIds);

  if (guestDeleteError) {
    throw guestDeleteError;
  }
}

async function seedInviteVisualFixtures(supabase) {
  await resetInviteVisualFixtures(supabase);

  const now = new Date().toISOString();
  const guests = inviteVisualFixtureData.fixtures.map((fixture) => ({
    id: fixture.guest.id,
    wedding_id: WEDDING_ID,
    full_name: fixture.guest.fullName,
    email: fixture.guest.email,
    phone: fixture.guest.phone,
    notes: fixture.guest.notes,
    plus_one_allowed: fixture.guest.plusOneAllowed,
    invite_status: getInviteOpenedStatus(fixture.guest.inviteStatus),
    rsvp_status: getRsvpStatus(fixture.guest.inviteStatus),
    sms_opt_in: fixture.guest.smsOptIn,
    sms_opted_in_at: fixture.guest.smsOptIn ? now : null,
    sms_opted_out_at: null,
    deleted_at: null,
  }));

  const { error: guestsError } = await supabase.from("guests").insert(guests);

  if (guestsError) {
    throw guestsError;
  }

  const tokenIdsByFixtureKey = new Map();

  for (const fixture of inviteVisualFixtureData.fixtures) {
    const invite = await upsertLocalInviteToken({
      guestId: fixture.guest.id,
      rawToken: fixture.token,
      supabase,
    });

    tokenIdsByFixtureKey.set(fixture.key, invite.id);
  }

  const rsvps = inviteVisualFixtureData.fixtures.flatMap((fixture) => {
    if (!fixture.rsvp) {
      return [];
    }

    const tokenId = tokenIdsByFixtureKey.get(fixture.key);

    if (!tokenId) {
      throw new Error(`Missing invite visual fixture token id for ${fixture.key}.`);
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
      wedding_id: WEDDING_ID,
    }];
  });

  if (rsvps.length) {
    const { error: rsvpError } = await supabase.from("rsvp_responses").insert(rsvps);

    if (rsvpError) {
      throw rsvpError;
    }
  }

  if (inviteVisualFixtureData.updates.length) {
    const updates = inviteVisualFixtureData.updates.map((update) => ({
      id: update.id,
      wedding_id: WEDDING_ID,
      title: update.title,
      message: update.message,
      link_url: update.linkUrl,
      status: update.status,
      updated_at: update.updatedAt,
      created_by_admin_id: null,
    }));
    const { error: updatesError } = await supabase
      .from("wedding_updates")
      .insert(updates);

    if (updatesError) {
      throw updatesError;
    }
  }

  return inviteVisualFixtureData.fixtures.map((fixture) => ({
    detailsUrl: buildLocalInviteUrlWithHash(fixture.token, "detaljer"),
    label: fixture.label,
    osaUrl: buildLocalInviteUrlWithHash(fixture.token, "osa"),
    primaryUrl: buildLocalInviteUrlWithHash(fixture.token, fixture.primaryHash),
    url: buildLocalInviteUrl(fixture.token),
  }));
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseSecretKey = requireEnv("SUPABASE_SECRET_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: createdUser, error: createUserError } =
    await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });

  if (
    createUserError &&
    !createUserError.message.toLowerCase().includes("already been registered")
  ) {
    throw createUserError;
  }

  let adminUser = createdUser?.user;

  if (!adminUser) {
    const { data: users, error: listUsersError } =
      await supabase.auth.admin.listUsers();

    if (listUsersError) {
      throw listUsersError;
    }

    adminUser = users.users.find((user) => user.email === ADMIN_EMAIL);
  }

  if (!adminUser) {
    throw new Error(`Could not find or create ${ADMIN_EMAIL}`);
  }

  const { error: weddingError } = await supabase.from("weddings").upsert({
    id: WEDDING_ID,
    name: "Fredrik <3 Matilda",
    partner_one_name: "Fredrik",
    partner_two_name: "Matilda",
    wedding_date: "2026-09-26T16:30:00+02:00",
    venue_name: "Cicada",
    venue_address: "Veterinärgränd 6, Johanneshov",
    venue_area: "Johanneshov",
    google_maps_url: "https://maps.app.goo.gl/KCgGXBcyeanMhsZx5",
    time_plan: [
      { time: "16:30", label: "Välkomstdrinkar" },
      { time: "18:30", label: "Middag" },
      { time: "21:00", label: "Fest" },
    ],
    policy: "Tunnelbanan stannar nära lokalen.",
    dress_code: "Klädkod: festlig sommarformal",
    child_policy: "Vi älskar era barn, men firar vuxet den här kvällen.",
    gift_info: "Din närvaro är den bästa presenten.",
    spotify_playlist_url: "https://open.spotify.com/",
    invite_support_email: "osa@example.com",
    invite_sms_template: "Hej {{first_name}}! Välkomna att fira vår dag tillsammans med oss. Här är er personliga inbjudan där ni kan OSA: {{invite_link}} / Fredrik & Matilda",
    allow_anonymous_hub_upload: true,
    photo_upload_requires_review: false,
  });

  if (weddingError) {
    throw weddingError;
  }

  const { error: adminProfileError } = await supabase
    .from("admin_profiles")
    .upsert({
      id: adminUser.id,
      wedding_id: WEDDING_ID,
      email: ADMIN_EMAIL,
      display_name: "Local Admin",
      role: "admin",
      is_active: true,
    });

  if (adminProfileError) {
    throw adminProfileError;
  }

  const guests = [
    {
      id: ADA_GUEST_ID,
      wedding_id: WEDDING_ID,
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+46701234567",
      notes: "Vegetarian",
      plus_one_allowed: false,
      invite_status: "not replied",
      rsvp_status: "not replied",
      deleted_at: null,
    },
    {
      id: "10000000-0000-0000-0000-000000000002",
      wedding_id: WEDDING_ID,
      full_name: "Grace Hopper",
      email: "grace@example.com",
      phone: null,
      notes: "Prefers SMS updates via companion",
      plus_one_allowed: true,
      invite_status: "opened",
      rsvp_status: "not replied",
      deleted_at: null,
    },
    {
      id: ALAN_GUEST_ID,
      wedding_id: WEDDING_ID,
      full_name: "Alan Turing",
      email: null,
      phone: "+46707654321",
      notes: null,
      plus_one_allowed: true,
      invite_status: "opened",
      rsvp_status: "rsvp yes",
      deleted_at: null,
    },
  ];

  const { error: guestsError } = await supabase.from("guests").upsert(guests);

  if (guestsError) {
    throw guestsError;
  }

  const { error: clearAdaRsvpError } = await supabase
    .from("rsvp_responses")
    .delete()
    .eq("guest_id", ADA_GUEST_ID);

  if (clearAdaRsvpError) {
    throw clearAdaRsvpError;
  }

  const firstTimeInvite = await upsertLocalInviteToken({
    guestId: ADA_GUEST_ID,
    rawToken: FIRST_TIME_RSVP_TOKEN,
    supabase,
  });
  const existingRsvpInvite = await upsertLocalInviteToken({
    guestId: ALAN_GUEST_ID,
    rawToken: EXISTING_RSVP_TOKEN,
    supabase,
  });

  const { error: alanRsvpError } = await supabase.from("rsvp_responses").upsert(
    {
      allergy_notes: "No shellfish.",
      attendance: "yes",
      extra_guests: 1,
      food_preference: "Kosher",
      guest_id: ALAN_GUEST_ID,
      plus_one_name: "Alan's guest",
      plus_one_phone: null,
      plus_one_sms_opt_in: false,
      last_submitted_at: new Date().toISOString(),
      updated_via_token_id: existingRsvpInvite.id,
      wedding_id: WEDDING_ID,
    },
    { onConflict: "guest_id" },
  );

  if (alanRsvpError) {
    throw alanRsvpError;
  }

  const visualFixtureRoutes = await seedInviteVisualFixtures(supabase);

  console.log("Seeded local example data.");
  console.log(`Admin login: ${ADMIN_EMAIL}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
  console.log("Admin URL: http://localhost:3000/admin/login");
  console.log(`First-time RSVP URL: ${firstTimeInvite.inviteUrl}`);
  console.log(`Existing RSVP update URL: ${existingRsvpInvite.inviteUrl}`);
  console.log("Visual invite fixture URLs:");
  for (const fixtureRoute of visualFixtureRoutes) {
    console.log(`- ${fixtureRoute.label}: ${fixtureRoute.primaryUrl}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
