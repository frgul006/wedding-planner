#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_PROJECT_REF = "wakdmxadoruqsstbokan";
const DEFAULT_WEDDING_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_WEDDING_NAME = "Fredrik <3 Matilda";

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);

    if (!rawName) {
      throw new Error("Unexpected empty flag name");
    }

    if (inlineValue !== undefined) {
      args.set(rawName, inlineValue);
      continue;
    }

    const nextArg = argv[index + 1];

    if (nextArg && !nextArg.startsWith("--")) {
      args.set(rawName, nextArg);
      index += 1;
      continue;
    }

    args.set(rawName, "true");
  }

  return args;
}

function getConfigValue(args, flagName, envName, fallback) {
  return args.get(flagName) ?? process.env[envName] ?? fallback;
}

function requireConfigValue(args, flagName, envName) {
  const value = getConfigValue(args, flagName, envName);

  if (!value) {
    throw new Error(`Missing --${flagName} or ${envName}`);
  }

  return value;
}

function isEnabled(value) {
  return value === "1" || value === "true" || value === "yes";
}

function generateTemporaryPassword() {
  return `${randomBytes(24).toString("base64url")}aA1!`;
}

function getProjectApiKeys(projectRef) {
  const rawKeys = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", projectRef, "-o", "json"],
    { encoding: "utf8" },
  );

  return JSON.parse(rawKeys);
}

function getServiceRoleKey(apiKeys) {
  return (
    apiKeys.find((key) => key.id === "service_role")?.api_key ??
    apiKeys.find(
      (key) =>
        key.type === "secret" &&
        key.secret_jwt_template?.role === "service_role",
    )?.api_key
  );
}

function getPublishableKey(apiKeys) {
  return (
    apiKeys.find((key) => key.type === "publishable" && key.name === "default")
      ?.api_key ?? apiKeys.find((key) => key.id === "anon")?.api_key
  );
}

async function findAuthUserByEmail(supabase, email) {
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );

    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      return null;
    }
  }
}

async function createOrUpdateAdminUser({
  adminEmail,
  adminPassword,
  resetPassword,
  supabase,
}) {
  const { data: createdUser, error: createUserError } =
    await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

  if (createdUser?.user) {
    return { passwordWasSet: true, user: createdUser.user, userWasCreated: true };
  }

  if (
    createUserError &&
    !createUserError.message.toLowerCase().includes("already been registered")
  ) {
    throw createUserError;
  }

  const existingUser = await findAuthUserByEmail(supabase, adminEmail);

  if (!existingUser) {
    throw new Error(`Could not find or create Auth user ${adminEmail}`);
  }

  if (!resetPassword) {
    return { passwordWasSet: false, user: existingUser, userWasCreated: false };
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    existingUser.id,
    {
      email_confirm: true,
      password: adminPassword,
    },
  );

  if (updateError) {
    throw updateError;
  }

  return { passwordWasSet: true, user: existingUser, userWasCreated: false };
}

