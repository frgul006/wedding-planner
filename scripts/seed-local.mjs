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
    wedding_date: "2026-09-26T16:30:00+02:00",
    venue_name: "Cicada",
    venue_address: "Veterinärgränd 6, Johanneshov",
    google_maps_url: "https://maps.app.goo.gl/KCgGXBcyeanMhsZx5",
    time_plan: ["16:30 - Välkomstdrinkar", "18:30 - Middag", "21:00 - Fest"],
    policy: "Klädkod: festlig sommarformal",
    gift_info: "Din närvaro är den bästa presenten.",
    spotify_playlist_url: "https://open.spotify.com/",
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
      invite_status: "not replied",
      deleted_at: null,
    },
    {
      id: "10000000-0000-0000-0000-000000000002",
      wedding_id: WEDDING_ID,
      full_name: "Grace Hopper",
      email: "grace@example.com",
      phone: null,
      notes: "Prefers SMS updates via companion",
      invite_status: "opened",
      deleted_at: null,
    },
    {
      id: ALAN_GUEST_ID,
      wedding_id: WEDDING_ID,
      full_name: "Alan Turing",
      email: null,
      phone: "+46707654321",
      notes: null,
      invite_status: "rsvp yes",
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
      last_submitted_at: new Date().toISOString(),
      updated_via_token_id: existingRsvpInvite.id,
      wedding_id: WEDDING_ID,
    },
    { onConflict: "guest_id" },
  );

  if (alanRsvpError) {
    throw alanRsvpError;
  }

  console.log("Seeded local example data.");
  console.log(`Admin login: ${ADMIN_EMAIL}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
  console.log("Admin URL: http://localhost:3000/admin/login");
  console.log(`First-time RSVP URL: ${firstTimeInvite.inviteUrl}`);
  console.log(`Existing RSVP update URL: ${existingRsvpInvite.inviteUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
