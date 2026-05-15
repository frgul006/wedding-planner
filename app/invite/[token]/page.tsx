import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { markInviteOpened, validateInviteToken } from "@/lib/invite-tokens";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { getSafeHttpUrl } from "@/lib/safe-url";
import { parseTimePlanLine } from "@/lib/time-plan";
import { getPublishedWeddingUpdates } from "@/lib/wedding-updates";

import {
  BrevkortBodyText,
  BrevkortCard,
  BrevkortHeading,
  BrevkortKicker,
  BrevkortLinkButton,
  BrevkortPage,
  BrevkortPanel,
  BrevkortStack,
  BrevkortStatusStrip,
  cx,
} from "../_components/brevkort-primitives";
import { InvalidInviteMessage } from "../_components/invalid-invite-message";
import { RsvpPanel } from "./rsvp-panel";

export const metadata: Metadata = {
  title: "Inbjudan | Wedding Planner",
};

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
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
    return "bg-invite-paper-muted text-invite-success ring-invite-success/30";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "bg-invite-paper-muted text-invite-body ring-invite-border-soft";
  }

  return "bg-invite-paper text-invite-walnut ring-invite-border";
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
    <BrevkortLinkButton className="w-fit" href={href} rel="noopener noreferrer" target="_blank" tone="outline">
      {children} →
    </BrevkortLinkButton>
  );
}

