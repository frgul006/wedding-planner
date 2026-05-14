import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { markInviteOpened, validateInviteToken } from "@/lib/invite-tokens";
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_INPUT_PATTERN,
  PHONE_VALIDATION_MESSAGE,
} from "@/lib/phone";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { getSafeHttpUrl } from "@/lib/safe-url";
import { parseTimePlanLine } from "@/lib/time-plan";
import { getPublishedWeddingUpdates } from "@/lib/wedding-updates";

import { InvalidInviteMessage } from "../_components/invalid-invite-message";
import { submitRsvpAction } from "./actions";

export const metadata: Metadata = {
  title: "Inbjudan | Wedding Planner",
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

type ValidInviteResult = Extract<
  Awaited<ReturnType<typeof validateInviteToken>>,
  { isValid: true }
>;

const comingSoon = "Kommer snart";
const panelLabels = ["Inbjudan", "Detaljer", "OSA"] as const;
const panelIds = ["inbjudan", "detaljer", "osa"] as const;
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
      text: `Phone must use country-code format, e.g. ${PHONE_FORMAT_EXAMPLE}. It is required for SMS updates.`,
    };
  }

  if (error === "plus-one-name") {
    return {
      tone: "error",
      text: "Add your +1 guest's name before submitting.",
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

function getAttendanceSummary(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return "Yes, I will be there";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "No, I cannot attend";
  }

  return "Maybe, I will confirm later";
}

function getSwedishAttendanceLabel(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return "Ja";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "Nej";
  }

  return "Kanske";
}

function getSavedAnswerChipClass(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "bg-stone-100 text-stone-700 ring-stone-300";
  }

  return "bg-[#f8ead8] text-[#6f4f33] ring-[#d8b78f]";
}

function getCustomFoodPreference(value: string | null | undefined) {
  if (!value || foodPreferenceOptions.some((option) => option.value === value)) {
    return null;
  }

  return value;
}

function getCoupleMark(name: string) {
  const parts = name
    .split(/\s*(?:&|<3|♥|\+| och )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
  }

  const compactName = name.replace(/[^A-Za-zÅÄÖåäö0-9]/g, "");
  return compactName.slice(0, 2).toUpperCase() || "♡";
}

function ExternalLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      className="inline-flex w-fit rounded-full bg-[#15130f] px-4 py-2 text-sm font-semibold text-[#fffaf0] shadow-sm transition hover:bg-[#3b2b1f]"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function PanelDots({ activeIndex }: { activeIndex: number }) {
  return (
    <div aria-label="Panelnavigation" className="flex items-center gap-2">
      {panelLabels.map((label, index) => (
        <a
          aria-current={activeIndex === index ? "step" : undefined}
          aria-label={`Gå till ${label}`}
          className={`h-3 w-3 rounded-full ring-1 ring-[#6f4f33]/40 transition hover:bg-[#6f4f33] ${
            activeIndex === index ? "bg-[#6f4f33]" : "bg-[#fffaf0]/80"
          }`}
          href={`#${panelIds[index]}`}
          key={label}
        />
      ))}
    </div>
  );
}

function PanelNavigation({
  activeIndex,
  coupleMark,
}: {
  activeIndex: number;
  coupleMark: string;
}) {
  const activeLabel = panelLabels[activeIndex];

  return (
    <nav
      aria-label="Inbjudans paneler"
      className="flex items-center justify-between gap-4 rounded-full bg-[#fffaf0]/70 px-4 py-3 text-[#15130f] ring-1 ring-[#6f4f33]/15 backdrop-blur"
    >
      <a
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#15130f] font-serif text-lg font-semibold tracking-wide text-[#fffaf0]"
        href="#inbjudan"
        aria-label="Till inbjudan"
      >
        {coupleMark}
      </a>
      <div className="min-w-0 flex-1 text-center font-mono uppercase tracking-[0.22em] text-[#6f4f33]">
        <p className="text-[0.68rem]">{String(activeIndex + 1).padStart(2, "0")}/03</p>
        <p className="mt-1 truncate text-[0.7rem] text-[#15130f]">{activeLabel}</p>
      </div>
      <PanelDots activeIndex={activeIndex} />
    </nav>
  );
}

