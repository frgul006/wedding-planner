import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { markInviteOpened, validateInviteToken } from "@/lib/invite-tokens";
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_INPUT_PATTERN,
  PHONE_VALIDATION_MESSAGE,
} from "@/lib/phone";
import { getSafeHttpUrl } from "@/lib/safe-url";
import { getPublishedWeddingUpdates } from "@/lib/wedding-updates";

import { InvalidInviteMessage } from "../_components/invalid-invite-message";
import { submitRsvpAction } from "./actions";

export const metadata: Metadata = {
  title: "Invite | Wedding Planner",
};

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    rsvp_error?: string | string[];
    rsvp_status?: string | string[];
  }>;
};

const comingSoon = "Coming soon";
const foodPreferenceOptions = [
  { label: "Vegetarian", value: "Vegetarian" },
  { label: "Vegan", value: "Vegan" },
  { label: "Fish", value: "Fish" },
  { label: "Meat", value: "Meat" },
  { label: "Other / see notes", value: "Other" },
] as const;

const weddingDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

const rsvpSubmittedFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

const updatePublishedFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function formatWeddingDate(value: string | null) {
  if (!value) {
    return comingSoon;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return comingSoon;
  }

  return weddingDateFormatter.format(date);
}

function formatRsvpSubmittedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return rsvpSubmittedFormatter.format(date);
}

function formatPublishedUpdateAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return updatePublishedFormatter.format(date);
}

function getDisplayText(value: string | null) {
  const text = value?.trim();
  return text ? text : comingSoon;
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getRsvpMessage(searchParams: Awaited<InvitePageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.rsvp_error);
  const status = getFirstParam(searchParams.rsvp_status);

  if (error === "attendance") {
    return { tone: "error", text: "Choose Yes, No, or Maybe before submitting." };
  }

  if (error === "extra-guests") {
    return {
      tone: "error",
      text: "Extra guest count must be a whole number of 0 or more.",
    };
  }

  if (error === "phone") {
    return {
      tone: "error",
      text: `Phone must use country-code format, e.g. ${PHONE_FORMAT_EXAMPLE}.`,
    };
  }

  if (error) {
    return {
      tone: "error",
      text: "We could not save your RSVP. Please check the form and try again.",
    };
  }

  if (status === "submitted") {
    return { tone: "success", text: "Thank you — your RSVP has been saved." };
  }

  return null;
}

function getAttendanceSummary(attendance: "yes" | "no" | "maybe") {
  if (attendance === "yes") {
    return "Yes, I will be there";
  }

  if (attendance === "no") {
    return "No, I cannot attend";
  }

  return "Maybe, I will confirm later";
}

function getCustomFoodPreference(value: string | null | undefined) {
  if (!value || foodPreferenceOptions.some((option) => option.value === value)) {
    return null;
  }

  return value;
}

function ExternalLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      className="inline-flex rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function DetailCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="mt-3 text-zinc-700">{children}</div>
    </section>
  );
}

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  await connection();

  const [{ token }, queryParams] = await Promise.all([params, searchParams]);
  const result = await validateInviteToken(token);

  if (!result.isValid) {
    return <InvalidInviteMessage />;
  }

  await markInviteOpened({ guestId: result.guestId, weddingId: result.weddingId });

  const updates = await getPublishedWeddingUpdates({ weddingId: result.weddingId });
  const { guest, rsvpResponse, wedding } = result;
  const weddingDate = formatWeddingDate(wedding.wedding_date);
  const mapsUrl = getSafeHttpUrl(wedding.google_maps_url);
  const spotifyUrl = getSafeHttpUrl(wedding.spotify_playlist_url);
  const submitRsvpWithToken = submitRsvpAction.bind(null, token);
  const rsvpMessage = getRsvpMessage(queryParams);
  const rsvpSubmittedAt = formatRsvpSubmittedAt(
    rsvpResponse?.last_submitted_at ?? null,
  );
  const customFoodPreference = getCustomFoodPreference(rsvpResponse?.food_preference);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Wedding Planner
          </p>
          <p className="mt-6 text-sm font-medium text-zinc-500">
            Private invite for {guest.full_name}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
            {wedding.name}
          </h1>
          <p className="mt-4 text-lg text-zinc-700">{weddingDate}</p>
          <p className="mt-2 text-zinc-600">
            {getDisplayText(wedding.venue_name)} · {getDisplayText(wedding.venue_address)}
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <DetailCard title="When">
            <p className="text-2xl font-semibold tracking-tight text-zinc-950">
              {weddingDate}
            </p>
          </DetailCard>

          <DetailCard title="Venue">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xl font-semibold text-zinc-950">
                  {getDisplayText(wedding.venue_name)}
                </p>
                <p className="mt-1 whitespace-pre-line text-zinc-600">
                  {getDisplayText(wedding.venue_address)}
                </p>
              </div>
              {mapsUrl ? (
                <ExternalLink href={mapsUrl}>Open in Google Maps</ExternalLink>
              ) : (
                <p className="text-sm text-zinc-500">Google Maps link coming soon</p>
              )}
            </div>
          </DetailCard>
        </div>

        <DetailCard title="Time plan">
          {wedding.time_plan.length ? (
            <ol className="grid gap-3">
              {wedding.time_plan.map((item, index) => (
                <li
                  className="rounded-2xl bg-zinc-50 px-4 py-3 text-zinc-700"
                  key={`${index}-${item}`}
                >
                  {item}
                </li>
              ))}
            </ol>
          ) : (
            <p>{comingSoon}</p>
          )}
        </DetailCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <DetailCard title="Policy / dress code">
            <p className="whitespace-pre-line">{getDisplayText(wedding.policy)}</p>
          </DetailCard>

          <DetailCard title="Gift information">
            <p className="whitespace-pre-line">{getDisplayText(wedding.gift_info)}</p>
          </DetailCard>
        </div>

        <DetailCard title="Music">
          {spotifyUrl ? (
            <div className="flex flex-col gap-3">
              <p>Add song requests or get in the mood before the party.</p>
              <ExternalLink href={spotifyUrl}>Open Spotify playlist</ExternalLink>
            </div>
          ) : (
            <p>{comingSoon}</p>
          )}
        </DetailCard>

        <DetailCard title="Updates">
          {updates.length ? (
            <ol className="grid gap-4">
              {updates.map((update) => {
                const updateLink = getSafeHttpUrl(update.link_url);
                const publishedAt = formatPublishedUpdateAt(update.updated_at);

                return (
                  <li className="rounded-2xl bg-zinc-50 p-4" key={update.id}>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-xl font-semibold text-zinc-950">{update.title}</h3>
                      {publishedAt ? (
                        <time
                          className="text-sm text-zinc-500"
                          dateTime={update.updated_at}
                        >
                          {publishedAt}
                        </time>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-line text-zinc-700">
                      {update.message}
                    </p>
                    {updateLink ? (
                      <div className="mt-4">
                        <ExternalLink href={updateLink}>Open update link</ExternalLink>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-2xl font-semibold tracking-tight text-zinc-950">
                No updates yet
              </p>
              <p className="text-zinc-600">
                Wedding-day notes and schedule changes will appear here when published.
              </p>
            </div>
          )}
        </DetailCard>

        <section className="rounded-[2rem] bg-zinc-950 p-8 text-white shadow-sm">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            RSVP
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            {rsvpResponse ? "Review or update your RSVP" : "Let us know if you can make it"}
          </h2>
          <p className="mt-3 max-w-2xl text-zinc-300">
            {rsvpResponse
              ? "We have your latest answer. You can update it below if your plans or notes change."
              : "Please send your answer and any food or allergy notes so we can plan the day."}
          </p>

          {rsvpMessage ? (
            <p
              aria-live="polite"
              className={`mt-6 rounded-2xl px-5 py-4 text-sm font-medium ${
                rsvpMessage.tone === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
              role={rsvpMessage.tone === "error" ? "alert" : "status"}
            >
              {rsvpMessage.text}
            </p>
          ) : null}

          {rsvpResponse ? (
            <div className="mt-6 rounded-3xl bg-white/10 p-5 ring-1 ring-white/15">
              <p className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Current RSVP
              </p>
              <p className="mt-2 text-xl font-semibold">
                {getAttendanceSummary(rsvpResponse.attendance)}
              </p>
              <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                <p>Extra guests: {rsvpResponse.extra_guests}</p>
                <p>Food preference: {rsvpResponse.food_preference ?? "No preference"}</p>
                {rsvpSubmittedAt ? <p>Last updated: {rsvpSubmittedAt}</p> : null}
              </div>
              {rsvpResponse.allergy_notes ? (
                <p className="mt-3 whitespace-pre-line text-sm text-zinc-300">
                  Notes: {rsvpResponse.allergy_notes}
                </p>
              ) : null}
            </div>
          ) : null}

          <form action={submitRsvpWithToken} className="mt-8 grid gap-6" noValidate>
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Attendance
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["yes", "Yes", "I will be there"],
                  ["no", "No", "I cannot attend"],
                  ["maybe", "Maybe", "I will confirm later"],
                ].map(([value, label, description]) => (
                  <label
                    className="flex cursor-pointer gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 transition hover:bg-white/15"
                    key={value}
                  >
                    <input
                      className="mt-1 h-4 w-4 accent-white"
                      defaultChecked={rsvpResponse?.attendance === value}
                      name="attendance"
                      required
                      type="radio"
                      value={value}
                    />
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="mt-1 block text-sm text-zinc-300">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 lg:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Phone (optional)
                <input
                  className="rounded-2xl border border-white/20 bg-white px-4 py-3 font-normal tracking-normal text-zinc-950 outline-none transition focus:border-white focus:ring-2 focus:ring-white/40"
                  defaultValue={guest.phone ?? ""}
                  inputMode="tel"
                  name="phone"
                  pattern={PHONE_INPUT_PATTERN}
                  placeholder={PHONE_FORMAT_EXAMPLE}
                  title={PHONE_VALIDATION_MESSAGE}
                  type="tel"
                />
                <span className="text-xs font-normal normal-case tracking-normal text-zinc-300">
                  {PHONE_VALIDATION_MESSAGE}
                </span>
              </label>

              <label className="flex flex-col gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Extra guest count
                <input
                  className="rounded-2xl border border-white/20 bg-white px-4 py-3 font-normal tracking-normal text-zinc-950 outline-none transition focus:border-white focus:ring-2 focus:ring-white/40"
                  defaultValue={rsvpResponse?.extra_guests ?? 0}
                  min="0"
                  name="extra_guests"
                  required
                  step="1"
                  type="number"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Food preference
                <select
                  className="rounded-2xl border border-white/20 bg-white px-4 py-3 font-normal tracking-normal text-zinc-950 outline-none transition focus:border-white focus:ring-2 focus:ring-white/40"
                  defaultValue={rsvpResponse?.food_preference ?? ""}
                  name="food_preference"
                >
                  <option value="">No preference</option>
                  {foodPreferenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {customFoodPreference ? (
                    <option value={customFoodPreference}>{customFoodPreference}</option>
                  ) : null}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Allergy / special notes
              <textarea
                className="min-h-28 rounded-2xl border border-white/20 bg-white px-4 py-3 font-normal tracking-normal text-zinc-950 outline-none transition focus:border-white focus:ring-2 focus:ring-white/40"
                defaultValue={rsvpResponse?.allergy_notes ?? ""}
                name="allergy_notes"
                placeholder="Tell us about allergies, accessibility needs, or anything else we should know."
              />
            </label>

            <button
              className="rounded-full bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200 sm:w-fit"
              type="submit"
            >
              {rsvpResponse ? "Update RSVP" : "Submit RSVP"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
