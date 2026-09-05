import type { SupabaseClient } from "@supabase/supabase-js";
import { isNullableString, isRecord } from "./type-guards";

// Explicit allowlists: never export invite tokens, navigation sessions or auth data.
export const GUEST_EXPORT_FIELDS = [
  "id",
  "wedding_id",
  "full_name",
  "email",
  "phone",
  "notes",
  "guest_kind",
  "invited_guest_id",
  "rsvp_managed",
  "invite_status",
  "rsvp_status",
  "plus_one_allowed",
  "sms_opt_in",
  "sms_opted_in_at",
  "sms_opted_out_at",
  "deleted_at",
  "created_at",
  "updated_at",
] as const;
export const RSVP_EXPORT_FIELDS = [
  "guest_id",
  "attendance",
  "extra_guests",
  "food_preference",
  "allergy_notes",
  "plus_one_name",
  "plus_one_email",
  "plus_one_phone",
  "plus_one_food_preference",
  "plus_one_allergy_notes",
  "plus_one_sms_opt_in",
  "plus_one_sms_opted_in_at",
  "plus_one_sms_opted_out_at",
  "last_submitted_at",
  "created_at",
  "updated_at",
] as const;
export type ExportGuest = Record<
  (typeof GUEST_EXPORT_FIELDS)[number],
  string | boolean | null
> & {
  id: string;
  full_name: string;
  guest_kind: "invited" | "plus_one";
  invited_guest_id: string | null;
  rsvp_status: string;
  deleted_at: string | null;
};
export type ExportRsvp = Record<
  (typeof RSVP_EXPORT_FIELDS)[number],
  string | boolean | number | null
> & {
  guest_id: string;
  extra_guests: number;
  food_preference: string | null;
  allergy_notes: string | null;
  plus_one_name: string | null;
  plus_one_food_preference: string | null;
  plus_one_allergy_notes: string | null;
};
export type GuestExportData = {
  guests: ExportGuest[];
  responses: ExportRsvp[];
};
function isExportGuest(value: unknown): value is ExportGuest {
  return (
    isRecord(value) &&
    GUEST_EXPORT_FIELDS.every(
      (field) =>
        field in value &&
        (isNullableString(value[field]) || typeof value[field] === "boolean"),
    ) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    (value.guest_kind === "invited" || value.guest_kind === "plus_one") &&
    isNullableString(value.invited_guest_id) &&
    isNullableString(value.deleted_at) &&
    typeof value.rsvp_status === "string"
  );
}
function isExportRsvp(value: unknown): value is ExportRsvp {
  return (
    isRecord(value) &&
    RSVP_EXPORT_FIELDS.every(
      (field) =>
        field in value &&
        (isNullableString(value[field]) ||
          typeof value[field] === "boolean" ||
          typeof value[field] === "number"),
    ) &&
    typeof value.guest_id === "string" &&
    typeof value.extra_guests === "number" &&
    isNullableString(value.food_preference) &&
    isNullableString(value.allergy_notes) &&
    isNullableString(value.plus_one_name) &&
    isNullableString(value.plus_one_food_preference) &&
    isNullableString(value.plus_one_allergy_notes)
  );
}
export async function loadGuestExportData(
  supabase: SupabaseClient,
  weddingId: string,
): Promise<GuestExportData> {
  const guests: ExportGuest[] = [];
  const responses: ExportRsvp[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase
      .from("guests")
      .select(GUEST_EXPORT_FIELDS.join(","))
      .eq("wedding_id", weddingId)
      .order("id")
      .range(offset, offset + 199);
    if (error) throw error;
    const page: unknown = data;
    if (!Array.isArray(page) || !page.every(isExportGuest))
      throw new Error("Invalid guest export data");
    guests.push(...page);
    if (page.length < 200) break;
  }
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase
      .from("rsvp_responses")
      .select(RSVP_EXPORT_FIELDS.join(","))
      .eq("wedding_id", weddingId)
      .order("guest_id")
      .range(offset, offset + 199);
    if (error) throw error;
    const page: unknown = data;
    if (!Array.isArray(page) || !page.every(isExportRsvp))
      throw new Error("Invalid RSVP export data");
    responses.push(...page);
    if (page.length < 200) break;
  }
  return { guests, responses };
}
export function rawGuestExport(data: GuestExportData) {
  const responses = new Map(
    data.responses.map((response) => [response.guest_id, response]),
  );
  return data.guests
    .filter((guest) => guest.deleted_at === null)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "sv"))
    .map((guest) => ({ ...guest, rsvp: responses.get(guest.id) ?? null }));
}