function PanelShell({
  activeIndex,
  children,
  coupleMark,
}: {
  activeIndex: number;
  children: ReactNode;
  coupleMark: string;
}) {
  return (
    <article
      aria-labelledby={`${panelIds[activeIndex]}-heading`}
      className="scroll-mt-4 rounded-[2rem] bg-[#e6dcc7] p-4 shadow-xl shadow-[#6f4f33]/10 ring-1 ring-[#6f4f33]/15 sm:p-6"
      id={panelIds[activeIndex]}
    >
      <PanelNavigation activeIndex={activeIndex} coupleMark={coupleMark} />
      {children}
    </article>
  );
}

function DetailCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-[1.75rem] bg-[#fffaf0]/85 p-5 shadow-sm ring-1 ring-[#6f4f33]/15">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
        {title}
      </h3>
      <div className="mt-4 text-[#15130f]">{children}</div>
    </section>
  );
}

function PanelActions({
  children,
  secondaryHref,
  secondaryLabel,
}: {
  children: ReactNode;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
      {children}
      {secondaryHref && secondaryLabel ? (
        <a
          className="inline-flex justify-center rounded-full border border-[#6f4f33]/40 px-5 py-3 text-sm font-semibold text-[#6f4f33] transition hover:bg-[#fffaf0]/70"
          href={secondaryHref}
        >
          {secondaryLabel}
        </a>
      ) : null}
    </div>
  );
}

