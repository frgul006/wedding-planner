#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROJECT_REF = "wakdmxadoruqsstbokan";
const DEFAULT_WEDDING_ID = "00000000-0000-0000-0000-000000000001";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

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

function requireConfigValue(args, flagNames, envName) {
  for (const flagName of flagNames) {
    const value = args.get(flagName);
    if (value) {
      return value;
    }
  }

  const envValue = process.env[envName];
  if (envValue) {
    return envValue;
  }

  throw new Error(`Missing ${flagNames.map((flagName) => `--${flagName}`).join(" or ")} or ${envName}`);
}

function isEnabled(value) {
  return TRUTHY_VALUES.has(String(value ?? "").toLowerCase());
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseSupabaseJson(rawOutput) {
  const trimmed = rawOutput.trim();
  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");
  const starts = [arrayStart, objectStart].filter((index) => index >= 0);

  if (!starts.length) {
    throw new Error(`Supabase CLI did not return JSON: ${trimmed}`);
  }

  const start = Math.min(...starts);
  const arrayEnd = trimmed.lastIndexOf("]");
  const objectEnd = trimmed.lastIndexOf("}");
  const end = Math.max(arrayEnd, objectEnd);

  if (end < start) {
    throw new Error(`Supabase CLI returned malformed JSON: ${trimmed}`);
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

function runSupabaseQuery(sql) {
  const output = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", sql], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return parseSupabaseJson(output);
}

function readLinkedProjectRef() {
  try {
    return readFileSync(resolve(REPO_ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  } catch (error) {
    throw new Error(
      `Could not read linked Supabase project ref. Run supabase link --project-ref ${DEFAULT_PROJECT_REF} first. (${error.message})`,
    );
  }
}

function printHelp() {
  console.log(`Reset production invite state for one active Invited Guest by exact full name.

Usage:
  CONFIRM_PRODUCTION_PROJECT_REF=${DEFAULT_PROJECT_REF} \\
    pnpm guest:reset-invite -- --name "Matilda Ekevik"

  CONFIRM_PRODUCTION_PROJECT_REF=${DEFAULT_PROJECT_REF} \\
    pnpm guest:reset-invite -- --name "Matilda Ekevik" --execute

Options:
  --name, --full-name          Exact active Invited Guest full_name to reset.
  --wedding-id                 Wedding id. Defaults to ${DEFAULT_WEDDING_ID}.
  --project-ref                Expected linked Supabase project ref. Defaults to ${DEFAULT_PROJECT_REF}.
  --confirm-project-ref        Safety confirmation. Can also use CONFIRM_PRODUCTION_PROJECT_REF.
  --execute                    Apply changes. Omit for read-only dry run.
  --help                       Show this help.

Reset does:
  - invalidate active invite tokens for the invited guest
  - delete RSVP response
  - delete guest navigation sessions
  - delete Invite SMS delivery history for that guest; delete now-empty Invite SMS blasts
  - reset invite_status and rsvp_status to not replied
  - archive active RSVP-managed Plus-one Guests tied to the RSVP and revoke their scoped tokens

Reset preserves contact info, +1 permission, SMS consent, notes, and inactive token audit rows.`);
}

function buildPreviewSql({ fullName, weddingId }) {
  const weddingLiteral = `${sqlLiteral(weddingId)}::uuid`;
  const nameLiteral = sqlLiteral(fullName);

  return `
with exact_name_guests as (
  select
    g.id,
    g.wedding_id,
    g.full_name,
    g.guest_kind,
    g.invited_guest_id,
    g.rsvp_managed,
    g.invite_status,
    g.rsvp_status,
    g.plus_one_allowed,
    g.sms_opt_in,
    g.deleted_at,
    g.created_at
  from public.guests g
  where g.wedding_id = ${weddingLiteral}
    and g.full_name = ${nameLiteral}
),
active_invited_matches as (
  select *
  from exact_name_guests
  where guest_kind = 'invited'
    and invited_guest_id is null
    and deleted_at is null
),
target as (
  select *
  from active_invited_matches
  order by created_at, id
  limit 1
),
tied_rsvp_plus_ones as (
  select pg.id
  from public.guests pg
  join target t on t.wedding_id = pg.wedding_id
  where pg.invited_guest_id = t.id
    and pg.guest_kind = 'plus_one'
    and pg.rsvp_managed = true
    and pg.deleted_at is null
),
invite_sms_deliveries as (
  select md.id, md.message_blast_id, md.delivery_status
  from public.message_deliveries md
  join public.message_blasts mb on mb.id = md.message_blast_id and mb.wedding_id = md.wedding_id
  join target t on t.id = md.guest_id and t.wedding_id = md.wedding_id
  where mb.message_kind = 'invite_sms'
),
affected_session_guests as (
  select id from target
  union all
  select id from tied_rsvp_plus_ones
)
select
  (select count(*)::int from exact_name_guests) as exact_name_guest_count,
  (select count(*)::int from exact_name_guests where deleted_at is not null) as archived_exact_name_guest_count,
  (select count(*)::int from active_invited_matches) as active_invited_match_count,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'full_name', full_name,
        'invite_status', invite_status,
        'rsvp_status', rsvp_status,
        'sms_opt_in', sms_opt_in,
        'plus_one_allowed', plus_one_allowed
      )
      order by created_at, id
    )
    from active_invited_matches
  ), '[]'::jsonb) as active_invited_matches,
  (select count(*)::int from public.invite_tokens it join target t on t.id = it.guest_id and t.wedding_id = it.wedding_id) as invite_token_count,
  (select count(*)::int from public.invite_tokens it join target t on t.id = it.guest_id and t.wedding_id = it.wedding_id where it.is_active) as active_invite_token_count,
  (select count(*)::int from public.rsvp_responses rr join target t on t.id = rr.guest_id and t.wedding_id = rr.wedding_id) as rsvp_response_count,
  (select count(*)::int from public.guest_navigation_sessions gns join target t on t.id = gns.guest_id and t.wedding_id = gns.wedding_id) as target_guest_navigation_session_count,
  (select count(*)::int from tied_rsvp_plus_ones) as active_tied_rsvp_managed_plus_one_count,
  (select count(*)::int from public.invite_tokens it join tied_rsvp_plus_ones pg on pg.id = it.guest_id where it.is_active) as active_tied_rsvp_managed_plus_one_token_count,
  (select count(*)::int from public.guest_navigation_sessions gns join affected_session_guests g on g.id = gns.guest_id) as affected_guest_navigation_session_count,
  (select count(*)::int from invite_sms_deliveries) as invite_sms_delivery_count,
  (select count(*)::int from invite_sms_deliveries where delivery_status = 'sent') as sent_invite_sms_delivery_count;
`;
}

function buildExecuteSql({ fullName, guestId, weddingId }) {
  const weddingLiteral = `${sqlLiteral(weddingId)}::uuid`;
  const guestLiteral = `${sqlLiteral(guestId)}::uuid`;
  const nameLiteral = sqlLiteral(fullName);

  return `
with operation as (
  select now() as changed_at
),
target as (
  select id, wedding_id
  from public.guests
  where id = ${guestLiteral}
    and wedding_id = ${weddingLiteral}
    and full_name = ${nameLiteral}
    and guest_kind = 'invited'
    and invited_guest_id is null
    and deleted_at is null
),
tied_rsvp_plus_ones as (
  select pg.id, pg.wedding_id
  from public.guests pg
  join target t on t.wedding_id = pg.wedding_id
  where pg.invited_guest_id = t.id
    and pg.guest_kind = 'plus_one'
    and pg.rsvp_managed = true
    and pg.deleted_at is null
),
affected_session_guests as (
  select id, wedding_id from target
  union all
  select id, wedding_id from tied_rsvp_plus_ones
),
deleted_invite_sms_deliveries as (
  delete from public.message_deliveries md
  using target t
  where md.wedding_id = t.wedding_id
    and md.guest_id = t.id
    and exists (
      select 1
      from public.message_blasts mb
      where mb.id = md.message_blast_id
        and mb.wedding_id = md.wedding_id
        and mb.message_kind = 'invite_sms'
    )
  returning md.id, md.message_blast_id
),
deleted_guest_navigation_sessions as (
  delete from public.guest_navigation_sessions gns
  using affected_session_guests g
  where gns.wedding_id = g.wedding_id
    and gns.guest_id = g.id
  returning gns.id
),
deleted_rsvp_responses as (
  delete from public.rsvp_responses rr
  using target t
  where rr.wedding_id = t.wedding_id
    and rr.guest_id = t.id
  returning rr.id
),
invalidated_invited_guest_tokens as (
  update public.invite_tokens it
  set is_active = false,
      invalidated_at = coalesce(it.invalidated_at, (select changed_at from operation))
  from target t
  where it.wedding_id = t.wedding_id
    and it.guest_id = t.id
    and it.is_active = true
  returning it.id
),
invalidated_tied_plus_one_tokens as (
  update public.invite_tokens it
  set is_active = false,
      invalidated_at = coalesce(it.invalidated_at, (select changed_at from operation))
  from tied_rsvp_plus_ones pg
  where it.wedding_id = pg.wedding_id
    and it.guest_id = pg.id
    and it.is_active = true
  returning it.id
),
archived_tied_rsvp_plus_ones as (
  update public.guests pg
  set deleted_at = (select changed_at from operation)
  from tied_rsvp_plus_ones tied
  where pg.id = tied.id
    and pg.wedding_id = tied.wedding_id
  returning pg.id
),
updated_guest as (
  update public.guests g
  set invite_status = 'not replied',
      rsvp_status = 'not replied'
  from target t
  where g.id = t.id
    and g.wedding_id = t.wedding_id
  returning g.id, g.invite_status, g.rsvp_status, g.sms_opt_in, g.plus_one_allowed
)
select
  (select count(*)::int from target) as target_count,
  (select count(*)::int from deleted_invite_sms_deliveries) as deleted_invite_sms_delivery_count,
  coalesce((select jsonb_agg(distinct message_blast_id) from deleted_invite_sms_deliveries), '[]'::jsonb) as affected_invite_sms_blast_ids,
  (select count(*)::int from deleted_guest_navigation_sessions) as deleted_guest_navigation_session_count,
  (select count(*)::int from deleted_rsvp_responses) as deleted_rsvp_response_count,
  (select count(*)::int from invalidated_invited_guest_tokens) as invalidated_invited_guest_token_count,
  (select count(*)::int from invalidated_tied_plus_one_tokens) as invalidated_tied_plus_one_token_count,
  (select count(*)::int from archived_tied_rsvp_plus_ones) as archived_tied_rsvp_plus_one_count,
  (select count(*)::int from updated_guest) as updated_guest_count,
  (select invite_status from updated_guest limit 1) as invite_status,
  (select rsvp_status from updated_guest limit 1) as rsvp_status,
  (select sms_opt_in from updated_guest limit 1) as sms_opt_in_preserved,
  (select plus_one_allowed from updated_guest limit 1) as plus_one_allowed_preserved;
`;
}

function buildDeleteEmptyInviteSmsBlastsSql({ blastIds, weddingId }) {
  if (!blastIds.length) {
    return null;
  }

  const weddingLiteral = `${sqlLiteral(weddingId)}::uuid`;
  const blastIdList = blastIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ");

  return `
delete from public.message_blasts mb
where mb.wedding_id = ${weddingLiteral}
  and mb.message_kind = 'invite_sms'
  and mb.id in (${blastIdList})
  and not exists (
    select 1
    from public.message_deliveries md
    where md.wedding_id = mb.wedding_id
      and md.message_blast_id = mb.id
  )
returning mb.id;
`;
}

function buildVerificationSql({ guestId, weddingId }) {
  const weddingLiteral = `${sqlLiteral(weddingId)}::uuid`;
  const guestLiteral = `${sqlLiteral(guestId)}::uuid`;

  return `
with target as (
  select id, wedding_id
  from public.guests
  where id = ${guestLiteral}
    and wedding_id = ${weddingLiteral}
),
active_tied_rsvp_plus_ones as (
  select pg.id, pg.wedding_id
  from public.guests pg
  join target t on t.wedding_id = pg.wedding_id
  where pg.invited_guest_id = t.id
    and pg.guest_kind = 'plus_one'
    and pg.rsvp_managed = true
    and pg.deleted_at is null
)
select
  (select invite_status from target join public.guests g using (id, wedding_id) limit 1) as invite_status,
  (select rsvp_status from target join public.guests g using (id, wedding_id) limit 1) as rsvp_status,
  (select count(*)::int from public.invite_tokens it join target t on t.id = it.guest_id and t.wedding_id = it.wedding_id where it.is_active) as active_invited_guest_token_count,
  (select count(*)::int from public.rsvp_responses rr join target t on t.id = rr.guest_id and t.wedding_id = rr.wedding_id) as rsvp_response_count,
  (select count(*)::int from public.guest_navigation_sessions gns join target t on t.id = gns.guest_id and t.wedding_id = gns.wedding_id) as target_guest_navigation_session_count,
  (select count(*)::int from active_tied_rsvp_plus_ones) as active_tied_rsvp_managed_plus_one_count,
  (select count(*)::int from public.invite_tokens it join active_tied_rsvp_plus_ones pg on pg.id = it.guest_id and pg.wedding_id = it.wedding_id where it.is_active) as active_tied_rsvp_managed_plus_one_token_count,
  (select count(*)::int from public.message_deliveries md join public.message_blasts mb on mb.id = md.message_blast_id and mb.wedding_id = md.wedding_id join target t on t.id = md.guest_id and t.wedding_id = md.wedding_id where mb.message_kind = 'invite_sms') as invite_sms_delivery_count,
  (select count(*)::int from public.message_deliveries md join public.message_blasts mb on mb.id = md.message_blast_id and mb.wedding_id = md.wedding_id join target t on t.id = md.guest_id and t.wedding_id = md.wedding_id where mb.message_kind = 'invite_sms' and md.delivery_status = 'sent') as sent_invite_sms_delivery_count;
`;
}

function firstRow(result) {
  if (!Array.isArray(result) || !result.length) {
    throw new Error("Supabase query returned no rows.");
  }

  return result[0];
}

function printPreview(summary) {
  console.log("Preview:");
  console.log(`  exact-name guest rows: ${summary.exact_name_guest_count}`);
  console.log(`  archived exact-name rows: ${summary.archived_exact_name_guest_count}`);
  console.log(`  active Invited Guest matches: ${summary.active_invited_match_count}`);

  for (const match of summary.active_invited_matches ?? []) {
    console.log(`  match: ${match.full_name} (${match.id})`);
    console.log(`    invite_status: ${match.invite_status}`);
    console.log(`    rsvp_status: ${match.rsvp_status}`);
    console.log(`    plus_one_allowed: ${match.plus_one_allowed}`);
    console.log(`    sms_opt_in: ${match.sms_opt_in}`);
  }

  if (summary.active_invited_match_count !== 1) {
    return;
  }

  console.log("Would reset:");
  console.log(`  active invite tokens: ${summary.active_invite_token_count}`);
  console.log(`  RSVP responses: ${summary.rsvp_response_count}`);
  console.log(`  guest navigation sessions: ${summary.affected_guest_navigation_session_count}`);
  console.log(`  Invite SMS deliveries: ${summary.invite_sms_delivery_count}`);
  console.log(`  sent Invite SMS deliveries: ${summary.sent_invite_sms_delivery_count}`);
  console.log(`  active RSVP-managed tied plus-ones: ${summary.active_tied_rsvp_managed_plus_one_count}`);
  console.log(`  active tied plus-one scoped tokens: ${summary.active_tied_rsvp_managed_plus_one_token_count}`);
  console.log("Would preserve contact info, notes, +1 permission, SMS consent, inactive token audit rows.");
}

function assertPreviewIsExecutable(summary) {
  if (summary.active_invited_match_count !== 1) {
    throw new Error(
      `Expected exactly one active Invited Guest match, found ${summary.active_invited_match_count}. No changes applied.`,
    );
  }
}

function assertVerificationPassed(verification) {
  const failures = [];

  if (verification.invite_status !== "not replied") failures.push("invite_status not reset");
  if (verification.rsvp_status !== "not replied") failures.push("rsvp_status not reset");
  if (verification.active_invited_guest_token_count !== 0) failures.push("active invited guest tokens remain");
  if (verification.rsvp_response_count !== 0) failures.push("RSVP responses remain");
  if (verification.target_guest_navigation_session_count !== 0) failures.push("target guest navigation sessions remain");
  if (verification.active_tied_rsvp_managed_plus_one_count !== 0) failures.push("active tied RSVP-managed plus-ones remain");
  if (verification.active_tied_rsvp_managed_plus_one_token_count !== 0) failures.push("active tied plus-one tokens remain");
  if (verification.invite_sms_delivery_count !== 0) failures.push("Invite SMS deliveries remain");
  if (verification.sent_invite_sms_delivery_count !== 0) failures.push("sent Invite SMS deliveries remain");

  if (failures.length) {
    throw new Error(`Post-reset verification failed: ${failures.join(", ")}`);
  }
}

function normalizeUuidArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.has("help")) {
    printHelp();
    return;
  }

  const fullName = requireConfigValue(args, ["name", "full-name"], "RESET_GUEST_FULL_NAME").trim();
  if (!fullName) {
    throw new Error("Guest name cannot be blank.");
  }

  const weddingId = getConfigValue(args, "wedding-id", "PRODUCTION_WEDDING_ID", DEFAULT_WEDDING_ID).trim();
  const projectRef = getConfigValue(args, "project-ref", "PRODUCTION_SUPABASE_PROJECT_REF", DEFAULT_PROJECT_REF).trim();
  const confirmation = getConfigValue(args, "confirm-project-ref", "CONFIRM_PRODUCTION_PROJECT_REF");
  const execute = isEnabled(args.get("execute") ?? process.env.RESET_GUEST_EXECUTE);
  const linkedProjectRef = readLinkedProjectRef();

  if (linkedProjectRef !== projectRef) {
    throw new Error(
      `Refusing to run. Supabase CLI is linked to ${linkedProjectRef}, expected ${projectRef}. Run supabase link --project-ref ${projectRef}.`,
    );
  }

  if (execute && confirmation !== projectRef) {
    throw new Error(
      `Refusing execute. Set CONFIRM_PRODUCTION_PROJECT_REF=${projectRef} or pass --confirm-project-ref ${projectRef}.`,
    );
  }

  const summary = firstRow(runSupabaseQuery(buildPreviewSql({ fullName, weddingId })));
  printPreview(summary);
  assertPreviewIsExecutable(summary);

  const [match] = summary.active_invited_matches;

  if (!execute) {
    console.log("Dry run only. Re-run with --execute and CONFIRM_PRODUCTION_PROJECT_REF to apply.");
    return;
  }

  const resetResult = firstRow(runSupabaseQuery(buildExecuteSql({ fullName, guestId: match.id, weddingId })));
  const affectedBlastIds = normalizeUuidArray(resetResult.affected_invite_sms_blast_ids);
  let deletedEmptyBlastCount = 0;

  const deleteEmptyBlastsSql = buildDeleteEmptyInviteSmsBlastsSql({ blastIds: affectedBlastIds, weddingId });
  if (deleteEmptyBlastsSql) {
    deletedEmptyBlastCount = runSupabaseQuery(deleteEmptyBlastsSql).length;
  }

  const verification = firstRow(runSupabaseQuery(buildVerificationSql({ guestId: match.id, weddingId })));
  assertVerificationPassed(verification);

  console.log("Reset applied:");
  console.log(`  guest: ${match.full_name} (${match.id})`);
  console.log(`  invite_status: ${resetResult.invite_status}`);
  console.log(`  rsvp_status: ${resetResult.rsvp_status}`);
  console.log(`  invalidated invited guest tokens: ${resetResult.invalidated_invited_guest_token_count}`);
  console.log(`  deleted RSVP responses: ${resetResult.deleted_rsvp_response_count}`);
  console.log(`  deleted guest navigation sessions: ${resetResult.deleted_guest_navigation_session_count}`);
  console.log(`  deleted Invite SMS deliveries: ${resetResult.deleted_invite_sms_delivery_count}`);
  console.log(`  deleted empty Invite SMS blasts: ${deletedEmptyBlastCount}`);
  console.log(`  archived tied RSVP-managed plus-ones: ${resetResult.archived_tied_rsvp_plus_one_count}`);
  console.log(`  invalidated tied plus-one tokens: ${resetResult.invalidated_tied_plus_one_token_count}`);
  console.log(`  sms_opt_in preserved: ${resetResult.sms_opt_in_preserved}`);
  console.log(`  plus_one_allowed preserved: ${resetResult.plus_one_allowed_preserved}`);
  console.log("Post-reset verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
