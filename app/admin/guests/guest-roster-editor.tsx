"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  AdminGuestRosterFilters,
  AdminGuestRosterRow,
} from "@/lib/admin-guest-roster";
import {
  matchesAdminGuestRosterFilters,
  type DietaryFilter,
  type GuestKindFilter,
} from "@/lib/admin-guest-roster-filters";
import type {
  AdminGuestRosterSessionChange,
  AdminGuestRosterSessionErrors,
  AdminGuestRosterSessionValues,
} from "@/lib/admin-guest-roster-session";
import { isRsvpStatus } from "@/lib/invite-status";
import { normalizePhoneNumberInput, PHONE_FORMAT_HINT } from "@/lib/phone";
import {
  archiveSelectedGuestsAction,
  saveGuestRosterSessionAction,
} from "./actions";
import { InviteLinkButton } from "./invite-link-button";

type Row = AdminGuestRosterRow & { draft?: boolean };
type Status = { tone: "error" | "success" | "warning"; text: string } | null;
const unsavedPrompt =
  "Du har osparade ändringar i gästlistan. Lämna sidan och förlora ändringarna?";
const clean = (value: string | null) => value?.trim() || null;
function rowValues(row: Row): AdminGuestRosterSessionValues {
  return {
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    plusOneAllowed: row.plusOneAllowed,
    smsOptIn: row.smsOptIn,
    rsvpStatus: row.rsvpStatus,
  };
}
function equal(
  left: AdminGuestRosterSessionValues,
  right: AdminGuestRosterSessionValues,
) {
  return (
    clean(left.fullName) === clean(right.fullName) &&
    clean(left.email) === clean(right.email) &&
    clean(left.phone) === clean(right.phone) &&
    clean(left.notes) === clean(right.notes) &&
    left.plusOneAllowed === right.plusOneAllowed &&
    left.smsOptIn === right.smsOptIn &&
    left.rsvpStatus === right.rsvpStatus
  );
}
function valuesFor(rows: Row[]) {
  return Object.fromEntries(rows.map((row) => [row.id, rowValues(row)]));
}
function newRow(): Row {
  return {
    id: `draft-${crypto.randomUUID()}`,
    draft: true,
    fullName: "",
    email: null,
    phone: null,
    notes: null,
    plusOneAllowed: false,
    smsOptIn: false,
    rsvpStatus: "not replied",
    rsvpStatusLabel: "not submitted",
    canSave: true,
    canEditIdentity: true,
    canEditPlusOneAllowed: true,
    canEditSmsOptIn: true,
    guestKind: "invited",
    guestKindLabel: "Invited Guest",
    hasActiveToken: false,
    inviteAccessScope: "full",
    inviteStatus: "not replied",
    rsvpManaged: false,
    rsvpDetails: null,
    tiedInvitedGuestText: null,
    updatedAt: "",
    updatedAtLabel: "Utkast",
  };
}
function ErrorText({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1 text-xs font-semibold text-red-800" role="alert">
      {message}
    </p>
  ) : null;
}
function rsvpLabel(value: string) {
  return value === "rsvp yes"
    ? "Ja · kommer"
    : value === "rsvp no"
      ? "Nej · kommer inte"
      : value === "rsvp maybe"
        ? "Kanske"
        : "Ej svarat";
}