function CoverPanel({
  coupleMark,
  guestName,
  rsvpResponse,
  rsvpSubmittedAt,
  venueSummary,
  weddingDate,
  weddingName,
}: {
  coupleMark: string;
  guestName: string;
  rsvpResponse: null | { attendance: RsvpAttendance };
  rsvpSubmittedAt: string | null;
  venueSummary: string;
  weddingDate: string;
  weddingName: string;
}) {
  return (
    <PanelShell activeIndex={0} coupleMark={coupleMark}>
      <div className="flex min-h-[calc(100dvh-10rem)] flex-col justify-between px-2 py-10 sm:px-6">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.26em] text-[#6f4f33]">
            Personlig inbjudan för {guestName}
          </p>
          <h1
            className="mt-8 font-serif text-5xl font-semibold leading-none tracking-tight text-[#15130f] sm:text-6xl"
            id="inbjudan-heading"
          >
            {weddingName}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-[#3b2b1f]">
            Vi hoppas att du vill fira kärleken med oss.
          </p>
        </div>

        <div className="mt-10 grid gap-5">
          <div className="rounded-[1.75rem] bg-[#fffaf0]/75 p-5 ring-1 ring-[#6f4f33]/15">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
              Datum & plats
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-[#15130f]">
              {weddingDate}
            </p>
            <p className="mt-2 text-[#6f4f33]">{venueSummary}</p>
          </div>

          {rsvpResponse ? (
            <div className="rounded-[1.75rem] bg-[#fffaf0]/85 p-5 ring-1 ring-[#6f4f33]/15">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${getSavedAnswerChipClass(
                    rsvpResponse.attendance,
                  )}`}
                >
                  Sparat svar: {getSwedishAttendanceLabel(rsvpResponse.attendance)}
                </span>
                {rsvpSubmittedAt ? (
                  <span className="text-sm text-[#6f4f33]">Senast uppdaterat {rsvpSubmittedAt}</span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-[#3b2b1f]">
                Ditt svar finns sparat. Du kan läsa detaljerna igen eller gå direkt
                till OSA-panelen om du behöver ändra något.
              </p>
              <PanelActions secondaryHref="#detaljer" secondaryLabel="Läs detaljer">
                <a
                  className="inline-flex justify-center rounded-full bg-[#b34a2c] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#91391f]"
                  href="#osa"
                >
                  Uppdatera svar
                </a>
              </PanelActions>
            </div>
          ) : (
            <div className="rounded-[1.75rem] bg-[#fffaf0]/85 p-5 ring-1 ring-[#6f4f33]/15">
              <span className="rounded-full bg-[#f8ead8] px-3 py-1 text-sm font-semibold text-[#6f4f33] ring-1 ring-[#d8b78f]">
                Öppnad · inget svar än
              </span>
              <p className="mt-3 text-sm leading-6 text-[#3b2b1f]">
                Börja med detaljerna och gå sedan vidare till OSA när du är redo
                att svara.
              </p>
              <PanelActions secondaryHref="#osa" secondaryLabel="Gå direkt till OSA">
                <a
                  className="inline-flex justify-center rounded-full bg-[#15130f] px-5 py-3 text-sm font-semibold text-[#fffaf0] shadow-sm transition hover:bg-[#3b2b1f]"
                  href="#detaljer"
                >
                  Se detaljerna
                </a>
              </PanelActions>
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function DetailsPanel({
  coupleMark,
  mapsUrl,
  spotifyUrl,
  updates,
  wedding,
  weddingDate,
}: {
  coupleMark: string;
  mapsUrl: string | null;
  spotifyUrl: string | null;
  updates: Awaited<ReturnType<typeof getPublishedWeddingUpdates>>;
  wedding: ValidInviteResult["wedding"];
  weddingDate: string;
}) {
  return (
    <PanelShell activeIndex={1} coupleMark={coupleMark}>
      <div className="px-2 py-8 sm:px-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.26em] text-[#6f4f33]">
          Allt inför dagen
        </p>
        <h2
          className="mt-3 font-serif text-4xl font-semibold tracking-tight text-[#15130f]"
          id="detaljer-heading"
        >
          Detaljer
        </h2>
        <p className="mt-3 max-w-2xl leading-7 text-[#3b2b1f]">
          Här finns tider, plats och praktisk information. Uppdateringar läggs
          till här när något nytt publiceras.
        </p>

        <div className="mt-8 grid gap-5">
          <DetailCard title="Tidsplan">
            {wedding.time_plan.length ? (
              <ol className="grid gap-3">
                {wedding.time_plan.map((item, index) => {
                  const entry = parseTimePlanLine(item);

                  return (
                    <li
                      className="rounded-2xl bg-[#e6dcc7]/80 p-4 text-[#15130f]"
                      key={`${index}-${item}`}
                    >
                      {entry?.time ? (
                        <p>
                          <span className="font-mono text-sm font-semibold text-[#b34a2c]">
                            {entry.time}
                          </span>{" "}
                          - {entry.label}
                        </p>
                      ) : (
                        <p>{entry?.label ?? item}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p>{comingSoon}</p>
            )}
          </DetailCard>

          <DetailCard title="Plats">
            <div className="grid gap-4">
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {getDisplayText(wedding.venue_name)}
                </p>
                {wedding.venue_area ? (
                  <p className="mt-1 text-[#6f4f33]">{wedding.venue_area}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-line leading-7 text-[#3b2b1f]">
                  {getDisplayText(wedding.venue_address)}
                </p>
                <p className="mt-2 text-sm text-[#6f4f33]">{weddingDate}</p>
              </div>
              {mapsUrl ? (
                <ExternalLink href={mapsUrl}>Visa karta</ExternalLink>
              ) : (
                <p className="text-sm text-[#6f4f33]">Kartlänk kommer snart</p>
              )}
            </div>
          </DetailCard>

          <div className="grid gap-5 md:grid-cols-2">
            <DetailCard title="Klädkod">
              <div className="grid gap-3 leading-7">
                <p className="whitespace-pre-line">
                  {getDisplayText(wedding.dress_code ?? wedding.policy)}
                </p>
                {wedding.child_policy ? (
                  <p className="whitespace-pre-line text-[#6f4f33]">
                    {wedding.child_policy}
                  </p>
                ) : null}
                {wedding.dress_code && wedding.policy ? (
                  <p className="whitespace-pre-line text-sm text-[#6f4f33]">
                    {wedding.policy}
                  </p>
                ) : null}
              </div>
            </DetailCard>

            <DetailCard title="Gåvor">
              <p className="whitespace-pre-line leading-7">
                {getDisplayText(wedding.gift_info)}
              </p>
            </DetailCard>
          </div>

          <DetailCard title="Musik">
            {spotifyUrl ? (
              <div className="grid gap-4">
                <p className="leading-7 text-[#3b2b1f]">
                  Önska låtar eller kom i stämning inför festen.
                </p>
                <ExternalLink href={spotifyUrl}>Öppna Spotify</ExternalLink>
              </div>
            ) : (
              <p>{comingSoon}</p>
            )}
          </DetailCard>

          <DetailCard title="Uppdateringar">
            {updates.length ? (
              <ol className="grid gap-4">
                {updates.map((update) => {
                  const updateLink = getSafeHttpUrl(update.link_url);
                  const publishedAt = formatPublishedUpdateAt(update.updated_at);

                  return (
                    <li className="rounded-2xl bg-[#e6dcc7]/80 p-4" key={update.id}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <h4 className="text-xl font-semibold text-[#15130f]">
                          {update.title}
                        </h4>
                        {publishedAt ? (
                          <time
                            className="font-mono text-xs uppercase tracking-[0.12em] text-[#6f4f33]"
                            dateTime={update.updated_at}
                          >
                            {publishedAt}
                          </time>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line leading-7 text-[#3b2b1f]">
                        {update.message}
                      </p>
                      {updateLink ? (
                        <div className="mt-4">
                          <ExternalLink href={updateLink}>Öppna länk</ExternalLink>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-lg font-semibold tracking-tight text-[#15130f]">
                Inga uppdateringar än.
              </p>
            )}
          </DetailCard>
        </div>

        <PanelActions secondaryHref="#inbjudan" secondaryLabel="Till inbjudan">
          <a
            className="inline-flex justify-center rounded-full bg-[#15130f] px-5 py-3 text-sm font-semibold text-[#fffaf0] shadow-sm transition hover:bg-[#3b2b1f]"
            href="#osa"
          >
            Vidare till OSA
          </a>
        </PanelActions>
      </div>
    </PanelShell>
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
  const venueSummary = `${getDisplayText(wedding.venue_name)} · ${getDisplayText(
    wedding.venue_area ?? wedding.venue_address,
  )}`;
  const mapsUrl = getSafeHttpUrl(wedding.google_maps_url);
  const spotifyUrl = getSafeHttpUrl(wedding.spotify_playlist_url);
  const submitRsvpWithToken = submitRsvpAction.bind(null, token);
  const rsvpMessage = getRsvpMessage(queryParams);
  const rsvpSubmittedAt = formatRsvpSubmittedAt(
    rsvpResponse?.last_submitted_at ?? null,
  );
  const customFoodPreference = getCustomFoodPreference(rsvpResponse?.food_preference);
  const coupleMark = getCoupleMark(wedding.name);

  return (
    <main className="min-h-dvh bg-[#f1eadc] px-4 py-5 text-[#15130f] sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <CoverPanel
          coupleMark={coupleMark}
          guestName={guest.full_name}
          rsvpResponse={rsvpResponse ? { attendance: rsvpResponse.attendance } : null}
          rsvpSubmittedAt={rsvpSubmittedAt}
          venueSummary={venueSummary}
          weddingDate={weddingDate}
          weddingName={wedding.name}
        />

        <DetailsPanel
          coupleMark={coupleMark}
          mapsUrl={mapsUrl}
          spotifyUrl={spotifyUrl}
          updates={updates}
          wedding={wedding}
          weddingDate={weddingDate}
        />

        <PanelShell activeIndex={2} coupleMark={coupleMark}>
          <div className="px-2 py-8 sm:px-6">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.26em] text-[#6f4f33]">
              Svara när du kan
            </p>
            <h2
              className="mt-3 font-serif text-4xl font-semibold tracking-tight text-[#15130f]"
              id="osa-heading"
            >
              OSA
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-[#3b2b1f]">
              Svara eller uppdatera ditt svar här när du vet om du kan komma.
            </p>

            <section className="mt-8 rounded-[2rem] bg-zinc-950 p-6 text-white shadow-sm sm:p-8">
              <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
                RSVP
              </p>
              <h3 className="mt-3 text-3xl font-semibold tracking-tight">
                {rsvpResponse
                  ? "Review or update your RSVP"
                  : "Let us know if you can make it"}
              </h3>
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
                    <p>
                      Food preference: {rsvpResponse.food_preference ?? "No preference"}
                    </p>
                    {rsvpResponse.plus_one_name ? (
                      <p>+1: {rsvpResponse.plus_one_name}</p>
                    ) : null}
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
                      [RSVP_ATTENDANCE.yes, "Yes", "I will be there"],
                      [RSVP_ATTENDANCE.no, "No", "I cannot attend"],
                      [RSVP_ATTENDANCE.maybe, "Maybe", "I will confirm later"],
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
                          <span className="mt-1 block text-sm text-zinc-300">
                            {description}
                          </span>
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

                <label className="flex gap-3 rounded-2xl bg-white/10 p-4 text-sm font-medium text-white ring-1 ring-white/15">
                  <input
                    className="mt-1 h-4 w-4 accent-white"
                    defaultChecked={guest.sms_opt_in}
                    name="sms_opt_in"
                    type="checkbox"
                  />
                  <span>
                    Send me important SMS updates about the wedding. You can uncheck
                    this later from the same invite link.
                  </span>
                </label>

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
        </PanelShell>
      </div>
    </main>
  );
}
