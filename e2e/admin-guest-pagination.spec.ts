import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadGuestExportData,
  rawGuestExport,
  buildCateringSummary,
  type ExportGuest,
} from "../lib/admin-guest-export";
import { loadAdminGuestRoster } from "../lib/admin-guest-roster";

function guest(index: number): ExportGuest {
  return {
    id: `guest-${String(index).padStart(4, "0")}`,
    wedding_id: "wedding",
    full_name: `Guest ${index}`,
    email: "fixture@example.test",
    phone: null,
    notes: null,
    guest_kind: "invited",
    invited_guest_id: null,
    invite_status: "opened",
    rsvp_status: "rsvp yes",
    rsvp_managed: false,
    plus_one_allowed: false,
    sms_opt_in: false,
    sms_opted_in_at: null,
    sms_opted_out_at: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function changingDatabase(change: "insert" | "archive") {
  let guests = Array.from({ length: 201 }, (_, index) => guest(index + 1));
  let guestPages = 0;
  return {
    from(table: string) {
      let from = 0;
      let to = Infinity;
      let maximum = Infinity;
      const predicates: Array<(row: ExportGuest) => boolean> = [];
      const result = Promise.resolve().then(() => {
        if (table !== "guests") return { data: [], error: null };
        const data = guests
          .filter((row) => predicates.every((predicate) => predicate(row)))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(from, to + 1)
          .slice(0, maximum)
          .map((row) => ({ ...row }));
        if (++guestPages === 1) {
          if (change === "insert")
            guests = [
              ...guests,
              { ...guest(0), created_at: "2099-01-01T00:00:00Z" },
              { ...guest(202), created_at: "2099-01-01T00:00:00Z" },
            ];
          else
            guests = guests.map((row, index) =>
              index === 0
                ? { ...row, deleted_at: new Date().toISOString() }
                : row,
            );
        }
        return { data, error: null };
      });
      const query = Object.assign(result, {
        select() {
          return query;
        },
        order() {
          return query;
        },
        in() {
          return query;
        },
        eq(column: keyof ExportGuest, value: unknown) {
          predicates.push((row) => row[column] === value);
          return query;
        },
        is(column: keyof ExportGuest, value: unknown) {
          predicates.push((row) => row[column] === value);
          return query;
        },
        gt(column: keyof ExportGuest, value: string) {
          predicates.push((row) => typeof row[column] === "string" && String(row[column]) > value);
          return query;
        },
        lte(column: keyof ExportGuest, value: string) {
          predicates.push((row) => typeof row[column] === "string" && String(row[column]) <= value);
          return query;
        },
        range(start: number, end: number) {
          from = start;
          to = end;
          return query;
        },
        limit(count: number) {
          maximum = count;
          return query;
        },
      });
      return query;
    },
  };
}

test("inserts between pages cannot duplicate catering people or include post-cutoff guests", async () => {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Stateful fake exercises the real pagination loop.
  const supabase = changingDatabase("insert") as unknown as SupabaseClient;
  const data = await loadGuestExportData(supabase, "wedding");
  expect(rawGuestExport(data)).toHaveLength(201);
  expect(new Set(data.guests.map((row) => row.id)).size).toBe(201);
  expect(buildCateringSummary(data).people).toHaveLength(201);
  expect(data.guests.at(-1)?.id).toBe("guest-0201");
  expect(
    data.guests.some(
      (row) => row.id === "guest-0000" || row.id === "guest-0202",
    ),
  ).toBe(false);
});

test("archiving an earlier row cannot skip an unchanged roster guest on the next page", async () => {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Stateful fake exercises the real pagination loop.
  const supabase = changingDatabase("archive") as unknown as SupabaseClient;
  const roster = await loadAdminGuestRoster({
    supabase,
    weddingId: "wedding",
    filters: { query: "", sort: "name", status: "" },
  });
  expect(roster.error).toBeNull();
  expect(roster.rows).toHaveLength(201);
  expect(roster.rows.some((row) => row.id === "guest-0201")).toBe(true);
});
