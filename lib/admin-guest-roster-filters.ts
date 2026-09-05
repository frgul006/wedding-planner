import type {
  AdminGuestRosterFilters,
  AdminGuestRosterRow,
} from "./admin-guest-roster";

export type DietaryFilter = "" | "any" | "allergy" | "food" | "none";
export type GuestKindFilter = "" | "invited" | "plus_one";

export function matchesAdminGuestRosterFilters(
  row: AdminGuestRosterRow,
  filters: Pick<AdminGuestRosterFilters, "query" | "status"> & {
    dietary?: DietaryFilter;
    kind?: GuestKindFilter;
  },
) {
  const food = row.rsvpDetails?.foodPreference?.trim() ?? "";
  const allergy = row.rsvpDetails?.allergyNotes?.trim() ?? "";
  const searchable = [
    row.fullName,
    row.email,
    row.phone,
    row.notes,
    food,
    allergy,
    row.guestKindLabel,
    row.tiedInvitedGuestText,
  ]
    .join(" ")
    .toLocaleLowerCase("sv");
  if (
    !filters.query
      .trim()
      .toLocaleLowerCase("sv")
      .split(/\s+/)
      .every((word) => searchable.includes(word))
  )
    return false;
  if (filters.kind && row.guestKind !== filters.kind) return false;
  if (filters.dietary === "any" && !food && !allergy) return false;
  if (filters.dietary === "allergy" && !allergy) return false;
  if (filters.dietary === "food" && !food) return false;
  if (filters.dietary === "none" && (food || allergy)) return false;
  if (!filters.status) return true;
  if (filters.status === "not replied" || filters.status === "opened") {
    return (
      row.inviteStatus === filters.status && row.rsvpStatus === "not replied"
    );
  }
  return row.rsvpStatus === filters.status;
}
