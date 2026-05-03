import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { validateInviteToken } from "@/lib/invite-tokens";

export const metadata: Metadata = {
  title: "Invite | Wedding Planner",
};

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

const comingSoon = "Coming soon";

const weddingDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "full",
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

function getDisplayText(value: string | null) {
  const text = value?.trim();
  return text ? text : comingSoon;
}

function getSafeExternalUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
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

export default async function InvitePage({ params }: InvitePageProps) {
  await connection();

  const { token } = await params;
  const result = await validateInviteToken(token);

  if (!result.isValid) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 py-10">
        <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Wedding Planner
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
            Invite link not valid
          </h1>
          <p className="mt-3 text-zinc-600">
            This invite link is invalid or no longer active.
          </p>
        </section>
      </main>
    );
  }

  const { guest, wedding } = result;
  const weddingDate = formatWeddingDate(wedding.wedding_date);
  const mapsUrl = getSafeExternalUrl(wedding.google_maps_url);
  const spotifyUrl = getSafeExternalUrl(wedding.spotify_playlist_url);

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

        <section className="rounded-[2rem] bg-zinc-950 p-8 text-white shadow-sm">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            RSVP
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">RSVP coming soon</h2>
          <p className="mt-3 max-w-2xl text-zinc-300">
            Your invite link is ready. The RSVP form will be added here in a future update.
          </p>
        </section>
      </div>
    </main>
  );
}