export function GuestRosterEditor({
  initialRows,
  initialFilters,
}: {
  initialRows: AdminGuestRosterRow[];
  initialFilters: AdminGuestRosterFilters;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [values, setValues] = useState(() => valuesFor(initialRows));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<AdminGuestRosterSessionErrors>({});
  const [status, setStatus] = useState<Status>(null);
  const [query, setQuery] = useState(initialFilters.query);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [sort, setSort] = useState(initialFilters.sort);
  const [dietary, setDietary] = useState<DietaryFilter>("");
  const [kind, setKind] = useState<GuestKindFilter>("");
  const [isSaving, startTransition] = useTransition();
  const [reloadRequired, setReloadRequired] = useState(false);
  const isPending = isSaving || reloadRequired;
  const saving = useRef(false);
  const dirtyRows = useMemo(
    () =>
      rows.filter((row) => row.draft || !equal(values[row.id], rowValues(row))),
    [rows, values],
  );
  const dirty = dirtyRows.length > 0;
  const savedRows = rows.filter((row) => !row.draft);
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) =>
          matchesAdminGuestRosterFilters(
            {
              ...row,
              ...values[row.id],
              rsvpStatus: values[row.id].rsvpStatus ?? row.rsvpStatus,
            },
            { query, status: statusFilter, dietary, kind },
          ),
        )
        .sort((a, b) => {
          if (a.draft !== b.draft) return a.draft ? -1 : 1;
          if (sort === "newest") return b.updatedAt.localeCompare(a.updatedAt);
          if (sort === "status")
            return `${values[a.id].rsvpStatus}-${a.inviteStatus}-${values[a.id].fullName}`.localeCompare(
              `${values[b.id].rsvpStatus}-${b.inviteStatus}-${values[b.id].fullName}`,
              "sv",
            );
          return (
            (sort === "name-desc" ? -1 : 1) *
            values[a.id].fullName.localeCompare(values[b.id].fullName, "sv")
          );
        }),
    [rows, values, query, statusFilter, dietary, kind, sort],
  );
  const selectable = visibleRows.filter((row) => !row.draft);
  const selectedVisibleCount = selectable.filter((row) =>
    selected.has(row.id),
  ).length;
  const hiddenDirtyCount = dirtyRows.filter(
    (row) => !visibleRows.some((visible) => visible.id === row.id),
  ).length;

  function clearFilters() {
    setQuery("");
    setStatusFilter("");
    setDietary("");
    setKind("");
  }
  function update<K extends keyof AdminGuestRosterSessionValues>(
    id: string,
    field: K,
    value: AdminGuestRosterSessionValues[K],
  ) {
    setValues((previous) => ({
      ...previous,
      [id]: { ...previous[id], [field]: value },
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setStatus(null);
  }
  function toggle(id: string, setter: typeof setSelected) {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const save = useCallback(
    (
      targets: Row[] = dirtyRows,
      override?: Partial<AdminGuestRosterSessionValues>,
    ) => {
      if (saving.current || reloadRequired || targets.length === 0) return;
      const validation: AdminGuestRosterSessionErrors = {};
      const changes = targets.map((row): AdminGuestRosterSessionChange => {
        const input = { ...values[row.id], ...override };
        const fields: AdminGuestRosterSessionErrors[string] = {};
        if (!input.fullName.trim()) fields.fullName = "Namn krävs.";
        if (
          row.guestKind === "invited" &&
          !clean(input.email) &&
          !clean(input.phone)
        )
          fields.contact = "Ange e-post eller telefonnummer.";
        if (input.smsOptIn && !normalizePhoneNumberInput(input.phone ?? ""))
          fields.phone = `SMS kräver telefonnummer i format ${PHONE_FORMAT_HINT}.`;
        if (Object.keys(fields).length) validation[row.id] = fields;
        return {
          rowKey: row.id,
          id: row.draft ? undefined : row.id,
          draftId: row.draft ? row.id : undefined,
          expectedUpdatedAt: row.draft ? undefined : row.updatedAt,
          values: input,
        };
      });
      if (Object.keys(validation).length) {
        setErrors(validation);
        setStatus({
          tone: "error",
          text: "Rätta markerade fält innan du sparar.",
        });
        return;
      }
      saving.current = true;
      startTransition(async () => {
        try {
          const result = await saveGuestRosterSessionAction(changes);
          if (result.status === "success" && result.rows) {
            setRows(result.rows);
            setValues(valuesFor(result.rows));
            setSelected(new Set());
            setErrors({});
            setStatus({
              tone: "success",
              text: `Sparade ${result.savedCount} gäster.`,
            });
          } else if (result.status === "success") {
            setReloadRequired(true);
            setStatus({
              tone: "warning",
              text: "Ändringarna sparades, men listan kunde inte hämtas. Ladda om sidan innan du fortsätter.",
            });
          } else {
            if (result.status === "validation-error") setErrors(result.errors);
            setStatus({ tone: "error", text: result.message });
          }
        } catch {
          setStatus({
            tone: "error",
            text: "Kunde inte bekräfta sparandet. Ändringarna finns kvar här. Ladda om vid versionskonflikt.",
          });
        } finally {
          saving.current = false;
        }
      });
    },
    [dirtyRows, values, reloadRequired],
  );

  useEffect(() => {
    function unload(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function links(event: MouseEvent) {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (dirty && link && !window.confirm(unsavedPrompt)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", links, true);
    document.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", links, true);
      document.removeEventListener("keydown", shortcut);
    };
  }, [dirty, save]);

  function bulk(field: "plusOneAllowed" | "smsOptIn", value: boolean) {
    const targets = rows.filter(
      (row) =>
        selected.has(row.id) &&
        (field === "plusOneAllowed"
          ? row.canEditPlusOneAllowed
          : row.canEditSmsOptIn),
    );
    if (dirty || isPending) return;
    if (!targets.length) {
      setStatus({
        tone: "warning",
        text: "Ingen markerad gäst kan ändras med den åtgärden.",
      });
      return;
    }
    save(targets, { [field]: value });
  }
  function archive() {
    if (dirty || saving.current || reloadRequired || !selected.size) return;
    if (
      !window.confirm(
        `Arkivera ${selected.size} markerade gäster? Kopplade +1-gäster arkiveras också och deras inbjudningslänkar stängs.`,
      )
    )
      return;
    saving.current = true;
    startTransition(async () => {
      try {
        const result = await archiveSelectedGuestsAction([...selected]);
        if (result.status === "success") {
          const next = rows.filter(
            (row) => !result.archivedGuestIds.includes(row.id),
          );
          setRows(next);
          setValues(valuesFor(next));
          setSelected(new Set());
          setErrors({});
          setStatus({
            tone: "success",
            text: `Arkiverade ${result.archivedCount} gäster.`,
          });
        } else {
          if (result.status === "validation-error") setErrors(result.errors);
          setStatus({ tone: "error", text: result.message });
        }
      } catch {
        setStatus({
          tone: "error",
          text: "Kunde inte bekräfta arkiveringen. Ladda om för att kontrollera.",
        });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <section className="grid gap-4">
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="Sparade OSA-svar"
      >
        {(
          [
            ["rsvp yes", "Kommer"],
            ["rsvp maybe", "Kanske"],
            ["rsvp no", "Kommer inte"],
            ["not replied", "Ej svarat"],
          ] as const
        ).map(([value, label]) => (
          <div
            key={value}
            className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-4"
          >
            <p className="text-xs font-bold text-[#6f604d]">{label}</p>
            <p className="mt-1 font-serif text-3xl">
              {savedRows.filter((row) => row.rsvpStatus === value).length}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Gästlista</h2>
            <p className="mt-1 text-sm text-[#6f604d]">
              Redigera direkt. Öppna detaljer för mat, allergier och privata
              noteringar.
            </p>
          </div>
          <button
            className="bulk-button bg-[#eadcc3]"
            disabled={isPending}
            onClick={() => {
              const row = newRow();
              setRows((previous) => [row, ...previous]);
              setValues((previous) => ({
                ...previous,
                [row.id]: rowValues(row),
              }));
              setExpanded((previous) => new Set([...previous, row.id]));
              clearFilters();
              setStatus(null);
            }}
            type="button"
          >
            Lägg till Gäst-utkast
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">
            Sök <span className="sr-only">Search name or phone</span>
            <input
              className="cell-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Namn, kontakt, notering, mat eller allergi"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Status
            <select
              aria-label="Status"
              className="cell-input"
              value={statusFilter}
              onChange={(event) => {
                const value = event.target.value;
                setStatusFilter(
                  value === "opened" || isRsvpStatus(value) ? value : "",
                );
              }}
            >
              <option value="">Alla</option>
              <option value="not replied">Ej öppnad · ej svarat</option>
              <option value="opened">Öppnad · ej svarat</option>
              <option value="rsvp yes">OSA ja</option>
              <option value="rsvp maybe">OSA kanske</option>
              <option value="rsvp no">OSA nej</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Mat och allergier
            <select
              aria-label="Mat och allergier"
              className="cell-input"
              value={dietary}
              onChange={(event) => {
                const value = event.target.value;
                setDietary(
                  value === "any" ||
                    value === "allergy" ||
                    value === "food" ||
                    value === "none"
                    ? value
                    : "",
                );
              }}
            >
              <option value="">Alla</option>
              <option value="any">Matpreferens eller allergi</option>
              <option value="allergy">Har allergi</option>
              <option value="food">Har matpreferens</option>
              <option value="none">Inga uppgifter</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Gästtyp
            <select
              aria-label="Gästtyp"
              className="cell-input"
              value={kind}
              onChange={(event) => {
                const value = event.target.value;
                setKind(
                  value === "invited" || value === "plus_one" ? value : "",
                );
              }}
            >
              <option value="">Alla gäster</option>
              <option value="invited">Inbjudna gäster</option>
              <option value="plus_one">+1-gäster</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Sortering
            <select
              aria-label="Sortering"
              className="cell-input"
              value={sort}
              onChange={(event) => {
                const value = event.target.value;
                setSort(
                  value === "name-desc" ||
                    value === "status" ||
                    value === "newest"
                    ? value
                    : "name",
                );
              }}
            >
              <option value="name">Namn A–Ö</option>
              <option value="name-desc">Namn Ö–A</option>
              <option value="status">OSA-status</option>
              <option value="newest">Senast uppdaterad</option>
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button
              className="bulk-button"
              onClick={clearFilters}
              type="button"
            >
              Rensa filter
            </button>
            <span className="text-sm" aria-live="polite">
              Visar {visibleRows.length} av {rows.length}
            </span>
          </div>
        </div>
        {hiddenDirtyCount > 0 ? (
          <p className="mt-3 text-sm font-semibold text-amber-900">
            {hiddenDirtyCount} ändrade rader döljs av filter.{" "}
            <button type="button" className="underline" onClick={clearFilters}>
              Visa ändrade rader
            </button>
          </p>
        ) : null}
      </div>
      {selected.size > 0 ? (
        <div className="rounded-2xl border border-[#d8c7a3] bg-[#f8f1e3] p-4">
          <p className="mb-3 text-sm font-semibold">
            {selected.size} markerade · {selected.size - selectedVisibleCount}{" "}
            dolda av filter
            {dirty ? " · Spara eller kasta ändringar före gruppåtgärder." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="bulk-button"
              disabled={isPending}
              onClick={() => setSelected(new Set())}
            >
              Avmarkera alla
            </button>
            <button
              type="button"
              className="bulk-button"
              disabled={dirty || isPending}
              onClick={() => bulk("plusOneAllowed", true)}
            >
              Tillåt +1
            </button>
            <button
              type="button"
              className="bulk-button"
              disabled={dirty || isPending}
              onClick={() => bulk("plusOneAllowed", false)}
            >
              Stoppa +1
            </button>
            <button
              type="button"
              className="bulk-button"
              disabled={dirty || isPending}
              onClick={() => bulk("smsOptIn", true)}
            >
              SMS på
            </button>
            <button
              type="button"
              className="bulk-button"
              disabled={dirty || isPending}
              onClick={() => bulk("smsOptIn", false)}
            >
              SMS av
            </button>
            {!dirty && !isPending ? (
              <Link
                className="bulk-button"
                href={`/admin/messages?selected_guests=${encodeURIComponent([...selected].join(","))}`}
              >
                Skicka SMS till markerade
              </Link>
            ) : null}
            <button
              type="button"
              className="bulk-button-danger"
              disabled={dirty || isPending}
              onClick={archive}
            >
              Arkivera
            </button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p
          className={`rounded-xl border p-4 text-sm font-semibold ${status.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : status.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-[#d8c7a3] bg-[#fffaf1]">
        <div className="flex items-center gap-2 border-b border-[#d8c7a3] px-4 py-3 text-sm">
          <input
            type="checkbox"
            id="select-visible-guests"
            aria-label="Markera synliga Gäster"
            disabled={isPending || !selectable.length}
            checked={
              selectable.length > 0 &&
              selectedVisibleCount === selectable.length
            }
            ref={(node) => {
              if (node)
                node.indeterminate =
                  selectedVisibleCount > 0 &&
                  selectedVisibleCount < selectable.length;
            }}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelected((previous) => {
                const next = new Set(previous);
                for (const row of selectable) {
                  if (checked) next.add(row.id);
                  else next.delete(row.id);
                }
                return next;
              });
            }}
          />
          <label htmlFor="select-visible-guests">Markera synliga gäster</label>
        </div>
        <table className="admin-roster-table w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-[#eadcc3] text-xs text-[#5b4027]">
            <tr>
              <th className="w-10 p-3">
                <span className="sr-only">Markering</span>
              </th>
              <th className="p-3">Gäst / OSA</th>
              <th className="p-3">Kontakt</th>
              <th className="w-24 p-3">Val</th>
              <th className="w-40 p-3">Åtgärder</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.flatMap((row) => {
              const input = values[row.id];
              const name =
                (row.draft ? input.fullName : row.fullName) || "ny Gäst";
              const fieldErrors = errors[row.id] ?? {};
              const changed = row.draft || !equal(input, rowValues(row));
              const open = expanded.has(row.id);
              const tied = row.tiedInvitedGuestText
                ?.replace(/^Tied to /, "+1 till ")
                .replace("unknown Invited Guest", "okänd gäst");
              return [
                <tr
                  key={row.id}
                  data-roster-row="guest"
                  className={changed ? "bg-[#fff0d1]" : "bg-white/80"}
                >
                  <td className="p-3 align-top">
                    {row.draft ? (
                      <span className="text-xs font-bold">Ny</span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Markera ${name}`}
                        checked={selected.has(row.id)}
                        disabled={isPending}
                        onChange={() => toggle(row.id, setSelected)}
                      />
                    )}
                  </td>
                  <td className="min-w-0 p-3 align-top">
                    <input
                      className="cell-input w-full"
                      aria-label={`Namn ${name}`}
                      name="full_name"
                      disabled={isPending}
                      readOnly={!row.canEditIdentity}
                      value={input.fullName}
                      onChange={(event) =>
                        update(row.id, "fullName", event.target.value)
                      }
                    />
                    <ErrorText message={fieldErrors.fullName} />
                    <ErrorText message={fieldErrors.row} />
                    <select
                      className={`cell-input mt-2 w-full font-semibold ${input.rsvpStatus === "rsvp yes" ? "text-emerald-800" : ""}`}
                      aria-label={`OSA ${name}`}
                      value={input.rsvpStatus}
                      disabled={isPending || row.guestKind === "plus_one"}
                      onChange={(event) => {
                        if (isRsvpStatus(event.target.value))
                          update(row.id, "rsvpStatus", event.target.value);
                      }}
                    >
                      <option
                        value="not replied"
                        disabled={row.rsvpStatus !== "not replied"}
                      >
                        Ej svarat
                      </option>
                      <option value="rsvp yes">Ja · kommer</option>
                      <option value="rsvp maybe">Kanske</option>
                      <option value="rsvp no">Nej · kommer inte</option>
                    </select>
                    {tied ? (
                      <p className="mt-1 break-words text-xs text-[#6f604d]">
                        {tied}
                      </p>
                    ) : null}
                  </td>
                  <td className="min-w-0 p-3 align-top">
                    <input
                      className="cell-input w-full"
                      aria-label={`E-post ${name}`}
                      name="email"
                      type="email"
                      placeholder="E-post"
                      disabled={isPending}
                      readOnly={!row.canEditIdentity}
                      value={input.email ?? ""}
                      onChange={(event) =>
                        update(row.id, "email", event.target.value)
                      }
                    />
                    <input
                      className="cell-input mt-2 w-full"
                      aria-label={`Telefon ${name}`}
                      name="phone"
                      type="tel"
                      placeholder="Telefon"
                      disabled={isPending}
                      readOnly={!row.canEditIdentity}
                      value={input.phone ?? ""}
                      onChange={(event) =>
                        update(row.id, "phone", event.target.value)
                      }
                    />
                    <ErrorText message={fieldErrors.contact} />
                    <ErrorText message={fieldErrors.phone} />
                  </td>
                  <td className="p-3 align-top">
                    <div className="grid gap-3 py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`SMS-samtycke ${name}`}
                          checked={input.smsOptIn}
                          disabled={isPending || !row.canEditSmsOptIn}
                          onChange={(event) =>
                            update(row.id, "smsOptIn", event.target.checked)
                          }
                        />
                        SMS
                      </label>
                      {row.guestKind === "invited" ? (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`+1 ${name}`}
                            checked={input.plusOneAllowed}
                            disabled={isPending || !row.canEditPlusOneAllowed}
                            onChange={(event) =>
                              update(
                                row.id,
                                "plusOneAllowed",
                                event.target.checked,
                              )
                            }
                          />
                          +1
                        </label>
                      ) : (
                        <span className="text-xs text-[#6f604d]">+1-gäst</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    <div className="grid justify-items-start gap-2">
                      {row.draft ? (
                        <span className="text-xs">
                          Spara för inbjudningslänk
                        </span>
                      ) : (
                        <InviteLinkButton
                          accessScope={row.inviteAccessScope}
                          disabled={dirty || isPending}
                          guestId={row.id}
                          guestName={name}
                        />
                      )}
                      <button
                        className="bulk-button"
                        type="button"
                        aria-expanded={open}
                        aria-controls={`details-${row.id}`}
                        onClick={() => toggle(row.id, setExpanded)}
                      >
                        {open ? "Stäng detaljer" : "Detaljer"}
                        {input.notes?.trim() ? " · notering" : ""}
                      </button>
                      {changed ? (
                        <span className="text-xs font-semibold text-amber-900">
                          Osparad
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>,
                <tr
                  key={`${row.id}-metadata`}
                  data-roster-row="metadata"
                  className={`${changed ? "bg-[#fff0d1]" : "bg-white/80"} border-b border-[#d8c7a3]`}
                >
                  <td colSpan={5} className="px-4 pb-4">
                    <div className="flex flex-wrap gap-2 text-xs text-[#6f604d]">
                      <span>
                        Inbjudan:{" "}
                        {row.inviteStatus === "opened" ? "Sedd" : "Inte sedd"}
                      </span>
                      <span className="sr-only">
                        OSA: {rsvpLabel(input.rsvpStatus ?? row.rsvpStatus)}
                      </span>
                      {row.rsvpDetails?.extraGuests ? (
                        <span>Tar med +1: {row.rsvpDetails.extraGuests}</span>
                      ) : null}
                      {row.rsvpDetails?.foodPreference ? (
                        <span className="roster-dietary">
                          Mat: {row.rsvpDetails.foodPreference}
                        </span>
                      ) : null}
                      {row.rsvpDetails?.allergyNotes ? (
                        <span className="roster-dietary font-semibold">
                          Allergier: {row.rsvpDetails.allergyNotes}
                        </span>
                      ) : null}
                    </div>
                    <div id={`details-${row.id}`} hidden={!open}>
                      <div className="mt-3 grid gap-4 rounded-xl border border-[#d8c7a3] bg-[#f8f1e3] p-4 md:grid-cols-2">
                        <label className="grid gap-2 font-semibold">
                          Privat admin-notering
                          <textarea
                            className="cell-input min-h-28 w-full resize-y"
                            aria-label={`Notering ${name}`}
                            name="notes"
                            value={input.notes ?? ""}
                            disabled={isPending}
                            onChange={(event) =>
                              update(row.id, "notes", event.target.value)
                            }
                          />
                          <span className="text-xs font-normal text-[#6f604d]">
                            Visas inte för gästen eller i cateringunderlaget.
                          </span>
                        </label>
                        <div className="space-y-2 break-words text-[#5d5144]">
                          <p>
                            <strong>Matpreferens:</strong>{" "}
                            {row.rsvpDetails?.foodPreference || "Ej angivet"}
                          </p>
                          <p>
                            <strong>Allergier:</strong>{" "}
                            {row.rsvpDetails?.allergyNotes || "Ej angivet"}
                          </p>
                          <p className="text-xs">
                            Uppdaterad: {row.updatedAtLabel}
                          </p>
                          <p className="text-xs">
                            {row.guestKind === "plus_one"
                              ? "OSA följer den inbjudna gästens svar. Ändra svaret på den gästen. Kontakt och matuppgifter hanteras via deras OSA; admin-noteringar kan redigeras här."
                              : "Ett ändrat OSA-svar gäller även gästens +1. Matuppgifter bevaras. Gästen kan senare uppdatera sitt svar igen."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
        {!visibleRows.length ? (
          <div className="p-8 text-center">
            <p>Inga gäster matchar filtren.</p>
            <button
              className="bulk-button mt-3"
              type="button"
              onClick={clearFilters}
            >
              Visa alla gäster
            </button>
          </div>
        ) : null}
      </div>
      {reloadRequired ? (
        <button
          className="bulk-button"
          type="button"
          onClick={() => window.location.reload()}
        >
          Ladda om sparad gästlista
        </button>
      ) : null}
      {dirty || isPending ? (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#b9955f] bg-[#211910] p-4 text-[#f8f1e3] shadow-xl">
          <div>
            <p className="font-semibold">
              {reloadRequired
                ? "Sparat · ladda om för att fortsätta"
                : isPending
                  ? "Sparar ändringar…"
                  : `${dirtyRows.length} ${dirtyRows.length === 1 ? "osparad rad" : "osparade rader"}`}
            </p>
            <p className="text-xs text-[#d8c7a3]">
              Cmd/Ctrl+S · Alla ändringar sparas, även dolda rader.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-[#b9955f] px-4 py-2 font-semibold disabled:opacity-50"
              type="button"
              disabled={isPending}
              onClick={() => {
                if (
                  dirtyRows.length > 1 &&
                  !window.confirm(
                    `Kasta ändringar på ${dirtyRows.length} rader?`,
                  )
                )
                  return;
                const next = rows.filter((row) => !row.draft);
                setRows(next);
                setValues(valuesFor(next));
                setErrors({});
                setStatus(null);
              }}
            >
              Kasta
            </button>
            <button
              className="rounded-full bg-[#f3dfb9] px-4 py-2 font-bold text-[#211910] disabled:opacity-50"
              type="button"
              disabled={isPending}
              onClick={() => save()}
            >
              Spara ändringar
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
