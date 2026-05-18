import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildAdminGuestRosterRows,
  loadAdminGuestRoster,
  normalizeAdminGuestRosterFilters,
  type AdminGuestRosterGuestRow,
  type AdminGuestRosterRsvpResponseRow,
} from "../lib/admin-guest-roster";

type FakeQueryResult = {
  data: unknown[];
  error: object | null;
};

type FakeOperation = {
  args: unknown[];
  name: string;
};

type FakeQuery = Promise<FakeQueryResult> & {
  eq(column: string, value: unknown): FakeQuery;
  in(column: string, values: readonly string[]): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  limit(count: number): FakeQuery;
  operations: FakeOperation[];
  or(filter: string): FakeQuery;
  order(column: string, options?: { ascending?: boolean }): FakeQuery;
  select(columns: string): FakeQuery;
  table: string;
};

function createFakeQuery(table: string, result: FakeQueryResult): FakeQuery {
  const operations: FakeOperation[] = [];
  const query: FakeQuery = Object.assign(Promise.resolve(result), {
    eq(column: string, value: unknown) {
      operations.push({ args: [column, value], name: "eq" });
      return query;
    },
    "in"(column: string, values: readonly string[]) {
      operations.push({ args: [column, values], name: "in" });
      return query;
    },
    is(column: string, value: unknown) {
      operations.push({ args: [column, value], name: "is" });
      return query;
    },
    limit(count: number) {
      operations.push({ args: [count], name: "limit" });
      return query;
    },
    operations,
    or(filter: string) {
      operations.push({ args: [filter], name: "or" });
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      operations.push({ args: options ? [column, options] : [column], name: "order" });
      return query;
    },
    select(columns: string) {
      operations.push({ args: [columns], name: "select" });
      return query;
    },
    table,
  });

  return query;
}

class FakeSupabase {
  readonly queries: FakeQuery[] = [];

  constructor(private readonly results: FakeQueryResult[]) {}

  from(table: string) {
    const query = createFakeQuery(
      table,
      this.results[this.queries.length] ?? { data: [], error: null },
    );
    this.queries.push(query);
    return { select: (columns: string) => query.select(columns) };
  }
}

function guestRow(overrides: Partial<AdminGuestRosterGuestRow> = {}): AdminGuestRosterGuestRow {
  return {
    created_at: "2026-05-18T08:00:00.000Z",
    email: "guest@example.com",
    full_name: "Test Guest",
    guest_kind: "invited",
    id: "guest-1",
    invite_status: "not replied",
    invited_guest_id: null,
    notes: null,
    phone: "+46700000001",
    plus_one_allowed: false,
    rsvp_managed: false,
    rsvp_status: "not replied",
    sms_opt_in: false,
    ...overrides,
  };
}

function rsvpResponseRow(
  overrides: Partial<AdminGuestRosterRsvpResponseRow> = {},
): AdminGuestRosterRsvpResponseRow {
  return {
    allergy_notes: "No nuts",
    extra_guests: 1,
    food_preference: "Fish",
    guest_id: "guest-1",
    last_submitted_at: "2026-05-18T10:00:00.000Z",
    plus_one_allergy_notes: "No almonds",
    plus_one_food_preference: "Vegetarian",
    ...overrides,
  };
}

