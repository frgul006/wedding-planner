"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";

import type {
  AdminGuestRosterFilters,
  AdminGuestRosterRow,
} from "@/lib/admin-guest-roster";
import type {
  AdminGuestRosterSessionChange,
  AdminGuestRosterSessionErrors,
  AdminGuestRosterSessionValues,
} from "@/lib/admin-guest-roster-session";

import {
  archiveSelectedGuestsAction,
  saveGuestRosterSessionAction,
} from "./actions";
import { InviteLinkButton } from "./invite-link-button";

const unsavedPrompt =
  "Du har osparade ändringar i Gästlistan. Spara eller kasta dem innan du lämnar sidan.";

type EditorRow = AdminGuestRosterRow | DraftGuestRow;

type DraftGuestRow = Omit<
  AdminGuestRosterRow,
  | "hasActiveToken"
  | "id"
  | "inviteAccessScope"
  | "inviteStatus"
  | "rsvpDetails"
  | "rsvpStatus"
  | "rsvpStatusLabel"
  | "tiedInvitedGuestText"
  | "updatedAt"
  | "updatedAtLabel"
> & {
  draftId: string;
  hasActiveToken: false;
  id: string;
  inviteAccessScope: "full";
  inviteStatus: "not replied";
  isDraft: true;
  rsvpDetails: null;
  rsvpStatus: "not replied";
  rsvpStatusLabel: string;
  tiedInvitedGuestText: null;
  updatedAt: string;
  updatedAtLabel: string;
};

type SessionStatus =
  | { tone: "error" | "success" | "warning"; text: string }
  | null;

type BulkIntent =
  | { field: "plusOneAllowed"; value: boolean }
  | { field: "smsOptIn"; value: boolean };

function rowToValues(row: EditorRow): AdminGuestRosterSessionValues {
  return {
    email: row.email,
    fullName: row.fullName,
    notes: row.notes,
    phone: row.phone,
    plusOneAllowed: row.plusOneAllowed,
    smsOptIn: row.smsOptIn,
  };
}

