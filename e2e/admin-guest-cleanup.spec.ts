import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadAdminGuestRoster } from "../lib/admin-guest-roster";
import { saveAdminGuestRosterSession } from "../lib/admin-guest-roster-session";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { requireEnv } from "./support/env";
import { signInAsSeededAdmin } from "./support/auth";
import {
  guestRowByName,
  guestMetadataRowByName,
  uniqueGuestName,
} from "./support/admin-guests";
import { testWithGuests as test } from "./support/fixtures";
import { SEEDED_ADMIN, SEEDED_WEDDING_ID } from "./support/test-data";

async function fixture() {
  const db = createE2eSupabaseAdminClient();
  const name = uniqueGuestName("Cleanup Parent");
  const companionName = uniqueGuestName("Cleanup Companion");
  const parent = await db
    .from("guests")
    .insert({
      wedding_id: SEEDED_WEDDING_ID,
      full_name: name,
      email: "cleanup@example.test",
      notes: "Private catering exclusion",
      plus_one_allowed: true,
      invite_status: "opened",
      rsvp_status: "rsvp yes",
    })
    .select()
    .single();
  if (parent.error) throw parent.error;
  const companion = await db
    .from("guests")
    .insert({
      wedding_id: SEEDED_WEDDING_ID,
      full_name: companionName,
      guest_kind: "plus_one",
      invited_guest_id: parent.data.id,
      rsvp_managed: true,
      rsvp_status: "rsvp yes",
    })
    .select()
    .single();
  if (companion.error) throw companion.error;
  const response = await db.from("rsvp_responses").insert({
    wedding_id: SEEDED_WEDDING_ID,
    guest_id: parent.data.id,
    attendance: "yes",
    extra_guests: 1,
    food_preference: "Vegan cleanup",
    allergy_notes: "Nötter cleanup",
    plus_one_name: companionName,
    plus_one_allergy_notes: "Ägg cleanup",
  });
  if (response.error) throw response.error;
  return {
    db,
    parent: parent.data,
    companion: companion.data,
    name,
    companionName,
  };
}
async function adminClient() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword(SEEDED_ADMIN);
  if (error) throw error;
  return client;
}

