import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getWeddingSettingsFormValues,
  loadAdminWeddingSettings,
} from "@/lib/wedding-settings";

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

const partnerNameHelpText =
  "Shown on the public invite cover. Leave blank to show a safe public placeholder instead of guessing from the wedding name.";
const partnerNameUnavailableHelpText =
  "Temporarily unavailable until the partner-name database migration is applied. Other settings can still be saved.";

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

  if (error === "invalid-end-date") {
    return {
      tone: "error",
      text: "Wedding end time must be after the wedding date and time.",
    };
  }

  if (error === "invalid-time-plan") {
    return {
      tone: "error",
      text: "Each Time Plan row needs a valid time and label, like 16:30 - Välkomstdrinkar.",
    };
  }

  if (error === "invalid-google-maps-url") {
    return {
      tone: "error",
      text: "Google Maps URL must start with http:// or https://.",
    };
  }

  if (error === "invalid-spotify-url") {
    return {
      tone: "error",
      text: "Spotify playlist URL must start with http:// or https://.",
    };
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

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const { error, partnerNameFieldsAvailable, settings } = await loadAdminWeddingSettings({
    supabase,
    weddingId: adminProfile.wedding_id,
  });
  const formValues = settings ? getWeddingSettingsFormValues(settings) : null;
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
              Manage Wedding settings that will be shown on Invite pages.
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
            Kunde inte ladda bröllopsinställningar. Försök igen.
          </p>
        ) : null}

        {!partnerNameFieldsAvailable ? (
          <p className="rounded-2xl bg-amber-50 px-5 py-4 text-sm font-medium text-amber-800 ring-1 ring-amber-100">
            Partner-name settings are waiting for the database migration. You can
            still edit and save the other wedding settings.
          </p>
        ) : null}

        {formValues ? (
          <form
            action={updateWeddingSettingsAction}
            className="grid gap-6 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200"
          >
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Wedding details</h2>
              <p className="mt-1 text-sm text-zinc-500">
                These values are scoped to your wedding and can be changed any time.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                defaultValue={formValues.name}
                label="Wedding name"
                name="name"
                placeholder="Alex & Sam"
                required
              />
              <AdminField
                defaultValue={formValues.partner_one_name}
                disabled={!partnerNameFieldsAvailable}
                helpText={partnerNameFieldsAvailable ? partnerNameHelpText : partnerNameUnavailableHelpText}
                label="Partner one name"
                name="partner_one_name"
                placeholder="Alex"
              />
              <AdminField
                defaultValue={formValues.partner_two_name}
                disabled={!partnerNameFieldsAvailable}
                helpText={partnerNameFieldsAvailable ? partnerNameHelpText : partnerNameUnavailableHelpText}
                label="Partner two name"
                name="partner_two_name"
                placeholder="Sam"
              />
              <AdminField
                defaultValue={formValues.weddingDateLocal}
                label="Wedding date and time"
                name="wedding_date"
                type="datetime-local"
              />
              <AdminField
                defaultValue={formValues.weddingEndDateLocal}
                helpText="Optional. Used only in calendar downloads; must be after the wedding date and time."
                label="Wedding end time"
                name="wedding_end_date"
                type="datetime-local"
              />
              <AdminField
                defaultValue={formValues.venue_name}
                label="Venue name"
                name="venue_name"
                placeholder="Example Manor"
              />
              <AdminField
                defaultValue={formValues.venue_address}
                label="Venue address"
                name="venue_address"
                placeholder="Garden Road 1, Stockholm"
              />
              <AdminField
                defaultValue={formValues.venue_area}
                label="Venue area / city"
                name="venue_area"
                placeholder="Johanneshov"
              />
              <AdminField
                defaultValue={formValues.google_maps_url}
                label="Google Maps URL"
                name="google_maps_url"
                placeholder="https://maps.google.com/..."
                type="url"
              />
              <AdminField
                defaultValue={formValues.spotify_playlist_url}
                label="Spotify playlist URL"
                name="spotify_playlist_url"
                placeholder="https://open.spotify.com/..."
                type="url"
              />
              <AdminField
                defaultValue={formValues.invite_support_email}
                label="Invite support email"
                name="invite_support_email"
                placeholder="help@example.com"
                type="email"
              />
            </div>

            <AdminTextArea
              defaultValue={formValues.timePlanText}
              helpText="One Time Plan entry per line. Use '16:30 - Välkomstdrinkar'; blank lines are ignored."
              label="Time plan"
              name="time_plan"
              placeholder={"15:00 - Ceremony\n17:00 - Dinner\n21:00 - Dancing"}
              rows={5}
            />
            <AdminTextArea
              defaultValue={formValues.food_and_drink_info}
              helpText="Host-provided guest-facing food and drink details. Separate from RSVP dietary details."
              label="Food & drink information"
              name="food_and_drink_info"
              placeholder="Snittar, middagsbuffé & snacks för alla smaker. Fri bar."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminTextArea
                defaultValue={formValues.dress_code}
                label="Dress code"
                name="dress_code"
                placeholder="Festlig sommarformal"
              />
              <AdminTextArea
                defaultValue={formValues.child_policy}
                label="Child policy"
                name="child_policy"
                placeholder="Vi älskar era barn, men firar vuxet den här kvällen."
              />
            </div>
            <AdminTextArea
              defaultValue={formValues.policy}
              helpText="Legacy field kept for older data; Brevkort invites now use Dress code and Child policy instead."
              label="Legacy policy notes"
              name="policy"
              placeholder="Optional transport notes or other existing policy text."
            />
            <AdminTextArea
              defaultValue={formValues.gift_info}
              label="Gift information"
              name="gift_info"
              placeholder="Tell guests about gifts, registry, or honeymoon contributions."
            />

            <div className="grid gap-3">
              <label className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <input
                  className="mt-1 h-4 w-4 rounded border-zinc-300"
                  defaultChecked={formValues.allow_anonymous_hub_upload}
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

              <label className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <input
                  className="mt-1 h-4 w-4 rounded border-zinc-300"
                  defaultChecked={formValues.photo_upload_requires_review}
                  name="photo_upload_requires_review"
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium text-zinc-950">
                    Require photo review before showing uploads
                  </span>
                  <span className="mt-1 block text-zinc-500">
                    When enabled, verified uploads stay pending until an admin approves them.
                  </span>
                </span>
              </label>
            </div>

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
