import { spawn } from "node:child_process";
import { expect } from "@playwright/test";
import { testWithGuests as test } from "./support/fixtures";
import {
  createInviteTestGuest,
  uniqueInviteToken,
} from "./support/invite-test-data";
import { uniqueGuestName } from "./support/admin-guests";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_ADMIN, SEEDED_WEDDING_ID } from "./support/test-data";
import { requireEnv } from "./support/env";
import { hashInviteToken } from "../lib/invite-token-crypto";

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

test("admin attendance save and simultaneous guest resubmission use one lock order", async () => {
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).hostname,
  );
  const db = createE2eSupabaseAdminClient();
  const token = uniqueInviteToken("admin-concurrent-rsvp");
  const { guestId } = await createInviteTestGuest({
    fullName: uniqueGuestName("Concurrent RSVP"),
    attendance: "yes",
    token,
  });
  const guest = await db.from("guests").select().eq("id", guestId).single();
  const admin = await db
    .from("admin_profiles")
    .select("id")
    .eq("email", SEEDED_ADMIN.email)
    .single();
  if (guest.error) throw guest.error;
  if (admin.error) throw admin.error;
  const changes = [
    {
      id: guestId,
      row_key: guestId,
      expected_updated_at: guest.data.updated_at,
      full_name: guest.data.full_name,
      email: guest.data.email,
      phone: null,
      notes: null,
      sms_opt_in: false,
      plus_one_allowed: false,
      rsvp_status: "rsvp no",
    },
  ];
  const child = spawn("docker", [
    "exec",
    "-i",
    "supabase_db_wedding-planner",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atq",
  ]);
  let output = "";
  let stderr = "";
  const locked = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<number | null>();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("admin-guest-lock-held")) locked.resolve();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    locked.reject(error);
    finished.reject(error);
  });
  child.on("exit", (code) => {
    if (!output.includes("admin-guest-lock-held"))
      locked.reject(new Error(stderr));
    finished.resolve(code);
  });
  const timeout = setTimeout(() => {
    child.kill();
    locked.reject(new Error("Concurrent RSVP test timed out"));
  }, 15_000);
  child.stdin.end(`begin;
set local statement_timeout = '10s';
select set_config('request.jwt.claim.sub', ${literal(admin.data.id)}, true);
select id from public.guests where id = ${literal(guestId)}::uuid for update;
select 'admin-guest-lock-held';
select pg_sleep(0.75);
select public.save_admin_guest_roster_session(${literal(SEEDED_WEDDING_ID)}::uuid, ${literal(JSON.stringify(changes))}::jsonb);
commit;`);
  try {
    await locked.promise;
    // Previously this acquired the RSVP tuple while the admin held the Guest,
    // causing a deterministic Guest -> response / response -> Guest deadlock.
    const response = db.rpc("submit_rsvp_response", {
      p_token_hash: hashInviteToken(token),
      p_attendance: "maybe",
      p_extra_guests: 0,
      p_food_preference: "Vegan concurrency",
      p_allergy_notes: null,
      p_phone: null,
      p_sms_opt_in: false,
    });
    const [guestResult, code] = await Promise.all([response, finished.promise]);
    expect(code, stderr).toBe(0);
    expect(guestResult.error).toBeNull();
    expect(output).toContain('"status": "success"');
    expect(
      (await db.from("guests").select("rsvp_status").eq("id", guestId).single())
        .data?.rsvp_status,
    ).toBe("rsvp maybe");
    expect(
      (
        await db
          .from("rsvp_responses")
          .select("attendance")
          .eq("guest_id", guestId)
          .single()
      ).data?.attendance,
    ).toBe("maybe");
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
});
