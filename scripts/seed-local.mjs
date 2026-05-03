#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const WEDDING_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "password123456";

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
    const value = valueParts.join("=").replace(/^['\"]|['\"]$/g, "");

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
    name: "Alex & Sam",
    wedding_date: "2026-08-15T15:00:00+02:00",
    venue_name: "Example Manor",
    venue_address: "Garden Road 1, Stockholm",
    google_maps_url: "https://maps.google.com/",
    time_plan: ["15:00 - Ceremony", "17:00 - Dinner", "21:00 - Dancing"],
    policy: "Dress code: festive summer formal.",
    gift_info: "Your presence is the best gift. If you want, contribute to our honeymoon fund.",
    spotify_playlist_url: "https://open.spotify.com/",
    allow_anonymous_hub_upload: true,
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
      id: "10000000-0000-0000-0000-000000000001",
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
      id: "10000000-0000-0000-0000-000000000003",
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

  console.log("Seeded local example data.");
  console.log(`Admin login: ${ADMIN_EMAIL}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
  console.log("Admin URL: http://localhost:3000/admin/login");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
