import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import {
  recordInviteOpened,
  resolveInviteAccess,
  type GrantedInviteAccessWithRsvp,
} from "@/lib/invite-access";
import { getInviteSupportContact } from "@/lib/invite-support-contact";
import { shouldShowInviteRsvpSubmittedConfirmation } from "@/lib/invite-rsvp-navigation";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { getRsvpAttendanceSummary } from "@/lib/rsvp-form-contract";
import { getSafeHttpUrl } from "@/lib/safe-url";
import {
  getGuestFacingWeddingSettingsDisplay,
  getWeddingSettingsDisplayText,
  WEDDING_SETTINGS_DISPLAY_FALLBACK,
  type PublicPartnerNames,
  type WeddingCoverDateTime,
} from "@/lib/wedding-settings-display";
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
  cx,
} from "../_components/brevkort-primitives";
import { InvalidInviteMessage } from "../_components/invalid-invite-message";
import { InvitePanelCarousel } from "./invite-panel-carousel";
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

type ValidInviteResult = GrantedInviteAccessWithRsvp;

const comingSoon = WEDDING_SETTINGS_DISPLAY_FALLBACK;
const fullPanelLabels = ["Inbjudan", "Detaljer", "OSA"] as const;
const fullPanelIds = ["inbjudan", "detaljer", "osa"] as const;
const scopedPanelLabels = ["Inbjudan", "Detaljer"] as const;
const scopedPanelIds = ["inbjudan", "detaljer"] as const;

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

function getSavedAnswerBannerClass(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return "border-l-invite-success";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "border-l-invite-body";
  }

  return "border-l-invite-border";
}

function getSavedAnswerReceiptClass(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return "border-invite-success/35 bg-invite-paper-muted text-invite-success";
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return "border-invite-body/35 bg-invite-paper-muted text-invite-body";
  }

  return "border-invite-border bg-invite-paper text-invite-walnut";
}

function ExternalLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <BrevkortLinkButton className="w-fit" href={href} rel="noopener noreferrer" target="_blank" tone="outline">
      {children} →
    </BrevkortLinkButton>
  );
}

