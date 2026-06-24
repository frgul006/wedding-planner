import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNullableString, isRecord } from "@/lib/type-guards";
import {
  isWeddingUpdateStatus,
  WEDDING_UPDATE_STATUSES,
  type WeddingUpdateStatus,
} from "@/lib/wedding-update-status";

import { AdminField, AdminTextArea } from "../_components/form-controls";
import { createWeddingUpdateAction, updateWeddingUpdateAction } from "./actions";

export const metadata: Metadata = {
  title: "Wedding updates | Wedding Planner",
};

type UpdatesPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
  }>;
};

type WeddingUpdate = {
  id: string;
  title: string;
  message: string;
  link_url: string | null;
  status: WeddingUpdateStatus;
  created_at: string;
  updated_at: string;
};

const updatedAtFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isWeddingUpdate(value: unknown): value is WeddingUpdate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    isNullableString(value.link_url) &&
    typeof value.status === "string" &&
    isWeddingUpdateStatus(value.status) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function getMessage(searchParams: Awaited<UpdatesPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);

  if (error === "missing-title") {
    return { tone: "error", text: "Short title is required." };
  }

  if (error === "missing-message") {
    return { tone: "error", text: "Message text is required." };
  }

  if (error === "invalid-link") {
    return { tone: "error", text: "Link must be a full http or https URL." };
  }

  if (error === "invalid-status") {
    return { tone: "error", text: "Choose draft, published, or archived." };
  }

  if (error === "not-found") {
    return { tone: "error", text: "Update was not found." };
  }

  if (error) {
    return { tone: "error", text: "Could not save the update. Please try again." };
  }

  if (status === "created") {
    return { tone: "success", text: "Wedding update created." };
  }

  if (status === "updated") {
    return { tone: "success", text: "Wedding update saved." };
  }

  return null;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return updatedAtFormatter.format(date);
}

function StatusSelect({ defaultValue }: { defaultValue: WeddingUpdateStatus }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      Status
      <select
        className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal capitalize text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue}
        name="status"
        required
      >
        {WEDDING_UPDATE_STATUSES.map((status) => (
          <option className="capitalize" key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function UpdatesPage({ searchParams }: UpdatesPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("wedding_updates")
    .select("id, title, message, link_url, status, created_at, updated_at")
    .eq("wedding_id", adminProfile.wedding_id)
    .order("updated_at", { ascending: false })
    .limit(100);
  const updates = (data ?? []).filter(isWeddingUpdate);
  const message = getMessage(params);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Wedding updates
            </h1>
            <p className="mt-2 text-zinc-600">
              Post day-of notes and schedule changes for invite pages.
            </p>
          </div>
          <Link
            className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
            href="/admin"
          >
            Back to dashboard
          </Link>
        </div>

        {message ? (
          <div
            aria-live="polite"
            className={`rounded-2xl px-5 py-4 text-sm font-medium ${
              message.tone === "error"
                ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
            }`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-950">Create update</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Published updates appear on guest invite pages. Draft and archived updates stay admin-only.
          </p>
          <form action={createWeddingUpdateAction} className="mt-6 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                label="Short title"
                name="title"
                placeholder="Transport update"
                required
              />
              <StatusSelect defaultValue="published" />
            </div>
            <AdminTextArea
              label="Message text"
              name="message"
              placeholder="Shuttle buses leave the hotel at 14:15."
              required
            />
            <AdminField
              label="Optional link"
              name="link_url"
              placeholder="https://example.com/details"
              type="url"
            />
            <button
              className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 sm:w-fit"
              type="submit"
            >
              Create update
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">Update history</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Showing {updates.length} update{updates.length === 1 ? "" : "s"}, newest first.
            </p>
          </div>

          {error ? (
            <p className="mt-8 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Kunde inte ladda bröllopsuppdateringar. Försök igen.
            </p>
          ) : null}

          {updates.length ? (
            <div className="mt-8 grid gap-5">
              {updates.map((update) => {
                const updateWeddingUpdateWithId = updateWeddingUpdateAction.bind(
                  null,
                  update.id,
                );

                return (
                  <form
                    action={updateWeddingUpdateWithId}
                    className="grid gap-4 rounded-3xl bg-zinc-50 p-5 ring-1 ring-zinc-200"
                    key={update.id}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          {update.status}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          Last edited {formatUpdatedAt(update.updated_at)}
                        </p>
                      </div>
                      <button
                        className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 sm:w-fit"
                        type="submit"
                      >
                        Save update
                      </button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <AdminField
                        defaultValue={update.title}
                        label="Short title"
                        name="title"
                        required
                      />
                      <StatusSelect defaultValue={update.status} />
                    </div>
                    <AdminTextArea
                      defaultValue={update.message}
                      label="Message text"
                      name="message"
                      required
                    />
                    <AdminField
                      defaultValue={update.link_url}
                      label="Optional link"
                      name="link_url"
                      placeholder="https://example.com/details"
                      type="url"
                    />
                  </form>
                );
              })}
            </div>
          ) : null}

          {!updates.length && !error ? (
            <p className="mt-8 rounded-2xl bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
              No updates yet. Create the first published note when guests need timely information.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}