function normalizeValue(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function valuesEqual(
  left: AdminGuestRosterSessionValues,
  right: AdminGuestRosterSessionValues,
) {
  return (
    normalizeValue(left.email) === normalizeValue(right.email) &&
    left.fullName.trim() === right.fullName.trim() &&
    normalizeValue(left.notes) === normalizeValue(right.notes) &&
    normalizeValue(left.phone) === normalizeValue(right.phone) &&
    left.plusOneAllowed === right.plusOneAllowed &&
    left.smsOptIn === right.smsOptIn
  );
}

function makeValuesByKey(rows: EditorRow[]) {
  return Object.fromEntries(rows.map((row) => [row.id, rowToValues(row)]));
}

function blankValues(): AdminGuestRosterSessionValues {
  return {
    email: null,
    fullName: "",
    notes: null,
    phone: null,
    plusOneAllowed: false,
    smsOptIn: false,
  };
}

function makeDraftRow(draftId: string, values: AdminGuestRosterSessionValues): DraftGuestRow {
  return {
    canEditIdentity: true,
    canEditPlusOneAllowed: true,
    canEditSmsOptIn: true,
    canSave: true,
    draftId,
    email: values.email,
    fullName: values.fullName,
    guestKind: "invited",
    guestKindLabel: "Invited Guest",
    hasActiveToken: false,
    id: draftId,
    inviteAccessScope: "full",
    inviteStatus: "not replied",
    isDraft: true,
    notes: values.notes,
    phone: values.phone,
    plusOneAllowed: values.plusOneAllowed,
    rsvpDetails: null,
    rsvpManaged: false,
    rsvpStatus: "not replied",
    rsvpStatusLabel: "not submitted",
    smsOptIn: values.smsOptIn,
    tiedInvitedGuestText: null,
    updatedAt: "",
    updatedAtLabel: "Utkast",
  };
}

function isDraftRow(row: EditorRow): row is DraftGuestRow {
  return "isDraft" in row && row.isDraft;
}

function getRowKey(row: EditorRow) {
  return row.id;
}

function validateRows(rows: EditorRow[], valuesByKey: Record<string, AdminGuestRosterSessionValues>) {
  const errors: AdminGuestRosterSessionErrors = {};

  for (const row of rows) {
    if (!row.canSave) {
      continue;
    }

    const rowKey = getRowKey(row);
    const values = valuesByKey[rowKey] ?? rowToValues(row);
    const fullName = values.fullName.trim();
    const email = normalizeValue(values.email);
    const phone = normalizeValue(values.phone);

    if (!fullName) {
      errors[rowKey] = { ...errors[rowKey], fullName: "Namn krävs." };
    }

    if (!email && !phone) {
      errors[rowKey] = {
        ...errors[rowKey],
        contact: "Ange e-post eller telefonnummer.",
      };
    }

    if (values.smsOptIn && (!phone || !/^\+[1-9][0-9]{7,14}$/.test(phone))) {
      errors[rowKey] = {
        ...errors[rowKey],
        phone: "SMS kräver telefonnummer i format +46701234567.",
      };
    }
  }

  return errors;
}

function hasErrors(errors: AdminGuestRosterSessionErrors) {
  return Object.keys(errors).length > 0;
}

function toStatusFilter(value: string): AdminGuestRosterFilters["status"] {
  switch (value) {
    case "not replied":
    case "opened":
    case "rsvp yes":
    case "rsvp no":
    case "rsvp maybe":
      return value;
    default:
      return "";
  }
}

function toSort(value: string): AdminGuestRosterFilters["sort"] {
  switch (value) {
    case "name-desc":
    case "status":
    case "newest":
      return value;
    default:
      return "name";
  }
}

function getToneClass(tone: "error" | "success" | "warning") {
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-1 text-[11px] font-semibold text-red-700">{message}</p>;
}

function DirtyDot({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-[#b66a2d]" />;
}

function unsavedRowsLabel(count: number) {
  return count === 1 ? "1 osparad rad" : `${count} osparade rader`;
}

function guestKindCopy(row: EditorRow) {
  return row.guestKind === "plus_one" ? "Plus-one Gäst" : "Inbjuden Gäst";
}

function tiedGuestCopy(value: string | null) {
  if (!value) {
    return null;
  }

  return value.replace(/^Tied to /, "Kopplad till ").replace("unknown Invited Guest", "okänd Gäst");
}

function inviteStatusCopy(value: string) {
  switch (value) {
    case "not replied":
    case "not submitted":
      return "Inte sedd";
    case "opened":
      return "Sedd";
    default:
      return value;
  }
}

function rosterStatusCopy(value: string) {
  switch (value) {
    case "not replied":
    case "not submitted":
      return "Inte svarat";
    case "opened":
      return "Öppnad";
    case "rsvp yes":
      return "OSA ja";
    case "rsvp no":
      return "OSA nej";
    case "rsvp maybe":
      return "OSA kanske";
    default:
      return value;
  }
}

function MetaChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  const className =
    tone === "warning"
      ? "bg-amber-100 text-amber-800 ring-amber-200"
      : "bg-[#efe1c8] text-[#5b4027] ring-[#d8c7a3]";

  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${className}`}>
      {children}
    </span>
  );
}

export function GuestRosterEditor({
  initialFilters,
  initialRows,
}: {
  initialFilters: AdminGuestRosterFilters;
  initialRows: AdminGuestRosterRow[];
}) {
  const [rows, setRows] = useState<AdminGuestRosterRow[]>(initialRows);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [valuesByKey, setValuesByKey] = useState<Record<string, AdminGuestRosterSessionValues>>(
    () => makeValuesByKey(initialRows),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [fieldErrors, setFieldErrors] = useState<AdminGuestRosterSessionErrors>({});
  const [status, setStatus] = useState<SessionStatus>(null);
  const [query, setQuery] = useState(initialFilters.query);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [sort, setSort] = useState(initialFilters.sort);
  const [isPending, startTransition] = useTransition();

  const draftRows = useMemo(
    () => draftIds.map((draftId) => makeDraftRow(draftId, valuesByKey[draftId] ?? blankValues())),
    [draftIds, valuesByKey],
  );

  const allRows = useMemo<EditorRow[]>(() => [...draftRows, ...rows], [draftRows, rows]);

  const dirtyRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (!row.canSave) {
          return false;
        }

        if (isDraftRow(row)) {
          return true;
        }

        return !valuesEqual(valuesByKey[row.id] ?? rowToValues(row), rowToValues(row));
      }),
    [allRows, valuesByKey],
  );

  const hasDirtyChanges = dirtyRows.length > 0;

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return allRows
      .filter((row) => {
        const values = valuesByKey[row.id] ?? rowToValues(row);
        const searchable = [
          values.fullName,
          values.email ?? "",
          values.phone ?? "",
          values.notes ?? "",
          row.guestKindLabel,
          row.tiedInvitedGuestText ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (normalizedQuery && !searchable.includes(normalizedQuery)) {
          return false;
        }

        if (!statusFilter) {
          return true;
        }

        return row.inviteStatus === statusFilter || row.rsvpStatus === statusFilter;
      })
      .sort((left, right) => {
        const leftValues = valuesByKey[left.id] ?? rowToValues(left);
        const rightValues = valuesByKey[right.id] ?? rowToValues(right);

        if (sort === "name-desc") {
          return rightValues.fullName.localeCompare(leftValues.fullName, "sv");
        }

        if (sort === "status") {
          return `${left.rsvpStatus}-${left.inviteStatus}-${leftValues.fullName}`.localeCompare(
            `${right.rsvpStatus}-${right.inviteStatus}-${rightValues.fullName}`,
            "sv",
          );
        }

        if (sort === "newest") {
          return right.updatedAt.localeCompare(left.updatedAt);
        }

        return leftValues.fullName.localeCompare(rightValues.fullName, "sv");
      });
  }, [allRows, query, sort, statusFilter, valuesByKey]);

  const hiddenDirtyCount = dirtyRows.filter(
    (dirtyRow) => !visibleRows.some((visibleRow) => visibleRow.id === dirtyRow.id),
  ).length;

  const selectableVisibleRows = visibleRows.filter((row) => !isDraftRow(row));
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));

  const saveChanges = useCallback(() => {
    const validationErrors = validateRows(dirtyRows, valuesByKey);

    if (hasErrors(validationErrors)) {
      setFieldErrors(validationErrors);
      setStatus({ tone: "error", text: "Rätta markerade fält innan du sparar." });
      return;
    }

    const changes = dirtyRows.map((row): AdminGuestRosterSessionChange => {
      const values = valuesByKey[row.id] ?? rowToValues(row);
      return {
        draftId: isDraftRow(row) ? row.draftId : undefined,
        expectedUpdatedAt: isDraftRow(row) ? undefined : row.updatedAt,
        id: isDraftRow(row) ? undefined : row.id,
        rowKey: row.id,
        values,
      };
    });

    if (changes.length === 0) {
      setStatus({ tone: "success", text: "Inga ändringar att spara." });
      return;
    }

    startTransition(async () => {
      setStatus({ tone: "warning", text: "Sparar ändringar…" });
      const result = await saveGuestRosterSessionAction(changes);

      if (result.status === "success") {
        const nextRows = result.rows ?? rows;
        setRows(nextRows);
        setDraftIds([]);
        setValuesByKey(makeValuesByKey(nextRows));
        setFieldErrors({});
        setSelectedIds(new Set());
        setStatus({
          tone: "success",
          text: `Sparade ${result.savedCount} ändring${result.savedCount === 1 ? "" : "ar"}.`,
        });
        return;
      }

      if (result.status === "validation-error") {
        setFieldErrors(result.errors);
        setStatus({ tone: "error", text: result.message });
        return;
      }

      setStatus({ tone: "error", text: result.message });
    });
  }, [dirtyRows, rows, valuesByKey]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasDirtyChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = unsavedPrompt;
    }

    function guardDocumentLinks(event: MouseEvent) {
      if (!hasDirtyChanges) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[href]");

      if (!link || window.confirm(unsavedPrompt)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardDocumentLinks, true);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardDocumentLinks, true);
    };
  }, [hasDirtyChanges]);

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      saveChanges();
    }

    document.addEventListener("keydown", handleSaveShortcut);
    return () => document.removeEventListener("keydown", handleSaveShortcut);
  }, [saveChanges]);

  function updateValue<K extends keyof AdminGuestRosterSessionValues>(
    rowKey: string,
    field: K,
    value: AdminGuestRosterSessionValues[K],
  ) {
    setValuesByKey((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] ?? blankValues()),
        [field]: value,
      },
    }));
    setFieldErrors((current) => {
      if (!current[rowKey]) {
        return current;
      }

      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  function updateTextValue(
    rowKey: string,
    field: "email" | "fullName" | "notes" | "phone",
  ) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateValue(rowKey, field, event.target.value);
    };
  }

  function addDraftGuest() {
    const draftId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setDraftIds((current) => [draftId, ...current]);
    setValuesByKey((current) => ({ ...current, [draftId]: blankValues() }));
    setStatus({ tone: "warning", text: "Ny Gäst är ett utkast tills du sparar." });
  }

  function discardChanges() {
    setDraftIds([]);
    setValuesByKey(makeValuesByKey(rows));
    setFieldErrors({});
    setStatus({ tone: "warning", text: "Osparade ändringar kastades." });
  }

  function revealDirtyRows() {
    setQuery("");
    setStatusFilter("");
    setSort("name");
  }

  function toggleSelected(rowId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of selectableVisibleRows) {
        if (checked) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
      }
      return next;
    });
  }

  function runBulkEdit(intent: BulkIntent) {
    if (hasDirtyChanges) {
      setStatus({
        tone: "error",
        text: "Spara eller kasta ändringar innan du kör markerade åtgärder.",
      });
      return;
    }

    const editableSelectedRows = selectedRows.filter((row) =>
      intent.field === "plusOneAllowed" ? row.canEditPlusOneAllowed : row.canEditSmsOptIn,
    );

    if (!editableSelectedRows.length) {
      setStatus({ tone: "warning", text: "Inga markerade Gäster kan ändras med den åtgärden." });
      return;
    }

    const changes = editableSelectedRows.map((row): AdminGuestRosterSessionChange => ({
      expectedUpdatedAt: row.updatedAt,
      id: row.id,
      rowKey: row.id,
      values: { ...rowToValues(row), [intent.field]: intent.value },
    }));

    startTransition(async () => {
      const result = await saveGuestRosterSessionAction(changes);

      if (result.status === "success") {
        const nextRows = result.rows ?? rows;
        setRows(nextRows);
        setValuesByKey(makeValuesByKey(nextRows));
        setSelectedIds(new Set());
        setFieldErrors({});
        setStatus({ tone: "success", text: `Uppdaterade ${result.savedCount} markerade Gäster.` });
        return;
      }

      if (result.status === "validation-error") {
        setFieldErrors(result.errors);
        setStatus({ tone: "error", text: result.message });
        return;
      }

      setStatus({ tone: "error", text: result.message });
    });
  }

  function archiveSelected() {
    if (hasDirtyChanges) {
      setStatus({
        tone: "error",
        text: "Spara eller kasta ändringar innan du arkiverar markerade Gäster.",
      });
      return;
    }

    if (!selectedIds.size) {
      setStatus({ tone: "warning", text: "Markera minst en Gäst först." });
      return;
    }

    if (!window.confirm(`Arkivera ${selectedIds.size} markerade Gäster? Invite-access påverkas direkt.`)) {
      return;
    }

    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const result = await archiveSelectedGuestsAction(ids);

      if (result.status === "success") {
        const archivedIds = new Set(result.archivedGuestIds);
        const nextRows = rows.filter((row) => !archivedIds.has(row.id));
        setRows(nextRows);
        setValuesByKey(makeValuesByKey(nextRows));
        setSelectedIds(new Set());
        setStatus({
          tone: "success",
          text: `Arkiverade ${result.archivedCount} Gäst${result.archivedCount === 1 ? "" : "er"}.`,
        });
        return;
      }

      if (result.status === "validation-error") {
        setFieldErrors(result.errors);
        setStatus({ tone: "error", text: result.message });
        return;
      }

      setStatus({ tone: "error", text: result.message });
    });
  }

  const allVisibleSelected =
    selectableVisibleRows.length > 0 && selectableVisibleRows.every((row) => selectedIds.has(row.id));
  const showSaveFooter = hasDirtyChanges || isPending || status !== null;
  const saveFooterText = hasDirtyChanges
    ? unsavedRowsLabel(dirtyRows.length)
    : isPending
      ? "Sparar ändringar…"
      : status?.text ?? "Gästlistan är sparad";

  return (
    <section className="grid gap-5">
      <div className="rounded-[2rem] border border-[#d8c7a3] bg-[#f8f1e3] p-5 shadow-[0_18px_60px_rgba(77,53,31,0.08)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#8f5d2f]">Gästlista</p>
            <h2 className="mt-2 font-serif text-3xl text-[#1f1a14]">Redigera Gäster</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6f604d]">
              Ändra flera rader, lägg till utkast och spara allt samlat när du är klar. OSA-styrda Plus-one Gäster visas men är skrivskyddade.
            </p>
          </div>
          <button
            className="rounded-full bg-[#1f1a14] px-5 py-3 text-sm font-bold text-[#f8f1e3] shadow-sm transition hover:bg-[#33291f] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={addDraftGuest}
            type="button"
          >
            Lägg till Gäst-utkast
          </button>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto] xl:items-end">
          <label className="grid gap-1 text-sm font-semibold text-[#5a4633]">
            <span>Sök <span className="sr-only">Search name or phone</span></span>
            <input
              className="rounded-2xl border border-[#d8c7a3] bg-white/80 px-4 py-3 font-normal text-[#1f1a14] outline-none focus:border-[#1f1a14]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Namn, e-post, telefon, anteckning"
              value={query}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[#5a4633]">
            Status
            <select
              className="rounded-2xl border border-[#d8c7a3] bg-white/80 px-4 py-3 font-normal text-[#1f1a14] outline-none focus:border-[#1f1a14]"
              onChange={(event) => setStatusFilter(toStatusFilter(event.target.value))}
              value={statusFilter}
            >
              <option value="">Alla</option>
              <option value="not replied">Inte öppnad</option>
              <option value="opened">Öppnad</option>
              <option value="rsvp yes">OSA ja</option>
              <option value="rsvp no">OSA nej</option>
              <option value="rsvp maybe">OSA kanske</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[#5a4633]">
            Sortering
            <select
              className="rounded-2xl border border-[#d8c7a3] bg-white/80 px-4 py-3 font-normal text-[#1f1a14] outline-none focus:border-[#1f1a14]"
              onChange={(event) => setSort(toSort(event.target.value))}
              value={sort}
            >
              <option value="name">Namn A–Ö</option>
              <option value="name-desc">Namn Ö–A</option>
              <option value="status">Status</option>
              <option value="newest">Senast ändrad</option>
            </select>
          </label>
          <button
            aria-label="Apply"
            className="rounded-full border border-[#c9ad7e] px-5 py-3 text-sm font-bold text-[#4d351f] transition hover:bg-white"
            type="button"
          >
            Tillämpa
          </button>
          <button
            className="rounded-full border border-[#c9ad7e] px-5 py-3 text-sm font-bold text-[#4d351f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={hiddenDirtyCount === 0}
            onClick={revealDirtyRows}
            type="button"
          >
            Visa ändrade rader {hiddenDirtyCount ? `(${hiddenDirtyCount})` : ""}
          </button>
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-bold text-[#1f1a14]">Markerade åtgärder</p>
            <p className="text-xs text-[#6f604d]">
              Körs bara när redigeringssessionen är ren. Markerat: {selectedIds.size}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="bulk-button" disabled={isPending} onClick={() => runBulkEdit({ field: "plusOneAllowed", value: true })} type="button">
              Tillåt +1
            </button>
            <button className="bulk-button" disabled={isPending} onClick={() => runBulkEdit({ field: "plusOneAllowed", value: false })} type="button">
              Stoppa +1
            </button>
            <button className="bulk-button" disabled={isPending} onClick={() => runBulkEdit({ field: "smsOptIn", value: true })} type="button">
              SMS på
            </button>
            <button className="bulk-button" disabled={isPending} onClick={() => runBulkEdit({ field: "smsOptIn", value: false })} type="button">
              SMS av
            </button>
            <Link
              className="bulk-button"
              href={`/admin/messages?selected_guests=${encodeURIComponent(Array.from(selectedIds).join(","))}`}
            >
              Öppna Wedding SMS-uppdatering för markerade
            </Link>
            <button className="bulk-button-danger" disabled={isPending} onClick={archiveSelected} type="button">
              Arkivera
            </button>
          </div>
        </div>
      </div>

      {status ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm font-semibold ${getToneClass(status.tone)}`} role={status.tone === "error" ? "alert" : "status"}>
          {status.text}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] shadow-[0_24px_80px_rgba(77,53,31,0.08)]">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-[#eadcc3] text-[11px] uppercase tracking-[0.18em] text-[#6f4f2d]">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  aria-label="Markera synliga Gäster"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                  type="checkbox"
                />
              </th>
              <th className="px-4 py-3">Gäst</th>
              <th className="px-4 py-3">E-post</th>
              <th className="px-4 py-3">Telefon</th>
              <th className="px-4 py-3">SMS</th>
              <th className="px-4 py-3">+1</th>
              <th className="px-4 py-3 text-right">Inbjudan</th>
              <th className="px-4 py-3">Notering</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rowKey = getRowKey(row);
              const values = valuesByKey[rowKey] ?? rowToValues(row);
              const baseValues = rowToValues(row);
              const rowDirty = isDraftRow(row) || !valuesEqual(values, baseValues);
              const errors = fieldErrors[rowKey] ?? {};
              const editable = row.canSave && !isPending;
              const tiedGuest = tiedGuestCopy(row.tiedInvitedGuestText);

              return [
                <tr className={rowDirty ? "bg-[#fff4df]" : "bg-white/80"} data-roster-row="guest" key={`${rowKey}-main`}>
                  <td className="border-t border-[#eadcc3] px-4 py-3 align-top">
                    {isDraftRow(row) ? (
                      <span className="text-xs font-bold text-[#8f5d2f]">ny</span>
                    ) : (
                      <input
                        aria-label={`Markera ${row.fullName}`}
                        checked={selectedIds.has(row.id)}
                        disabled={isPending}
                        onChange={(event) => toggleSelected(row.id, event.target.checked)}
                        type="checkbox"
                      />
                    )}
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 align-top">
                    <div className="w-64">
                      <input
                        aria-label={`Namn ${row.fullName || "ny Gäst"}`}
                        className="cell-input w-full"
                        disabled={isPending}
                        name="full_name"
                        onChange={updateTextValue(rowKey, "fullName")}
                        readOnly={!row.canSave}
                        value={values.fullName}
                      />
                      <FieldError message={errors.fullName} />
                      <FieldError message={errors.row} />
                    </div>
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 align-top">
                    <input
                      aria-label={`E-post ${row.fullName || "ny Gäst"}`}
                      className="cell-input min-w-56"
                      disabled={isPending}
                      name="email"
                      onChange={updateTextValue(rowKey, "email")}
                      readOnly={!row.canSave}
                      type="email"
                      value={values.email ?? ""}
                    />
                    <FieldError message={errors.contact} />
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 align-top">
                    <input
                      aria-label={`Telefon ${row.fullName || "ny Gäst"}`}
                      className="cell-input min-w-44"
                      disabled={isPending}
                      name="phone"
                      onChange={updateTextValue(rowKey, "phone")}
                      placeholder="+46701234567"
                      readOnly={!row.canSave}
                      type="tel"
                      value={values.phone ?? ""}
                    />
                    <FieldError message={errors.phone} />
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 text-center align-middle">
                    <label className="inline-flex min-h-10 items-center justify-center gap-2 text-xs font-bold text-[#5b4027]">
                      <input
                        aria-label={`SMS-samtycke ${row.fullName || "ny Gäst"}`}
                        checked={values.smsOptIn}
                        disabled={!editable || !row.canEditSmsOptIn}
                        name="sms_opt_in"
                        onChange={(event) => updateValue(rowKey, "smsOptIn", event.target.checked)}
                        type="checkbox"
                      />
                      <DirtyDot show={values.smsOptIn !== baseValues.smsOptIn} />
                    </label>
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 text-center align-middle">
                    <label className="inline-flex min-h-10 items-center justify-center gap-2 text-xs font-bold text-[#5b4027]">
                      <input
                        aria-label={`+1 ${row.fullName || "ny Gäst"}`}
                        checked={values.plusOneAllowed}
                        disabled={!editable || !row.canEditPlusOneAllowed}
                        name="plus_one_allowed"
                        onChange={(event) => updateValue(rowKey, "plusOneAllowed", event.target.checked)}
                        type="checkbox"
                      />
                      <DirtyDot show={values.plusOneAllowed !== baseValues.plusOneAllowed} />
                    </label>
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 text-right align-top">
                    {isDraftRow(row) ? (
                      <span className="text-xs text-[#8f5d2f]">Spara först</span>
                    ) : (
                      <InviteLinkButton
                        accessScope={row.inviteAccessScope}
                        disabled={hasDirtyChanges || isPending}
                        guestId={row.id}
                        guestName={row.fullName}
                      />
                    )}
                  </td>
                  <td className="border-t border-[#eadcc3] px-4 py-3 align-top">
                    <details className="min-w-44">
                      <summary className="cursor-pointer select-none text-xs font-bold text-[#5b4027]">
                        Notering
                      </summary>
                      <textarea
                        aria-label={`Notering ${row.fullName || "ny Gäst"}`}
                        className="cell-input mt-2 min-h-20 min-w-64 resize-y"
                        disabled={isPending}
                        name="notes"
                        onChange={updateTextValue(rowKey, "notes")}
                        readOnly={!row.canSave}
                        value={values.notes ?? ""}
                      />
                    </details>
                  </td>
                </tr>,
                <tr className={rowDirty ? "bg-[#fff4df]" : "bg-white/80"} data-roster-row="metadata" key={`${rowKey}-metadata`}>
                  <td className="px-4 pb-3 pt-1" />
                  <td className="px-4 pb-3 pt-1" colSpan={7}>
                    <div className="flex min-w-0 max-w-full flex-nowrap gap-1.5 overflow-x-auto py-1 text-xs text-[#5d5144]">
                      <MetaChip>{guestKindCopy(row)}</MetaChip>
                      {row.rsvpManaged ? <MetaChip tone="warning">OSA-styrd</MetaChip> : null}
                      {tiedGuest ? <MetaChip>{tiedGuest}</MetaChip> : null}
                      <MetaChip>Inbjudan: {inviteStatusCopy(row.inviteStatus)}</MetaChip>
                      <MetaChip>OSA: {rosterStatusCopy(row.rsvpStatusLabel)}</MetaChip>
                      {row.rsvpDetails?.extraGuests ? (
                        <MetaChip>Extra gäster: {String(row.rsvpDetails.extraGuests)}</MetaChip>
                      ) : null}
                      {row.rsvpDetails?.foodPreference ? (
                        <MetaChip>Mat: {row.rsvpDetails.foodPreference}</MetaChip>
                      ) : null}
                      {row.rsvpDetails?.allergyNotes ? (
                        <MetaChip>Allergier: {row.rsvpDetails.allergyNotes}</MetaChip>
                      ) : null}
                      <MetaChip>Uppdaterad: {row.updatedAtLabel}</MetaChip>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>

        {!visibleRows.length ? (
          <p className="p-8 text-sm font-semibold text-[#6f604d]">Inga Gäster matchar filtren.</p>
        ) : null}
      </div>

      {showSaveFooter ? (
        <div className="sticky bottom-4 z-20 rounded-[1.75rem] border border-[#b9955f] bg-[#1f1a14] px-5 py-4 text-[#f8f1e3] shadow-[0_24px_80px_rgba(31,26,20,0.28)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-bold">{saveFooterText}</p>
              <p className="text-xs text-[#d8c7a3]">Cmd/Ctrl+S sparar. Spara-knappen ligger utanför tabellens horisontella scroll.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-full border border-[#b9955f] px-5 py-3 text-sm font-bold text-[#f8f1e3] transition hover:bg-[#33291f] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!hasDirtyChanges || isPending}
                onClick={discardChanges}
                type="button"
              >
                Kasta
              </button>
              <button
                className="rounded-full bg-[#f8f1e3] px-5 py-3 text-sm font-bold text-[#1f1a14] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!hasDirtyChanges || isPending}
                onClick={saveChanges}
                type="button"
              >
                {isPending ? "Sparar…" : "Spara ändringar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