function PanelShell({
  activeIndex,
  children,
  className,
}: {
  activeIndex: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BrevkortPanel
      aria-labelledby={`${fullPanelIds[activeIndex]}-heading`}
      className={className}
      id={fullPanelIds[activeIndex]}
    >
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
  canSubmitRsvp,
  coverDateTime,
  guestName,
  partnerNames,
  rsvpResponse,
  rsvpSubmittedAt,
  venueArea,
  venueName,
}: {
  canSubmitRsvp: boolean;
  coverDateTime: WeddingCoverDateTime;
  guestName: string;
  partnerNames: PublicPartnerNames;
  rsvpResponse: null | { attendance: RsvpAttendance };
  rsvpSubmittedAt: string | null;
  venueArea: string;
  venueName: string;
}) {
  const primaryCta = canSubmitRsvp && rsvpResponse
    ? { href: "#osa", label: "Uppdatera svar" }
    : { href: "#detaljer", label: "Öppna inbjudan" };
  const savedAnswer = rsvpResponse
    ? getRsvpAttendanceSummary(rsvpResponse.attendance)
    : null;

  return (
    <PanelShell
      activeIndex={0}
      className="border-0 bg-transparent px-4 py-0 shadow-none sm:px-4 sm:py-0"
    >
      <div className="pb-6 pt-0">
        <section
          aria-label="Inbjudan"
          className="mx-1 border border-invite-border/90 bg-invite-paper-light/40 px-7 py-4 text-center"
        >
          <p className="sr-only">Inbjudan till {guestName}</p>
          <BrevkortKicker>Inbjudan</BrevkortKicker>
          <p aria-hidden="true" className="brevkort-display mt-3 text-3xl font-semibold text-invite-walnut">
            ❦
          </p>
          <BrevkortKicker className="mt-3">till {guestName}</BrevkortKicker>
          <BrevkortHeading
            className="mt-4 text-[3.35rem] !font-normal leading-[0.95] sm:text-[3.6rem]"
            id="inbjudan-heading"
            level={1}
          >
            <span className="block">{partnerNames.partnerOneName}</span>
            <span className="brevkort-ornament block text-[2rem] leading-[1.15] text-invite-walnut">
              &
            </span>
            <span className="block">{partnerNames.partnerTwoName}</span>
          </BrevkortHeading>

          <div className="mt-5 flex items-center justify-center gap-3 text-invite-walnut">
            <span className="h-px w-12 bg-invite-border" />
            <BrevkortKicker>Bröllopsfest</BrevkortKicker>
            <span className="h-px w-12 bg-invite-border" />
          </div>

          <dl className="mx-auto mt-5 grid max-w-[270px] grid-cols-2 divide-x divide-invite-border text-invite-ink">
            <div className="px-3 text-center">
              <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
                När
              </dt>
              <dd className="mt-3">
                <p className="brevkort-display text-[1.45rem] font-semibold italic leading-none text-invite-ink">
                  {coverDateTime.dayText && coverDateTime.monthText ? (
                    <>
                      <span>{coverDateTime.dayText}</span>{" "}
                      <span className="font-normal text-invite-walnut">
                        {coverDateTime.monthText}
                      </span>
                    </>
                  ) : (
                    coverDateTime.dateText
                  )}
                </p>
                {coverDateTime.timeText ? (
                  <p className="brevkort-display mt-2 text-xs italic text-invite-walnut">
                    {coverDateTime.timeText}
                  </p>
                ) : null}
              </dd>
            </div>
            <div className="px-3 text-center">
              <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
                Var
              </dt>
              <dd className="mt-3">
                <p className="brevkort-display text-[1.7rem] leading-none">
                  {venueName}
                </p>
                <p className="brevkort-display mt-2 text-xs italic text-invite-walnut">
                  {venueArea}
                </p>
              </dd>
            </div>
          </dl>

          <p aria-hidden="true" className="brevkort-display mt-5 text-2xl text-invite-walnut">
            ❀
          </p>
        </section>

        <div className="mt-8 grid gap-5">
          {rsvpResponse && savedAnswer ? (
            <div
              className={cx(
                "border border-l-4 border-invite-border-soft bg-invite-paper-muted/80 px-3 py-2.5",
                getSavedAnswerBannerClass(rsvpResponse.attendance),
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
                    Ditt svar
                  </p>
                  <p className="mt-1 whitespace-nowrap text-[0.95rem] leading-5 text-invite-body">
                    <span className="brevkort-display text-lg italic text-invite-ink">
                      {savedAnswer.label}
                    </span>{" "}
                    · {savedAnswer.detail}
                  </p>
                  {rsvpSubmittedAt ? (
                    <p className="sr-only">Senast uppdaterat {rsvpSubmittedAt}</p>
                  ) : null}
                </div>
                <span
                  className={cx(
                    "brevkort-metadata shrink-0 border px-2.5 py-1 text-[0.58rem] font-semibold",
                    getSavedAnswerReceiptClass(rsvpResponse.attendance),
                  )}
                >
                  Mottaget
                </span>
              </div>
            </div>
          ) : null}

          <BrevkortLinkButton className="!min-h-[55px] w-full" href={primaryCta.href}>
            <span className="flex w-full items-center justify-between gap-3">
              <span>{primaryCta.label}</span>
              <span aria-hidden="true">→</span>
            </span>
          </BrevkortLinkButton>
        </div>
      </div>
    </PanelShell>
  );
}

function DetailsPanel({
  canSubmitRsvp,
  mapsUrl,
  spotifyUrl,
  updates,
  wedding,
  weddingDate,
}: {
  canSubmitRsvp: boolean;
  mapsUrl: string | null;
  spotifyUrl: string | null;
  updates: Awaited<ReturnType<typeof getPublishedWeddingUpdates>>;
  wedding: ValidInviteResult["wedding"];
  weddingDate: string;
}) {
  return (
    <PanelShell activeIndex={1}>
      <div className="px-2 py-8 sm:px-6">
        <BrevkortKicker>Allt inför dagen</BrevkortKicker>
        <BrevkortHeading className="mt-3 text-4xl" id="detaljer-heading">
          Detaljer
        </BrevkortHeading>
        <BrevkortBodyText className="mt-3 max-w-2xl">
          Här finns tider, plats och praktisk information.
        </BrevkortBodyText>

        <div className="mt-8 grid gap-5">
          <DetailCard title="Tidsplan">
            {wedding.time_plan.length ? (
              <ol className="grid gap-3">
                {wedding.time_plan.map((entry, index) => (
                  <li
                    className="border-l-4 border-invite-rust bg-invite-paper-muted/80 p-4 text-invite-ink"
                    key={`${index}-${entry.time}-${entry.label}`}
                  >
                    <p>
                      <span className="brevkort-display text-sm font-semibold italic text-invite-rust">
                        {entry.time}
                      </span>{" "}
                      - {entry.label}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{comingSoon}</p>
            )}
          </DetailCard>

          <DetailCard title="Plats">
            <div className="grid gap-4">
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {getWeddingSettingsDisplayText(wedding.venue_name)}
                </p>
                {wedding.venue_area ? (
                  <p className="mt-1 text-invite-walnut">{wedding.venue_area}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-line leading-7 text-invite-body">
                  {getWeddingSettingsDisplayText(wedding.venue_address)}
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
                  {getWeddingSettingsDisplayText(wedding.dress_code ?? wedding.policy)}
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
                {getWeddingSettingsDisplayText(wedding.gift_info)}
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

          {updates.length ? (
            <DetailCard title="Uppdateringar">
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
            </DetailCard>
          ) : null}
        </div>

        <PanelActions secondaryHref="#inbjudan" secondaryLabel="Till inbjudan">
          {canSubmitRsvp ? (
            <BrevkortLinkButton href="#osa">
              Vidare till OSA →
            </BrevkortLinkButton>
          ) : null}
        </PanelActions>
      </div>
    </PanelShell>
  );
}

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  await connection();

  const [{ token }, queryParams] = await Promise.all([params, searchParams]);
  const access = await resolveInviteAccess(token);

  if (access.status === "denied") {
    const supportContact = await getInviteSupportContact();

    return <InvalidInviteMessage supportContact={supportContact} />;
  }

  await recordInviteOpened(access);

  const updates = await getPublishedWeddingUpdates({ weddingId: access.weddingId });
  const { guest, rsvpResponse, wedding } = access;
  const weddingDisplay = getGuestFacingWeddingSettingsDisplay(wedding);
  const showSubmittedConfirmation =
    shouldShowInviteRsvpSubmittedConfirmation(queryParams);
  const rsvpSubmittedAt = formatRsvpSubmittedAt(
    rsvpResponse?.last_submitted_at ?? null,
  );
  const panelIds = access.canSubmitRsvp ? fullPanelIds : scopedPanelIds;
  const panelLabels = access.canSubmitRsvp ? fullPanelLabels : scopedPanelLabels;

  return (
    <BrevkortPage className="!px-0 sm:!px-6">
      <BrevkortStack className="max-w-[390px]">
        <InvitePanelCarousel
          coupleMark={weddingDisplay.coupleMark}
          panels={panelIds.map((id, index) => ({ id, label: panelLabels[index] }))}
        >
          <CoverPanel
            canSubmitRsvp={access.canSubmitRsvp}
            coverDateTime={weddingDisplay.coverDateTime}
            guestName={guest.full_name}
            partnerNames={weddingDisplay.partnerNames}
            rsvpResponse={rsvpResponse ? { attendance: rsvpResponse.attendance } : null}
            rsvpSubmittedAt={rsvpSubmittedAt}
            venueArea={weddingDisplay.coverVenueArea}
            venueName={weddingDisplay.coverVenueName}
          />

          <DetailsPanel
            canSubmitRsvp={access.canSubmitRsvp}
            mapsUrl={weddingDisplay.mapsUrl}
            spotifyUrl={weddingDisplay.spotifyUrl}
            updates={updates}
            wedding={wedding}
            weddingDate={weddingDisplay.weddingDate}
          />

          {access.canSubmitRsvp ? (
            <PanelShell activeIndex={2}>
              <div className="px-2 py-8 sm:px-6">
                <RsvpPanel
                  guest={guest}
                  rawToken={token}
                  rsvpResponse={rsvpResponse}
                  showSubmittedConfirmation={showSubmittedConfirmation}
                  weddingDate={weddingDisplay.weddingDate}
                  weddingName={wedding.name}
                />
              </div>
            </PanelShell>
          ) : null}
        </InvitePanelCarousel>
      </BrevkortStack>
    </BrevkortPage>
  );
}
