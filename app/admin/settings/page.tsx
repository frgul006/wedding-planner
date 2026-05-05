import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNullableString, isRecord, isStringArray } from "@/lib/type-guards";

import { AdminField, AdminTextArea } from "../_components/form-controls";
import { updateWeddingSettingsAction } from "./actions";

export const metadata: Metadata = {
  title: "Wedding settings | Wedding Planner",
};

type SettingsPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
  }>;
};

type Wedding = {
  name: string;
  wedding_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  google_maps_url: string | null;
  time_plan: string[];
  policy: string | null;
  gift_info: string | null;
  spotify_playlist_url: string | null;
  allow_anonymous_hub_upload: boolean;
};

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getMessage(searchParams: Awaited<SettingsPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);

  if (error === "missing-name") {
    return { tone: "error", text: "Wedding name is required." };
  }

  if (error === "invalid-date") {
    return { tone: "error", text: "Wedding date must be a valid date and time." };
  }

  if (error === "not-found") {
    return { tone: "error", text: "Wedding settings were not found." };
  }

  if (error) {
    return { tone: "error", text: "Could not update wedding settings. Please try again." };
  }

  if (status === "updated") {
    return { tone: "success", text: "Wedding settings updated." };
  }

  return null;
}

function formatDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toWedding(value: unknown): Wedding | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isNullableString(value.wedding_date) ||
    !isNullableString(value.venue_name) ||
    !isNullableString(value.venue_address) ||
    !isNullableString(value.google_maps_url) ||
    !isNullableString(value.policy) ||
    !isNullableString(value.gift_info) ||
    !isNullableString(value.spotify_playlist_url) ||
    typeof value.allow_anonymous_hub_upload !== "boolean"
  ) {
    return null;
  }

  return {
    allow_anonymous_hub_upload: value.allow_anonymous_hub_upload,
    gift_info: value.gift_info,
    google_maps_url: value.google_maps_url,
    name: value.name,
    policy: value.policy,
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: isStringArray(value.time_plan) ? value.time_plan : [],
    venue_address: value.venue_address,
    venue_name: value.venue_name,
    wedding_date: value.wedding_date,
  };
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("weddings")
    .select(
      "name, wedding_date, venue_name, venue_address, google_maps_url, time_plan, policy, gift_info, spotify_playlist_url, allow_anonymous_hub_upload",
    )
    .eq("id", adminProfile.wedding_id)
    .maybeSingle();
  const wedding = toWedding(data);
  const message = getMessage(params);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Wedding settings
            </h1>
            <p className="mt-2 text-zinc-600">
              Manage event details that will be shown on invite pages.
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

        {error ? (
          <p className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
            Could not load wedding settings. Please try again.
          </p>
        ) : null}

        {wedding ? (
          <form
            action={updateWeddingSettingsAction}
            className="grid gap-6 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200"
          >
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Event details</h2>
              <p className="mt-1 text-sm text-zinc-500">
                These values are scoped to your wedding and can be changed any time.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                defaultValue={wedding.name}
                label="Wedding name"
                name="name"
                placeholder="Alex & Sam"
                required
              />
              <AdminField
                defaultValue={formatDateTimeLocal(wedding.wedding_date)}
                label="Wedding date and time"
                name="wedding_date"
                type="datetime-local"
              />
              <AdminField
                defaultValue={wedding.venue_name}
                label="Venue name"
                name="venue_name"
                placeholder="Example Manor"
              />
              <AdminField
                defaultValue={wedding.venue_address}
                label="Venue address"
                name="venue_address"
                placeholder="Garden Road 1, Stockholm"
              />
              <AdminField
                defaultValue={wedding.google_maps_url}
                label="Google Maps URL"
                name="google_maps_url"
                placeholder="https://maps.google.com/..."
                type="url"
              />
              <AdminField
                defaultValue={wedding.spotify_playlist_url}
                label="Spotify playlist URL"
                name="spotify_playlist_url"
                placeholder="https://open.spotify.com/..."
                type="url"
              />
            </div>

            <AdminTextArea
              defaultValue={(wedding.time_plan ?? []).join("\n")}
              helpText="One timeline item per line. Blank lines are ignored."
              label="Time plan"
              name="time_plan"
              placeholder={"15:00 - Ceremony\n17:00 - Dinner\n21:00 - Dancing"}
              rows={5}
            />
            <AdminTextArea
              defaultValue={wedding.policy}
              label="Policy / dress code"
              name="policy"
              placeholder="Dress code, children policy, transport notes, or other important details."
            />
            <AdminTextArea
              defaultValue={wedding.gift_info}
              label="Gift information"
              name="gift_info"
              placeholder="Tell guests about gifts, registry, or honeymoon contributions."
            />

            <label className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
              <input
                className="mt-1 h-4 w-4 rounded border-zinc-300"
                defaultChecked={wedding.allow_anonymous_hub_upload}
                name="allow_anonymous_hub_upload"
                type="checkbox"
              />
              <span>
                <span className="block font-medium text-zinc-950">
                  Allow anonymous wedding hub uploads
                </span>
                <span className="mt-1 block text-zinc-500">
                  When enabled, future public hub visitors can upload without first opening a private invite link.
                </span>
              </span>
            </label>

            <button
              className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 sm:w-fit"
              type="submit"
            >
              Save wedding settings
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