async function ensureWedding({ supabase, weddingId, weddingName }) {
  const { data, error } = await supabase
    .from("weddings")
    .upsert(
      {
        allow_anonymous_hub_upload: true,
        id: weddingId,
        name: weddingName,
        photo_upload_requires_review: false,
      },
      { ignoreDuplicates: true, onConflict: "id" },
    )
    .select("id");

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

async function upsertAdminProfile({
  adminEmail,
  displayName,
  supabase,
  userId,
  weddingId,
}) {
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("admin_profiles")
    .select("id, email")
    .eq("email", adminEmail)
    .maybeSingle();

  if (existingProfileError) {
    throw existingProfileError;
  }

  if (existingProfile && existingProfile.id !== userId) {
    throw new Error(
      `Admin profile email ${adminEmail} already belongs to auth user ${existingProfile.id}, not ${userId}. Resolve this manually before bootstrapping.`,
    );
  }

  const { error: adminProfileError } = await supabase
    .from("admin_profiles")
    .upsert(
      {
        display_name: displayName,
        email: adminEmail,
        id: userId,
        is_active: true,
        role: "admin",
        wedding_id: weddingId,
      },
      { onConflict: "id" },
    );

  if (adminProfileError) {
    throw adminProfileError;
  }
}

async function verifyAdminSignIn({
  adminEmail,
  adminPassword,
  publishableKey,
  supabaseUrl,
}) {
  if (!publishableKey) {
    console.log("Skipped sign-in verification: no publishable key found.");
    return;
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

  if (signInError) {
    throw signInError;
  }

  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("id, wedding_id, email, is_active")
    .eq("id", signInData.user.id)
    .single();

  if (profileError) {
    throw profileError;
  }

  console.log(
    `Verified admin sign-in for ${profile.email} on wedding ${profile.wedding_id}.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRef = getConfigValue(
    args,
    "project-ref",
    "PRODUCTION_SUPABASE_PROJECT_REF",
    DEFAULT_PROJECT_REF,
  );
  const confirmation = getConfigValue(
    args,
    "confirm-project-ref",
    "CONFIRM_PRODUCTION_PROJECT_REF",
  );

  if (confirmation !== projectRef) {
    throw new Error(
      `Refusing to bootstrap production. Set CONFIRM_PRODUCTION_PROJECT_REF=${projectRef} or pass --confirm-project-ref ${projectRef}.`,
    );
  }

  const adminEmail = requireConfigValue(
    args,
    "admin-email",
    "PRODUCTION_ADMIN_EMAIL",
  );
  const weddingId = getConfigValue(
    args,
    "wedding-id",
    "PRODUCTION_WEDDING_ID",
    DEFAULT_WEDDING_ID,
  );
  const weddingName = getConfigValue(
    args,
    "wedding-name",
    "PRODUCTION_WEDDING_NAME",
    DEFAULT_WEDDING_NAME,
  );
  const displayName = getConfigValue(
    args,
    "admin-display-name",
    "PRODUCTION_ADMIN_DISPLAY_NAME",
    adminEmail,
  );
  const providedPassword = getConfigValue(
    args,
    "admin-password",
    "PRODUCTION_ADMIN_PASSWORD",
  );
  const adminPassword = providedPassword ?? generateTemporaryPassword();
  const resetPassword =
    isEnabled(args.get("reset-password")) ||
    isEnabled(process.env.PRODUCTION_ADMIN_RESET_PASSWORD);
  const supabaseUrl = `https://${projectRef}.supabase.co`;
  const apiKeys = getProjectApiKeys(projectRef);
  const serviceRoleKey = getServiceRoleKey(apiKeys);

  if (!serviceRoleKey) {
    throw new Error(`Could not find service_role key for ${projectRef}`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { user, userWasCreated, passwordWasSet } = await createOrUpdateAdminUser({
    adminEmail,
    adminPassword,
    resetPassword,
    supabase,
  });

  const weddingWasCreated = await ensureWedding({
    supabase,
    weddingId,
    weddingName,
  });

  await upsertAdminProfile({
    adminEmail,
    displayName,
    supabase,
    userId: user.id,
    weddingId,
  });

  if (passwordWasSet) {
    await verifyAdminSignIn({
      adminEmail,
      adminPassword,
      publishableKey: getPublishableKey(apiKeys),
      supabaseUrl,
    });
  }

  console.log("Production bootstrap complete.");
  console.log(`Project ref: ${projectRef}`);
  console.log(`Wedding ID: ${weddingId}`);
  console.log(`Wedding name: ${weddingName}`);
  console.log(`Wedding created: ${weddingWasCreated}`);
  console.log(`Admin email: ${adminEmail}`);
  console.log(`Admin Auth user ID: ${user.id}`);
  console.log(`Admin user created: ${userWasCreated}`);

  if (passwordWasSet && providedPassword) {
    console.log("Admin password was provided; not printing it.");
  } else if (passwordWasSet) {
    console.log(`Generated temporary admin password: ${adminPassword}`);
    console.log("Store this password now; it is not saved by this script.");
  } else {
    console.log(
      "Admin Auth user already existed and password was not changed. Set PRODUCTION_ADMIN_RESET_PASSWORD=1 to reset it.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