test("desktop and mobile: filter dietary details, edit +1 notes, save shared RSVP, download private-safe catering", async ({
  page,
}) => {
  const { db, parent, companion, name, companionName } = await fixture();
  await signInAsSeededAdmin(page);
  await page.goto(`/admin/guests?q=${encodeURIComponent("Ägg cleanup")}`);
  await expect(
    page.getByLabel(`Namn ${companionName}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(`Namn ${name}`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Rensa filter", exact: true }).click();
  await expect(page.getByLabel(`Namn ${name}`, { exact: true })).toBeVisible();
  await page.getByLabel("Sök", { exact: false }).fill("cleanup");
  await page
    .getByLabel("Mat och allergier", { exact: true })
    .selectOption("any");
  await expect(page.getByText("Visar 2 av", { exact: false })).toBeVisible();
  await page.getByLabel("Gästtyp", { exact: true }).selectOption("plus_one");
  const plusRow = await guestRowByName(page, companionName);
  await expect(plusRow.getByLabel(`Namn ${companionName}`)).toHaveAttribute(
    "readonly",
    "",
  );
  const meta = await guestMetadataRowByName(page, companionName);
  await expect(meta.getByText("Tar med +1:", { exact: false })).toHaveCount(0);
  await plusRow.getByRole("button", { name: "Detaljer", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await meta
    .getByLabel(`Notering ${companionName}`)
    .fill("Edited companion note");
  await page
    .getByRole("button", { name: "Spara ändringar", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Sparade 1 gäst.");
  await expect(page.getByTestId("roster-save-feedback")).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByTestId("roster-save-feedback")).toContainText(
    "Sparade 1 gäst.",
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    (await db.from("guests").select("notes").eq("id", companion.id).single())
      .data?.notes,
  ).toBe("Edited companion note");
  await page.getByRole("button", { name: "Rensa filter", exact: true }).click();
  await page.getByLabel(`OSA ${name}`, { exact: true }).selectOption("rsvp no");
  await page
    .getByRole("button", { name: "Spara ändringar", exact: true })
    .click();
  await expect(
    page.getByLabel(`OSA ${companionName}`, { exact: true }),
  ).toHaveValue("rsvp no");
  expect(
    (
      await db
        .from("rsvp_responses")
        .select("attendance, food_preference, plus_one_allergy_notes")
        .eq("guest_id", parent.id)
        .single()
    ).data,
  ).toMatchObject({
    attendance: "no",
    food_preference: "Vegan cleanup",
    plus_one_allergy_notes: "Ägg cleanup",
  });
  await page
    .getByLabel(`OSA ${name}`, { exact: true })
    .selectOption("rsvp yes");
  await page
    .getByRole("button", { name: "Spara ändringar", exact: true })
    .click();
  await expect(
    page.getByLabel(`OSA ${companionName}`, { exact: true }),
  ).toHaveValue("rsvp yes");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel(`Namn ${name}`, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const parentRow = await guestRowByName(page, name);
  await parentRow.getByRole("button", { name: /Detaljer/ }).click();
  await expect(
    page.getByLabel(`Notering ${name}`, { exact: true }),
  ).toBeEditable();
  await page
    .getByRole("link", { name: "Cateringunderlag", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cateringunderlag", exact: true }),
  ).toBeVisible();
  const textDownload = await page.request.get(
    "/admin/guests/export?kind=catering&format=txt",
  );
  expect(textDownload.status()).toBe(200);
  expect(textDownload.headers()["cache-control"]).toContain("no-store");
  const text = await textDownload.text();
  expect(text).toContain(companionName);
  expect(text).toContain("Ägg cleanup");
  expect(text).not.toMatch(
    /Private catering exclusion|Edited companion note|cleanup@example/,
  );
  const cateringCsv = await page.request.get(
    "/admin/guests/export?kind=catering&format=csv",
  );
  expect(await cateringCsv.text()).toContain('"Ej angivet","Ägg cleanup"');
  const json = await page.request.get("/admin/guests/export?format=json");
  const jsonText = await json.text();
  expect(jsonText).toContain("Private catering exclusion");
  expect(jsonText).not.toMatch(/token_hash|updated_via_token_id/);
  const csv = await page.request.get("/admin/guests/export?format=csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  expect(await csv.text()).toContain("effective_allergy_notes");
});

test("RPC atomically validates scope, stale rows, managed fields; notes and RSVP keep response details", async () => {
  const { db, parent, companion } = await fixture();
  const admin = await adminClient();
  const companionChange = {
    rowKey: companion.id,
    id: companion.id,
    expectedUpdatedAt: companion.updated_at,
    values: {
      fullName: companion.full_name,
      email: null,
      phone: null,
      notes: "Admin only",
      plusOneAllowed: false,
      smsOptIn: false,
    },
  };
  const forged = await saveAdminGuestRosterSession({
    weddingId: SEEDED_WEDDING_ID,
    rpcAdapter: admin,
    changes: [
      {
        ...companionChange,
        values: { ...companionChange.values, fullName: "Hijacked" },
      },
    ],
  });
  expect(forged.status).toBe("validation-error");
  const stale = await saveAdminGuestRosterSession({
    weddingId: SEEDED_WEDDING_ID,
    rpcAdapter: admin,
    changes: [
      companionChange,
      {
        rowKey: parent.id,
        id: parent.id,
        expectedUpdatedAt: "2000-01-01",
        values: {
          fullName: parent.full_name,
          email: parent.email,
          phone: null,
          notes: null,
          plusOneAllowed: true,
          smsOptIn: false,
          rsvpStatus: "rsvp no",
        },
      },
    ],
  });
  expect(stale.status).toBe("validation-error");
  expect(
    (await db.from("guests").select("notes").eq("id", companion.id).single())
      .data?.notes,
  ).toBeNull();
  const saved = await saveAdminGuestRosterSession({
    weddingId: SEEDED_WEDDING_ID,
    rpcAdapter: admin,
    changes: [companionChange],
  });
  expect(saved.status).toBe("success");
  const forbidden = await admin.rpc("save_admin_guest_roster_session", {
    p_wedding_id: "99999999-0000-0000-0000-000000000001",
    p_changes: [],
  });
  expect(forbidden.error?.code).toBe("42501");
  const anonymous = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false } },
  );
  expect(
    (
      await anonymous.rpc("save_admin_guest_roster_session", {
        p_wedding_id: SEEDED_WEDDING_ID,
        p_changes: [],
      })
    ).error,
  ).not.toBeNull();
  await admin.auth.signOut();
});

test("raw exports paginate beyond 1000 guests and reject unauthenticated downloads", async ({
  page,
  request,
}) => {
  const anonymous = await request.get("/admin/guests/export?format=json");
  expect(anonymous.url()).toContain("/admin/login");
  const db = createE2eSupabaseAdminClient();
  const prefix = uniqueGuestName("Paged export");
  for (let offset = 0; offset < 1005; offset += 200) {
    const { error } = await db.from("guests").insert(
      Array.from({ length: Math.min(200, 1005 - offset) }, (_, index) => ({
        wedding_id: SEEDED_WEDDING_ID,
        full_name: `${prefix} ${offset + index}`,
        email: "paged@example.test",
      })),
    );
    if (error) throw error;
  }
  const roster = await loadAdminGuestRoster({
    supabase: db,
    weddingId: SEEDED_WEDDING_ID,
    filters: { query: prefix, sort: "name", status: "" },
  });
  expect(roster.error).toBeNull();
  expect(roster.rows).toHaveLength(1005);
  await signInAsSeededAdmin(page);
  const response = await page.request.get("/admin/guests/export?format=json");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text.split(prefix).length - 1).toBe(1005);
  expect(
    (await page.request.get("/admin/guests/export?format=xml")).status(),
  ).toBe(400);
});