/** RFC 4180 + UTF-8 BOM for Excel. JSON remains the lossless raw format. */
export function csvDocument(headers: readonly string[], rows: unknown[][]) {
  function cell(value: unknown) {
    if (
      value !== null &&
      value !== undefined &&
      !["string", "number", "boolean"].includes(typeof value)
    )
      throw new Error("Invalid CSV cell");
    const raw =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : "";
    // A quoted CSV value can still be executed by spreadsheets. Neutralize formulas,
    // including leading whitespace/control characters and international phone numbers.
    const safe =
      /^[\s\p{Cc}]*[=+@-]/u.test(raw) || /^[\t\r\n]/u.test(raw)
        ? `'${raw}`
        : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
export function rawGuestCsv(data: GuestExportData) {
  const responses = new Map(
    data.responses.map((response) => [response.guest_id, response]),
  );
  return csvDocument(
    [
      ...GUEST_EXPORT_FIELDS,
      ...RSVP_EXPORT_FIELDS.map((field) => `rsvp_${field}`),
      "effective_food_preference",
      "effective_allergy_notes",
    ],
    rawGuestExport(data).map((guest) => {
      const own = guest.rsvp;
      const parent = guest.invited_guest_id
        ? responses.get(guest.invited_guest_id)
        : undefined;
      return [
        ...GUEST_EXPORT_FIELDS.map((field) => guest[field]),
        ...RSVP_EXPORT_FIELDS.map((field) => own?.[field] ?? null),
        guest.guest_kind === "plus_one"
          ? parent?.plus_one_food_preference
          : own?.food_preference,
        guest.guest_kind === "plus_one"
          ? parent?.plus_one_allergy_notes
          : own?.allergy_notes,
      ];
    }),
  );
}

export type CateringPerson = {
  name: string;
  invitedBy: string | null;
  food: string | null;
  allergy: string | null;
};
function groupNotes(people: CateringPerson[], field: "food" | "allergy") {
  const groups = new Map<string, { text: string; count: number }>();
  for (const person of people) {
    const text = person[field]?.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("sv");
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { text, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text, "sv"),
  );
}
export function buildCateringSummary(data: GuestExportData) {
  const guests = new Map(data.guests.map((guest) => [guest.id, guest]));
  const responses = new Map(
    data.responses.map((response) => [response.guest_id, response]),
  );
  const people: CateringPerson[] = [];
  const warnings: string[] = [];
  for (const guest of data.guests) {
    if (guest.deleted_at !== null || guest.rsvp_status !== "rsvp yes") continue;
    const parent = guest.invited_guest_id
      ? guests.get(guest.invited_guest_id)
      : undefined;
    const response = responses.get(parent?.id ?? guest.id);
    people.push({
      name: guest.full_name,
      invitedBy: parent?.full_name ?? null,
      food: parent
        ? (response?.plus_one_food_preference ?? null)
        : (response?.food_preference ?? null),
      allergy: parent
        ? (response?.plus_one_allergy_notes ?? null)
        : (response?.allergy_notes ?? null),
    });
    if (
      guest.guest_kind === "invited" &&
      response &&
      response.extra_guests > 0
    ) {
      const companions = data.guests.filter(
        (candidate) => candidate.invited_guest_id === guest.id,
      );
      if (companions.length === 0) {
        // Historical RSVP rows predate automatic +1 Guest sync. Count them once,
        // retaining supplied dietary text even when there is no Guest row.
        for (let index = 0; index < response.extra_guests; index++) {
          people.push({
            name:
              index === 0 && response.plus_one_name
                ? response.plus_one_name
                : `Ej namngiven +1 (${guest.full_name})`,
            invitedBy: guest.full_name,
            food: index === 0 ? response.plus_one_food_preference : null,
            allergy: index === 0 ? response.plus_one_allergy_notes : null,
          });
        }
        warnings.push(
          `${guest.full_name}: ${response.extra_guests} medföljande från äldre OSA ingår, men saknar egen aktiv gästrad. Kontrollera namn och matuppgifter.`,
        );
      } else if (
        companions.filter(
          (candidate) =>
            candidate.deleted_at === null &&
            candidate.rsvp_status === "rsvp yes",
        ).length !== response.extra_guests
      ) {
        warnings.push(
          `${guest.full_name}: antal medföljande i OSA stämmer inte med aktiva gäster som tackat ja. Endast aktiva ja-svar räknas.`,
        );
      }
    }
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return {
    people,
    warnings,
    food: groupNotes(people, "food"),
    allergies: groupNotes(people, "allergy"),
    withDietary: people.filter(
      (person) => person.food?.trim() || person.allergy?.trim(),
    ).length,
    withoutDietary: people.filter(
      (person) => !person.food?.trim() && !person.allergy?.trim(),
    ).length,
  };
}
export function cateringText(summary: ReturnType<typeof buildCateringSummary>) {
  return [
    "CATERINGUNDERLAG",
    "Endast aktiva gäster som tackat ja, inklusive medföljande. Dagens sparade uppgifter.",
    `Antal personer: ${summary.people.length}`,
    `Med mat-/allergiuppgifter: ${summary.withDietary}`,
    `Utan mat-/allergiuppgifter: ${summary.withoutDietary}`,
    "Ej angivet betyder inte allergifri. Gästernas fritext återges utan medicinsk tolkning.",
    "",
    "MATPREFERENSER (antal personer per exakt uppgift)",
    ...summary.food.map((group) => `${group.count} × ${group.text}`),
    "",
    "ALLERGIER (antal personer per exakt uppgift)",
    ...summary.allergies.map((group) => `${group.count} × ${group.text}`),
    "",
    "PERSONLISTA",
    ...summary.people.map(
      (person) =>
        `${person.name}${person.invitedBy ? ` (+1 till ${person.invitedBy})` : ""}\n  Mat: ${person.food || "Ej angivet"}\n  Allergier: ${person.allergy || "Ej angivet"}`,
    ),
    ...(summary.warnings.length
      ? ["", "KONTROLLERA INNAN BESTÄLLNING", ...summary.warnings]
      : []),
    "",
  ].join("\n");
}