function PanelDots({ activeIndex }: { activeIndex: number }) {
  return (
    <div aria-label="Panelnavigation" className="flex items-center gap-2">
      {panelLabels.map((label, index) => (
        <a
          aria-current={activeIndex === index ? "step" : undefined}
          aria-label={`Gå till ${label}`}
          className={cx(
            "h-2.5 rounded-full ring-1 ring-invite-walnut/30 transition hover:bg-invite-ink",
            activeIndex === index ? "w-6 bg-invite-ink" : "w-2.5 bg-invite-border-soft",
          )}
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
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-invite-border-soft pb-4 text-invite-ink"
    >
      <a
        className="brevkort-metadata justify-self-start text-[0.68rem] font-semibold text-invite-rust"
        href="#inbjudan"
        aria-label="Till inbjudan"
      >
        {coupleMark} · {String(activeIndex + 1).padStart(2, "0")}/03
      </a>
      <PanelDots activeIndex={activeIndex} />
      <p className="brevkort-metadata justify-self-end text-[0.68rem] text-invite-ink">
        {activeLabel}
      </p>
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
    <BrevkortPanel aria-labelledby={`${panelIds[activeIndex]}-heading`} id={panelIds[activeIndex]}>
      <PanelNavigation activeIndex={activeIndex} coupleMark={coupleMark} />
      {children}
    </BrevkortPanel>
  );
}

function DetailCard({ children, title }: { children: ReactNode; title: string }) {
  return <BrevkortCard title={title} titleAsHeading>{children}</BrevkortCard>;
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
        <BrevkortLinkButton href={secondaryHref} tone="outline">
          {secondaryLabel}
        </BrevkortLinkButton>
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
          <BrevkortKicker>Personlig inbjudan för {guestName}</BrevkortKicker>
          <BrevkortHeading className="mt-8 text-5xl sm:text-6xl" id="inbjudan-heading" level={1}>
            {weddingName}
          </BrevkortHeading>
          <BrevkortBodyText className="mt-6 max-w-md text-lg leading-8">
            Vi hoppas att du vill fira kärleken med oss.
          </BrevkortBodyText>
        </div>

        <div className="mt-10 grid gap-5">
          <BrevkortCard className="bg-invite-paper-light/80" title="Datum & plats">
            <p className="brevkort-display text-2xl font-semibold tracking-tight text-invite-ink">
              {weddingDate}
            </p>
            <p className="mt-2 text-invite-walnut">{venueSummary}</p>
          </BrevkortCard>

          {rsvpResponse ? (
            <BrevkortStatusStrip tone="success">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cx(
                    "px-3 py-1 text-sm font-semibold ring-1",
                    getSavedAnswerChipClass(rsvpResponse.attendance),
                  )}
                >
                  Sparat svar: {getSwedishAttendanceLabel(rsvpResponse.attendance)}
                </span>
                {rsvpSubmittedAt ? (
                  <span className="text-sm text-invite-walnut">Senast uppdaterat {rsvpSubmittedAt}</span>
                ) : null}
              </div>
              <BrevkortBodyText className="mt-3 text-sm leading-6">
                Ditt svar finns sparat. Du kan läsa detaljerna igen eller gå direkt
                till OSA-panelen om du behöver ändra något.
              </BrevkortBodyText>
              <PanelActions secondaryHref="#detaljer" secondaryLabel="Läs detaljer">
                <BrevkortLinkButton href="#osa" tone="rust">
                  Uppdatera svar →
                </BrevkortLinkButton>
              </PanelActions>
            </BrevkortStatusStrip>
          ) : (
            <BrevkortStatusStrip tone="subtle">
              <span className="bg-invite-paper px-3 py-1 text-sm font-semibold text-invite-walnut ring-1 ring-invite-border-soft">
                Öppnad · inget svar än
              </span>
              <BrevkortBodyText className="mt-3 text-sm leading-6">
                Börja med detaljerna och gå sedan vidare till OSA när du är redo
                att svara.
              </BrevkortBodyText>
              <PanelActions secondaryHref="#osa" secondaryLabel="Gå direkt till OSA">
                <BrevkortLinkButton href="#detaljer">
                  Se detaljerna →
                </BrevkortLinkButton>
              </PanelActions>
            </BrevkortStatusStrip>
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
        <BrevkortKicker>Allt inför dagen</BrevkortKicker>
        <BrevkortHeading className="mt-3 text-4xl" id="detaljer-heading">
          Detaljer
        </BrevkortHeading>
        <BrevkortBodyText className="mt-3 max-w-2xl">
          Här finns tider, plats och praktisk information. Uppdateringar läggs
          till här när något nytt publiceras.
        </BrevkortBodyText>

        <div className="mt-8 grid gap-5">
          <DetailCard title="Tidsplan">
            {wedding.time_plan.length ? (
              <ol className="grid gap-3">
                {wedding.time_plan.map((item, index) => {
                  const entry = parseTimePlanLine(item);

                  return (
                    <li
                      className="border-l-4 border-invite-rust bg-invite-paper-muted/80 p-4 text-invite-ink"
                      key={`${index}-${item}`}
                    >
                      {entry?.time ? (
                        <p>
                          <span className="brevkort-display text-sm font-semibold italic text-invite-rust">
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
                  <p className="mt-1 text-invite-walnut">{wedding.venue_area}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-line leading-7 text-invite-body">
                  {getDisplayText(wedding.venue_address)}
                </p>
                <p className="mt-2 text-sm text-invite-walnut">{weddingDate}</p>
              </div>
              {mapsUrl ? (
                <ExternalLink href={mapsUrl}>Visa karta</ExternalLink>
              ) : (
                <p className="text-sm text-invite-walnut">Kartlänk kommer snart</p>
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
                  <p className="whitespace-pre-line text-invite-walnut">
                    {wedding.child_policy}
                  </p>
                ) : null}
                {wedding.dress_code && wedding.policy ? (
                  <p className="whitespace-pre-line text-sm text-invite-walnut">
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
                <p className="leading-7 text-invite-body">
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
                    <li className="border-t border-invite-border-soft py-4" key={update.id}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <BrevkortHeading className="text-xl" level={4}>
                          {update.title}
                        </BrevkortHeading>
                        {publishedAt ? (
                          <time
                            className="brevkort-metadata text-xs text-invite-rust"
                            dateTime={update.updated_at}
                          >
                            {publishedAt}
                          </time>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line leading-7 text-invite-body">
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
              <p className="text-lg font-semibold tracking-tight text-invite-ink">
                Inga uppdateringar än.
              </p>
            )}
          </DetailCard>
        </div>

        <PanelActions secondaryHref="#inbjudan" secondaryLabel="Till inbjudan">
          <BrevkortLinkButton href="#osa">
            Vidare till OSA →
          </BrevkortLinkButton>
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
  const showSubmittedConfirmation =
    getFirstParam(queryParams.rsvp_status) === "submitted";
  const rsvpSubmittedAt = formatRsvpSubmittedAt(
    rsvpResponse?.last_submitted_at ?? null,
  );
  const coupleMark = getCoupleMark(wedding.name);

  return (
    <BrevkortPage>
      <BrevkortStack>
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
            <BrevkortKicker>Svara när du kan</BrevkortKicker>
            <BrevkortHeading className="mt-3 text-4xl" id="osa-heading">
              OSA
            </BrevkortHeading>
            <BrevkortBodyText className="mt-3 max-w-2xl">
              Svara eller uppdatera ditt svar här när du vet om du kan komma.
            </BrevkortBodyText>

            <RsvpPanel
              guest={guest}
              rawToken={token}
              rsvpResponse={rsvpResponse}
              showSubmittedConfirmation={showSubmittedConfirmation}
              weddingDate={weddingDate}
              weddingName={wedding.name}
            />
          </div>
        </PanelShell>
      </BrevkortStack>
    </BrevkortPage>
  );
}