test.describe("Admin Guest roster", () => {
  test("normalizes search params for the page Adapter", () => {
    expect(
      normalizeAdminGuestRosterFilters({
        q: ["  Ada  "],
        sort: "newest",
        status: "rsvp yes",
      }),
    ).toEqual({ query: "Ada", sort: "newest", status: "rsvp yes" });

    expect(
      normalizeAdminGuestRosterFilters({
        q: undefined,
        sort: "unknown",
        status: "deleted",
      }),
    ).toEqual({ query: "", sort: "name", status: "" });
  });

  test("loads rows with scoped filters and enrichment queries", async () => {
    const supabase = new FakeSupabase([
      {
        data: [
          guestRow({
            full_name: "Plus One Guest",
            guest_kind: "plus_one",
            id: "plus-one-1",
            invite_status: "opened",
            invited_guest_id: "invited-1",
            rsvp_managed: true,
          }),
        ],
        error: null,
      },
      { data: [{ guest_id: "plus-one-1" }], error: null },
      { data: [rsvpResponseRow({ guest_id: "invited-1" })], error: null },
      { data: [{ full_name: "Invited Guest", id: "invited-1" }], error: null },
    ]);
    const filters = normalizeAdminGuestRosterFilters({
      q: "Plus%_",
      sort: "status",
      status: "opened",
    });

    const result = await loadAdminGuestRoster({
      filters,
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Fake Supabase exercises loader query wiring.
      supabase: supabase as unknown as SupabaseClient,
      weddingId: "wedding-1",
    });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      fullName: "Plus One Guest",
      hasActiveToken: true,
      rsvpDetails: {
        allergyNotes: "No almonds",
        foodPreference: "Vegetarian",
      },
      tiedInvitedGuestText: "Tied to Invited Guest",
    });
    expect(supabase.queries.map((query) => query.table)).toEqual([
      "guests",
      "invite_tokens",
      "rsvp_responses",
      "guests",
    ]);
    expect(supabase.queries[0]?.operations).toEqual(
      expect.arrayContaining([
        { args: ["wedding_id", "wedding-1"], name: "eq" },
        { args: ["deleted_at", null], name: "is" },
        {
          args: ["full_name.ilike.%Plus\\%\\_%,phone.ilike.%Plus\\%\\_%"],
          name: "or",
        },
        { args: ["invite_status", "opened"], name: "eq" },
        { args: ["rsvp_status", "not replied"], name: "eq" },
        { args: ["rsvp_status", { ascending: true }], name: "order" },
        { args: ["invite_status", { ascending: true }], name: "order" },
        { args: ["full_name"], name: "order" },
      ]),
    );
    expect(supabase.queries[2]?.operations).toContainEqual({
      args: ["guest_id", ["plus-one-1", "invited-1"]],
      name: "in",
    });
  });

  test("projects Plus-one Guest RSVP details from tied Invited Guest RSVP", () => {
    const rows = buildAdminGuestRosterRows({
      activeInviteTokenRows: [{ guest_id: "plus-one-1" }],
      guestRows: [
        guestRow({
          full_name: "Invited Guest",
          id: "invited-1",
          plus_one_allowed: true,
          rsvp_status: "rsvp yes",
        }),
        guestRow({
          email: "plus-one@example.com",
          full_name: "Plus One Guest",
          guest_kind: "plus_one",
          id: "plus-one-1",
          invited_guest_id: "invited-1",
          phone: "+46700000002",
          rsvp_managed: true,
          rsvp_status: "rsvp yes",
          sms_opt_in: true,
        }),
      ],
      rsvpResponses: [rsvpResponseRow({ guest_id: "invited-1" })],
      tiedInvitedGuests: [{ full_name: "Invited Guest", id: "invited-1" }],
    });

    const invitedGuest = rows.find((row) => row.id === "invited-1");
    const plusOneGuest = rows.find((row) => row.id === "plus-one-1");

    expect(invitedGuest?.rsvpDetails).toMatchObject({
      allergyNotes: "No nuts",
      extraGuests: 1,
      foodPreference: "Fish",
    });
    expect(invitedGuest).toMatchObject({
      canEditIdentity: true,
      canEditPlusOneAllowed: true,
      canSave: true,
      guestKindLabel: "Invited Guest",
      inviteAccessScope: "full",
      rsvpStatusLabel: "rsvp yes",
      tiedInvitedGuestText: null,
    });

    expect(plusOneGuest).toMatchObject({
      canEditIdentity: false,
      canEditPlusOneAllowed: false,
      canEditSmsOptIn: false,
      canSave: false,
      guestKindLabel: "Plus-one Guest",
      hasActiveToken: true,
      inviteAccessScope: "scoped",
      rsvpStatusLabel: "rsvp yes",
      tiedInvitedGuestText: "Tied to Invited Guest",
    });
    expect(plusOneGuest?.rsvpDetails).toMatchObject({
      allergyNotes: "No almonds",
      extraGuests: 1,
      foodPreference: "Vegetarian",
    });
    expect(plusOneGuest?.rsvpDetails?.submittedAtLabel).toEqual(expect.any(String));
  });
});
