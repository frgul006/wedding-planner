import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createGuestAction, updateGuestAction } from "./actions";
import { DeleteGuestButton } from "./delete-guest-button";

export const metadata: Metadata = {
  title: "Guests | Wedding Planner",
};

type GuestsPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    q?: string | string[];
    sort?: string | string[];
    status?: string | string[];
  }>;
};

type Guest = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  invite_status: string;
  created_at: string;
};

const sortOptions = new Set(["name", "name-desc", "status", "newest"]);
const inviteStatuses = [
  "not replied",
  "opened",
  "rsvp yes",
  "rsvp no",
  "rsvp maybe",
];

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getRsvpStatus(inviteStatus: string) {
  if (inviteStatus.startsWith("rsvp ")) {
    return inviteStatus.replace("rsvp ", "");
  }

  return "not submitted";
}

function getMessage(searchParams: Awaited<GuestsPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);

  if (error === "missing-name") {
    return { tone: "error", text: "Full name is required." };
  }

  if (error === "missing-contact") {
    return { tone: "error", text: "Add at least an email or phone number." };
  }

  if (error === "not-found") {
    return { tone: "error", text: "Guest was not found or is already archived." };
  }

  if (error) {
    return { tone: "error", text: "Something went wrong. Please try again." };
  }

  if (status === "created") {
    return { tone: "success", text: "Guest added." };
  }

  if (status === "updated") {
    return { tone: "success", text: "Guest updated." };
  }

  if (status === "deleted") {
    return { tone: "success", text: "Guest archived." };
  }

  return null;
}

function Field({
  defaultValue,
  label,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      {label}
      <input
        className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

export default async function GuestsPage({ searchParams }: GuestsPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const rawQuery = getFirstParam(params.q);
  const rawSort = getFirstParam(params.sort);
  const rawStatus = getFirstParam(params.status);
  const query = (rawQuery ?? "").trim();
  const sort = sortOptions.has(rawSort ?? "") ? rawSort : "name";
  const status = inviteStatuses.includes(rawStatus ?? "") ? rawStatus : "";

  let guestsQuery = supabase
    .from("guests")
    .select("id, full_name, email, phone, notes, invite_status, created_at")
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .limit(500);

  if (query) {
    const escapedQuery = query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    guestsQuery = guestsQuery.or(
      `full_name.ilike.%${escapedQuery}%,phone.ilike.%${escapedQuery}%`,
    );
  }

  if (status) {
    guestsQuery = guestsQuery.eq("invite_status", status);
  }

  if (sort === "name-desc") {
    guestsQuery = guestsQuery.order("full_name", { ascending: false });
  } else if (sort === "status") {
    guestsQuery = guestsQuery.order("invite_status", { ascending: true }).order("full_name");
  } else if (sort === "newest") {
    guestsQuery = guestsQuery.order("created_at", { ascending: false });
  } else {
    guestsQuery = guestsQuery.order("full_name", { ascending: true });
  }

  const { data, error } = await guestsQuery;
  const guests = (data ?? []) as Guest[];
  const message = getMessage(params);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Guests
            </h1>
            <p className="mt-2 text-zinc-600">
              Add, edit, search, and archive invitees for this wedding.
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
            className={`rounded-2xl px-5 py-4 text-sm font-medium ${
              message.tone === "error"
                ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-950">Add guest</h2>
          <form action={createGuestAction} className="mt-6 grid gap-4 lg:grid-cols-4">
            <Field label="Full name" name="full_name" placeholder="Ada Lovelace" required />
            <Field label="Email" name="email" placeholder="ada@example.com" type="email" />
            <Field label="Phone" name="phone" placeholder="+46 70 123 45 67" type="tel" />
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 lg:col-span-4">
              Notes
              <textarea
                className="min-h-24 rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                name="notes"
                placeholder="Optional notes"
              />
            </label>
            <button
              className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 lg:w-fit"
              type="submit"
            >
              Add guest
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Guest list</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Showing {guests.length} active guest{guests.length === 1 ? "" : "s"}.
              </p>
            </div>
            <form className="grid gap-3 sm:grid-cols-3" action="/admin/guests">
              <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
                Search name or phone
                <input
                  className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                  defaultValue={query}
                  name="q"
                  placeholder="Search"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
                Status
                <select
                  className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                  defaultValue={status}
                  name="status"
                >
                  <option value="">All</option>
                  {inviteStatuses.map((inviteStatus) => (
                    <option key={inviteStatus} value={inviteStatus}>
                      {inviteStatus}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
                Sort
                <select
                  className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                  defaultValue={sort}
                  name="sort"
                >
                  <option value="name">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="status">Invite status</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
              <button
                className="rounded-full border border-zinc-300 px-5 py-3 font-medium text-zinc-900 transition hover:bg-zinc-100 sm:col-span-3 sm:w-fit"
                type="submit"
              >
                Apply
              </button>
            </form>
          </div>

          {error ? (
            <p className="mt-8 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Could not load guests. Please try again.
            </p>
          ) : null}

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[960px] border-separate border-spacing-y-3 text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4">Name</th>
                  <th className="px-4">Email</th>
                  <th className="px-4">Phone</th>
                  <th className="px-4">Invite status</th>
                  <th className="px-4">RSVP status</th>
                  <th className="px-4">Notes</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => {
                  const updateGuestWithId = updateGuestAction.bind(null, guest.id);

                  return (
                    <tr className="align-top" key={guest.id}>
                      <td className="rounded-l-2xl bg-zinc-50 p-3">
                        <input
                          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                          defaultValue={guest.full_name}
                          form={`guest-${guest.id}`}
                          name="full_name"
                          required
                        />
                      </td>
                      <td className="bg-zinc-50 p-3">
                        <input
                          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                          defaultValue={guest.email ?? ""}
                          form={`guest-${guest.id}`}
                          name="email"
                          type="email"
                        />
                      </td>
                      <td className="bg-zinc-50 p-3">
                        <input
                          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                          defaultValue={guest.phone ?? ""}
                          form={`guest-${guest.id}`}
                          name="phone"
                          type="tel"
                        />
                      </td>
                      <td className="bg-zinc-50 p-3 capitalize text-zinc-700">
                        {guest.invite_status}
                      </td>
                      <td className="bg-zinc-50 p-3 capitalize text-zinc-700">
                        {getRsvpStatus(guest.invite_status)}
                      </td>
                      <td className="bg-zinc-50 p-3">
                        <textarea
                          className="min-h-20 w-full rounded-xl border border-zinc-200 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                          defaultValue={guest.notes ?? ""}
                          form={`guest-${guest.id}`}
                          name="notes"
                        />
                      </td>
                      <td className="rounded-r-2xl bg-zinc-50 p-3 text-right">
                        <form action={updateGuestWithId} id={`guest-${guest.id}`} />
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-full bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                            form={`guest-${guest.id}`}
                            type="submit"
                          >
                            Save
                          </button>
                          <DeleteGuestButton guestId={guest.id} guestName={guest.full_name} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!guests.length && !error ? (
            <p className="mt-8 rounded-2xl bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
              No guests found. Add the first guest above.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}
