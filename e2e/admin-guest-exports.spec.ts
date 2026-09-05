import { expect, test } from "@playwright/test";
import {
  buildAdminGuestRosterRows,
  type AdminGuestRosterGuestRow,
} from "../lib/admin-guest-roster";
import { matchesAdminGuestRosterFilters } from "../lib/admin-guest-roster-filters";
import {
  buildCateringSummary,
  cateringText,
  csvDocument,
  GUEST_EXPORT_FIELDS,
  RSVP_EXPORT_FIELDS,
  rawGuestCsv,
  rawGuestExport,
  type ExportGuest,
  type ExportRsvp,
} from "../lib/admin-guest-export";

function guest(id: string, overrides: Partial<ExportGuest> = {}): ExportGuest {
  return {
    id,
    wedding_id: "wedding",
    full_name: id,
    email: "private@example.test",
    phone: "+46700000000",
    notes: "PRIVATE NOTE",
    guest_kind: "invited",
    invited_guest_id: null,
    rsvp_managed: false,
    invite_status: "opened",
    rsvp_status: "rsvp yes",
    plus_one_allowed: false,
    sms_opt_in: false,
    sms_opted_in_at: null,
    sms_opted_out_at: null,
    deleted_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}
function response(id: string, overrides: Partial<ExportRsvp> = {}): ExportRsvp {
  return {
    guest_id: id,
    attendance: "yes",
    extra_guests: 0,
    food_preference: null,
    allergy_notes: null,
    plus_one_name: null,
    plus_one_email: null,
    plus_one_phone: null,
    plus_one_food_preference: null,
    plus_one_allergy_notes: null,
    plus_one_sms_opt_in: false,
    plus_one_sms_opted_in_at: null,
    plus_one_sms_opted_out_at: null,
    last_submitted_at: "2026-01-01",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

test("CSV escapes Swedish text, quotes, newlines, and spreadsheet formulas; raw JSON stays lossless", () => {
  const data = {
    guests: [
      guest("=SUM(1,2)", { notes: 'Åsa, "hej"\nny rad' }),
      guest("archived", { deleted_at: "2026-01-01" }),
    ],
    responses: [],
  };
  const csv = rawGuestCsv(data);
  expect(csv.startsWith('\uFEFF"id"')).toBe(true);
  expect(csv).toContain('"\'=SUM(1,2)"');
  expect(csv).toContain('"\'+46700000000"');
  expect(csv).toContain('"Åsa, ""hej""\nny rad"');
  expect(csv).not.toContain("archived");
  expect(rawGuestExport(data)[0].full_name).toBe("=SUM(1,2)");
  expect(rawGuestExport(data)[0].notes).toBe('Åsa, "hej"\nny rad');
  expect(
    csvDocument(["name"], [["  =1"], ["\t@SUM(1)"], ["-1"], ["+1"]]),
  ).toContain('"\'  =1"');
  expect([...GUEST_EXPORT_FIELDS, ...RSVP_EXPORT_FIELDS].join(" ")).not.toMatch(
    /token|session|secret/,
  );
});

test("catering counts people once, includes historical +1, excludes declined and archived, preserves dietary wording", () => {
  const data = {
    guests: [
      guest("Ada"),
      guest("Companion", { guest_kind: "plus_one", invited_guest_id: "Ada" }),
      guest("Legacy"),
      guest("Declined", { rsvp_status: "rsvp no" }),
      guest("Maybe", { rsvp_status: "rsvp maybe" }),
      guest("Unanswered", { rsvp_status: "not replied" }),
      guest("Archived", { deleted_at: "2026-01-01" }),
    ],
    responses: [
      response("Ada", {
        extra_guests: 1,
        food_preference: " Vegan ",
        allergy_notes: "Nötter, även spår",
        plus_one_food_preference: "vegan",
        plus_one_allergy_notes: "Laktos",
      }),
      response("Legacy", {
        extra_guests: 1,
        plus_one_name: "Historisk +1",
        plus_one_allergy_notes: "Ägg",
      }),
      response("Declined", { allergy_notes: "EXCLUDE" }),
    ],
  };
  const summary = buildCateringSummary(data);
  expect(summary.people).toHaveLength(4);
  expect(summary.food).toEqual([{ text: "Vegan", count: 2 }]);
  expect(summary.allergies).toContainEqual({
    text: "Nötter, även spår",
    count: 1,
  });
  expect(summary.withDietary).toBe(3);
  expect(summary.withoutDietary).toBe(1);
  expect(summary.warnings).toHaveLength(1);
  const text = cateringText(summary);
  expect(text).toContain("Historisk +1");
  expect(text).not.toMatch(
    /PRIVATE NOTE|private@example|467000|EXCLUDE|Declined|Archived|Maybe|Unanswered/,
  );
});

test("catering does not resurrect an archived +1 from stale RSVP details", () => {
  const summary = buildCateringSummary({
    guests: [
      guest("Ada"),
      guest("Old Companion", {
        guest_kind: "plus_one",
        invited_guest_id: "Ada",
        deleted_at: "2026-01-01",
      }),
    ],
    responses: [response("Ada", { extra_guests: 1 })],
  });
  expect(summary.people).toHaveLength(1);
  expect(summary.warnings).toHaveLength(1);
});

test("filters combine dietary OR, kind, search, and consistent unanswered/opened status", () => {
  const base: AdminGuestRosterGuestRow = {
    id: "guest",
    full_name: "Åsa",
    email: "asa@example.test",
    phone: null,
    notes: "Fönsterbord",
    guest_kind: "invited",
    invited_guest_id: null,
    rsvp_managed: false,
    invite_status: "opened",
    rsvp_status: "not replied",
    sms_opt_in: false,
    plus_one_allowed: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
  const row = buildAdminGuestRosterRows({
    guestRows: [base],
    activeInviteTokenRows: [],
    tiedInvitedGuests: [],
    rsvpResponses: [
      {
        guest_id: "guest",
        food_preference: null,
        allergy_notes: "Nötter",
        extra_guests: 0,
        plus_one_food_preference: null,
        plus_one_allergy_notes: null,
        last_submitted_at: null,
      },
    ],
  })[0];
  expect(
    matchesAdminGuestRosterFilters(row, {
      query: "nötter fönsterbord",
      status: "opened",
      dietary: "any",
      kind: "invited",
    }),
  ).toBe(true);
  expect(
    matchesAdminGuestRosterFilters(row, { query: "", status: "not replied" }),
  ).toBe(false);
  expect(
    matchesAdminGuestRosterFilters(
      { ...row, rsvpStatus: "rsvp yes" },
      { query: "", status: "opened" },
    ),
  ).toBe(false);
  expect(
    matchesAdminGuestRosterFilters(row, {
      query: "",
      status: "",
      dietary: "allergy",
    }),
  ).toBe(true);
  expect(
    matchesAdminGuestRosterFilters(row, {
      query: "",
      status: "",
      dietary: "food",
    }),
  ).toBe(false);
  expect(
    matchesAdminGuestRosterFilters(row, {
      query: "",
      status: "",
      dietary: "none",
    }),
  ).toBe(false);
  expect(
    matchesAdminGuestRosterFilters(row, {
      query: "",
      status: "",
      kind: "plus_one",
    }),
  ).toBe(false);
});
