import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  getInviteSmsSendOriginStatus,
  INVITE_SMS_SKIP_REASON_LABELS,
  INVITE_SMS_SKIP_REASONS,
  loadInviteSmsPreview,
  type InviteSmsGuestSummary,
  type InviteSmsPreview,
} from "@/lib/invite-sms";
import { isMessageAudience, MESSAGE_AUDIENCES, type MessageAudience } from "@/lib/message-audience";
import { isMessageKind, type MessageKind } from "@/lib/message-kind";
import {
  countMessageTargetsByAudience,
  loadMessageTargets,
  loadSelectedMessageTargetsPreview,
  parseSelectedGuestIds,
  SELECTED_MESSAGE_TARGET_EXCLUSION_LABELS,
  type SelectedMessageTargetsPreview,
} from "@/lib/message-targets";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { getElk46RuntimeStatus } from "@/lib/sms/elk46";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNullableString, isRecord } from "@/lib/type-guards";

import { AdminField, AdminTextArea } from "../_components/form-controls";
import {
  previewInviteSmsAction,
  sendBulkInviteSmsAction,
  sendInviteSmsTestAction,
  sendMessageBlastAction,
  sendSingleInviteSmsAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Meddelanden | Wedding Planner",
};

type MessagesPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    failed?: string | string[];
    invite_error?: string | string[];
    invite_failed?: string | string[];
    invite_preview?: string | string[];
    invite_sent?: string | string[];
    invite_status?: string | string[];
    selected_guests?: string | string[];
    sent?: string | string[];
    status?: string | string[];
  }>;
};

type MessageBlastRow = {
  audience: MessageAudience;
  body: string;
  created_at: string;
  id: string;
  message_kind: MessageKind;
  send_status: "failed" | "partial" | "queued" | "sent";
  sent_at: string | null;
  title: string | null;
};

type MessageDeliveryStatus = "failed" | "queued" | "sent";

type MessageDeliveryRow = {
  delivery_status: MessageDeliveryStatus;
  error_text: string | null;
  message_blast_id: string;
};

type DeliveryCounts = Record<MessageDeliveryStatus, number>;

const PAGE_MESSAGE_AUDIENCE_LABELS: Record<MessageAudience, string> = {
  all: "Alla Gäster",
  "rsvp maybe": "OSA kanske",
  "rsvp no": "OSA nej",
  "rsvp yes": "OSA ja",
};

const PAGE_MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  custom: "SMS-meddelande",
  invite_sms: "Inbjudnings-SMS",
};

const PAGE_SEND_STATUS_LABELS: Record<MessageBlastRow["send_status"], string> = {
  failed: "Misslyckat",
  partial: "Delvis skickat",
  queued: "Köat",
  sent: "Skickat",
};

const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCount(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Inte skickat än";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Okänd tid";
  }

  return dateFormatter.format(date);
}

function getMessage(searchParams: Awaited<MessagesPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);
  const sent = parseCount(getFirstParam(searchParams.sent));
  const failed = parseCount(getFirstParam(searchParams.failed));

  if (error === "missing-body") {
    return { tone: "error", text: "Meddelandetext krävs." };
  }

  if (error === "body-too-long") {
    return { tone: "error", text: "Meddelandetexten får vara högst 1 000 tecken." };
  }

  if (error === "invalid-audience") {
    return { tone: "error", text: "Välj en giltig mottagargrupp." };
  }

  if (error === "confirm-required") {
    return { tone: "error", text: "Bekräfta SMS-utskicket innan du skickar." };
  }

  if (error === "sms-config") {
    return { tone: "error", text: "SMS-inställningar saknas eller är ogiltiga." };
  }

  if (error === "no-recipients") {
    return { tone: "error", text: "Inga Gäster i mottagargruppen har giltigt SMS-nummer." };
  }

  if (error) {
    return { tone: "error", text: "Meddelandet kunde inte skickas. Försök igen." };
  }

  if (status === "sent") {
    return { tone: "success", text: `SMS skickat till ${sent} Gäst${sent === 1 ? "" : "er"}.` };
  }

  if (status === "partial") {
    return {
      tone: "warning",
      text: `SMS skickat till ${sent} Gäst${sent === 1 ? "" : "er"}; ${failed} misslyckades.`,
    };
  }

  if (status === "failed") {
    return { tone: "error", text: `SMS misslyckades för ${failed} Gäst${failed === 1 ? "" : "er"}.` };
  }

  return null;
}

function getInviteMessage(searchParams: Awaited<MessagesPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.invite_error);
  const status = getFirstParam(searchParams.invite_status);
  const sent = parseCount(getFirstParam(searchParams.invite_sent));
  const failed = parseCount(getFirstParam(searchParams.invite_failed));

  if (error === "invite-template-missing") {
    return { tone: "error", text: "Mall för inbjudnings-SMS krävs." };
  }

  if (error === "invite-template-missing-first-name") {
    return { tone: "error", text: "Mallen för inbjudnings-SMS måste innehålla {{first_name}}." };
  }

  if (error === "invite-template-missing-link") {
    return { tone: "error", text: "Mallen för inbjudnings-SMS måste innehålla {{invite_link}}." };
  }

  if (error === "invite-template-unknown-placeholder") {
    return {
      tone: "error",
      text: "Mallen för inbjudnings-SMS får bara använda {{first_name}} och {{invite_link}}.",
    };
  }

  if (error === "invite-template-too-long") {
    return { tone: "error", text: "Renderade inbjudnings-SMS får vara högst 1 000 tecken." };
  }

  if (error === "invite-template-save-failed") {
    return { tone: "error", text: "Mallen för inbjudnings-SMS kunde inte sparas." };
  }

  if (error === "invite-test-phone") {
    return { tone: "error", text: "ELK46_TEST_PHONE_NUMBER saknas eller är ogiltigt." };
  }

  if (error === "invite-test-failed") {
    return { tone: "error", text: "Test av inbjudnings-SMS kunde inte skickas." };
  }

  if (error === "invite-confirm-required") {
    return { tone: "error", text: "Bekräfta innan riktiga inbjudnings-SMS skickas." };
  }

  if (error === "invite-single-confirm-required") {
    return { tone: "error", text: "Bekräfta innan detta inbjudnings-SMS skickas." };
  }

  if (error === "invite-no-targets") {
    return { tone: "error", text: "Inga ej skickade inbjudna Gäster uppfyller reglerna för inbjudnings-SMS." };
  }

  if (error === "invite-guest-not-eligible") {
    return { tone: "error", text: "Den Gästen kan inte få inbjudnings-SMS just nu." };
  }

  if (error === "missing-site-url") {
    return { tone: "error", text: "Sätt SITE_URL eller NEXT_PUBLIC_SITE_URL innan riktiga inbjudnings-SMS skickas." };
  }

  if (error === "non-production-origin") {
    return { tone: "error", text: "Riktiga inbjudnings-SMS blockeras för lokala, preview- och staging-ursprung." };
  }

  if (error === "sms-config") {
    return { tone: "error", text: "SMS-inställningar saknas eller är ogiltiga." };
  }

  if (error) {
    return { tone: "error", text: "Inbjudnings-SMS kunde inte slutföras. Försök igen." };
  }

  if (status === "preview-ready") {
    return { tone: "success", text: "Mall för inbjudnings-SMS sparad och förhandsvisning uppdaterad." };
  }

  if (status === "test-sent") {
    return { tone: "success", text: "Test av inbjudnings-SMS skickat." };
  }

  if (status === "sent") {
    return { tone: "success", text: `Inbjudnings-SMS skickat till ${sent} Gäst${sent === 1 ? "" : "er"}.` };
  }

  if (status === "partial") {
    return {
      tone: "warning",
      text: `Inbjudnings-SMS skickat till ${sent} Gäst${sent === 1 ? "" : "er"}; ${failed} misslyckades.`,
    };
  }

  if (status === "failed") {
    return { tone: "error", text: `Inbjudnings-SMS misslyckades för ${failed} Gäst${failed === 1 ? "" : "er"}.` };
  }

  return null;
}

function isSendStatus(value: unknown): value is MessageBlastRow["send_status"] {
  return value === "queued" || value === "sent" || value === "partial" || value === "failed";
}

function isDeliveryStatus(value: unknown): value is MessageDeliveryStatus {
  return value === "queued" || value === "sent" || value === "failed";
}

function isMessageBlastRow(value: unknown): value is MessageBlastRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isMessageAudience(value.audience) &&
    typeof value.body === "string" &&
    isMessageKind(value.message_kind) &&
    isSendStatus(value.send_status) &&
    isNullableString(value.title) &&
    typeof value.created_at === "string" &&
    isNullableString(value.sent_at)
  );
}

function isMessageDeliveryRow(value: unknown): value is MessageDeliveryRow {
  return (
    isRecord(value) &&
    typeof value.message_blast_id === "string" &&
    isDeliveryStatus(value.delivery_status) &&
    isNullableString(value.error_text)
  );
}

function createEmptyDeliveryCounts(): DeliveryCounts {
  return {
    failed: 0,
    queued: 0,
    sent: 0,
  };
}

function getDeliveryCounts(deliveries: MessageDeliveryRow[]) {
  return deliveries.reduce<Map<string, DeliveryCounts>>((countsByBlast, delivery) => {
    const counts = countsByBlast.get(delivery.message_blast_id) ?? createEmptyDeliveryCounts();
    counts[delivery.delivery_status] += 1;
    countsByBlast.set(delivery.message_blast_id, counts);
    return countsByBlast;
  }, new Map());
}

function getStatusClass(status: MessageBlastRow["send_status"]) {
  if (status === "sent") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  }

  if (status === "partial") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-red-100";
  }

  return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200";
}

function getMessageToneClass(tone: string) {
  if (tone === "error") {
    return "bg-red-50 text-red-700 ring-1 ring-red-100";
  }

  if (tone === "warning") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  }

  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
}

function GuestList({ guests }: { guests: InviteSmsGuestSummary[] }) {
  if (!guests.length) {
    return <p className="text-sm text-zinc-500">Inga.</p>;
  }

  return (
    <ul className="mt-2 grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
      {guests.slice(0, 20).map((guest) => (
        <li key={guest.guestId}>
          {guest.fullName}{guest.phone ? ` · ${guest.phone}` : ""}
        </li>
      ))}
      {guests.length > 20 ? <li className="text-zinc-500">+{guests.length - 20} till</li> : null}
    </ul>
  );
}


function SelectedMessageTargetsPanel({
  error,
  preview,
  selectedGuestIds,
}: {
  error: unknown;
  preview: SelectedMessageTargetsPreview | null;
  selectedGuestIds: string[];
}) {
  if (error) {
    return (
      <div className="mt-6 rounded-2xl bg-red-50 p-5 text-sm font-medium text-red-700 ring-1 ring-red-100">
        Kunde inte kontrollera markerade SMS-mottagare. Sändning är avstängd tills markerade Gäster kan kontrolleras.
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-4 rounded-2xl bg-sky-50 p-5 ring-1 ring-sky-100" data-testid="selected-message-preview">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-sky-800">Markerade Gäster</p>
        <h3 className="mt-1 text-lg font-semibold text-sky-950">
          SMS-uppdatering till markerade Gäster
        </h3>
        <p className="mt-2 text-sm leading-6 text-sky-900">
          Skickas bara till markerade Gäster som kan få SMS. Detta är inte inbjudnings-SMS,
          inga inbjudningslänkar skapas och befintlig inbjudningsåtkomst ändras inte.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/80 p-4">
          <dt className="text-sm font-medium text-sky-800">Markerade</dt>
          <dd className="mt-1 text-2xl font-semibold text-sky-950">{selectedGuestIds.length}</dd>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <dt className="text-sm font-medium text-sky-800">Kan få SMS</dt>
          <dd className="mt-1 text-2xl font-semibold text-sky-950">{preview.eligibleTargets.length}</dd>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <dt className="text-sm font-medium text-sky-800">Exkluderade</dt>
          <dd className="mt-1 text-2xl font-semibold text-sky-950">{preview.excludedGuests.length}</dd>
        </div>
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white/80 p-4">
          <h4 className="font-semibold text-sky-950">
            Valda SMS-mottagare ({preview.eligibleTargets.length})
          </h4>
          {preview.eligibleTargets.length ? (
            <ul className="mt-3 grid gap-2 text-sm text-sky-900" data-testid="eligible-selected-guests">
              {preview.eligibleTargets.map((target) => (
                <li key={target.guestId}>
                  {target.fullName} · {target.phone}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-sky-900">Inga markerade Gäster kan få SMS.</p>
          )}
        </div>

        <div className="rounded-2xl bg-white/80 p-4">
          <h4 className="font-semibold text-sky-950">
            Exkluderade markerade Gäster ({preview.excludedGuests.length})
          </h4>
          {preview.excludedGuests.length ? (
            <ul className="mt-3 grid gap-2 text-sm text-sky-900" data-testid="excluded-selected-guests">
              {preview.excludedGuests.map((guest) => (
                <li key={guest.guestId}>
                  {guest.fullName ?? `Okänd Gäst (${guest.guestId.slice(0, 8)})`}
                  {guest.phone ? ` · ${guest.phone}` : ""} · {SELECTED_MESSAGE_TARGET_EXCLUSION_LABELS[guest.reason]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-sky-900">Ingen markerad Gäst exkluderas.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteSmsPreviewDetails({
  invitePreview,
  canSend,
  showPreview,
}: {
  canSend: boolean;
  invitePreview: InviteSmsPreview;
  showPreview: boolean;
}) {
  if (!showPreview) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-5">
      <div className="rounded-2xl bg-zinc-50 p-5">
        <h3 className="text-base font-semibold text-zinc-950">Renderat exempel</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-zinc-700">
          {invitePreview.sampleMessage}
        </p>
        <p className="mt-3 text-xs font-medium text-zinc-500">
          Beräknat {invitePreview.sampleEstimate.segments} SMS-segment
          · {invitePreview.sampleEstimate.length} {invitePreview.sampleEstimate.encoding === "gsm-7" ? "GSM-7-tecken" : "Unicode-tecken"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-100">
          <h3 className="text-base font-semibold text-emerald-900">
            Kan få bulkutskick ({invitePreview.eligibleGuests.length})
          </h3>
          <GuestList guests={invitePreview.eligibleGuests} />
        </div>
        <div className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-100">
          <h3 className="text-base font-semibold text-amber-900">Varningar för dubbla telefonnummer</h3>
          {invitePreview.duplicatePhoneGroups.length ? (
            <ul className="mt-2 grid gap-2 text-sm text-amber-800">
              {invitePreview.duplicatePhoneGroups.map((group) => (
                <li key={group.phone}>
                  {group.phone}: {group.guests.map((guest) => guest.fullName).join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-amber-800">Inga dubbla giltiga telefonnummer.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-50 p-5">
        <h3 className="text-base font-semibold text-zinc-950">Överhoppade Gäster</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {INVITE_SMS_SKIP_REASONS.map((reason) => {
            const guests = invitePreview.skippedByReason[reason];
            return (
              <div key={reason}>
                <p className="text-sm font-semibold text-zinc-800">
                  {INVITE_SMS_SKIP_REASON_LABELS[reason]} ({guests.length})
                </p>
                <GuestList guests={guests} />
              </div>
            );
          })}
        </div>
      </div>

      <form action={sendBulkInviteSmsAction} className="grid gap-4 rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-100">
        <label className="flex gap-3 text-sm font-medium text-amber-900">
          <input className="mt-1 h-4 w-4" name="confirm_invite_sms_send" required type="checkbox" />
          <span>
            Jag förstår att riktiga inbjudnings-SMS skickas och att en ny personlig inbjudningslänk skapas för varje Gäst.
          </span>
        </label>
        <button
          className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:w-fit"
          disabled={!canSend || invitePreview.eligibleGuests.length === 0}
          type="submit"
        >
          Skicka inbjudnings-SMS till {invitePreview.eligibleGuests.length} Gäst
          {invitePreview.eligibleGuests.length === 1 ? "" : "s"}
        </button>
      </form>
    </div>
  );
}

function SingleInviteSmsList({
  canSend,
  guests,
  showPreview,
}: {
  canSend: boolean;
  guests: InviteSmsGuestSummary[];
  showPreview: boolean;
}) {
  if (!showPreview) {
    return null;
  }

  return (
    <div className="mt-6 rounded-2xl bg-zinc-50 p-5">
      <h3 className="text-base font-semibold text-zinc-950">Skicka eller skicka om för en Gäst</h3>
      <p className="mt-1 text-sm text-zinc-600">
        Tillgängligt för inbjudna Gäster som kan få SMS, oavsett OSA-status. Varje utskick skapar en ny personlig inbjudningslänk för den Gästen.
      </p>
      <div className="mt-4 grid gap-3">
        {guests.slice(0, 50).map((guest) => {
          const sendSingleInviteSmsToGuest = sendSingleInviteSmsAction.bind(null, guest.guestId);
          return (
            <form
              action={sendSingleInviteSmsToGuest}
              className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 lg:grid-cols-[1fr_auto] lg:items-center"
              key={guest.guestId}
            >
              <div>
                <p className="font-medium text-zinc-950">{guest.fullName}</p>
                <p className="text-sm text-zinc-500">
                  {guest.phone} · {guest.hasPriorSentInviteSms ? "inbjudnings-SMS skickat tidigare" : "inget tidigare inbjudnings-SMS"} · {guest.rsvpStatus}
                </p>
                <label className="mt-2 flex gap-2 text-xs font-medium text-amber-800">
                  <input className="mt-0.5 h-3.5 w-3.5" name="confirm_single_invite_sms_send" required type="checkbox" />
                  Bekräfta ett riktigt SMS med ny inbjudningslänk
                </label>
              </div>
              <button
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                disabled={!canSend}
                type="submit"
              >
                {guest.hasPriorSentInviteSms ? "Skicka om inbjudnings-SMS" : "Skicka inbjudnings-SMS"}
              </button>
            </form>
          );
        })}
      </div>
      {!guests.length ? (
        <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
          Inga aktuella inbjudna Gäster kan få enskilt utskick.
        </p>
      ) : null}
    </div>
  );
}

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  await connection();

  const params = await searchParams;
  const selectedGuestIds = parseSelectedGuestIds(params.selected_guests);
  const isSelectedMode = selectedGuestIds.length > 0;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const smsStatus = getElk46RuntimeStatus();
  const inviteOriginStatus = getInviteSmsSendOriginStatus({
    mockSend: smsStatus.mockSend,
    requestOrigin,
  });
  const [messageTargetsResult, blastsResult, invitePreviewResult, selectedPreviewResult] =
    await Promise.all([
      loadMessageTargets({ supabase, weddingId: adminProfile.wedding_id }),
      supabase
        .from("message_blasts")
        .select("id, title, body, audience, message_kind, send_status, created_at, sent_at")
        .eq("wedding_id", adminProfile.wedding_id)
        .order("created_at", { ascending: false })
        .limit(20),
      loadInviteSmsPreview({
        requestOrigin,
        supabase,
        weddingId: adminProfile.wedding_id,
      }).then(
        (preview) => ({ error: null, preview }),
        (error: unknown) => ({ error, preview: null }),
      ),
      isSelectedMode
        ? loadSelectedMessageTargetsPreview({
            selectedGuestIds,
            supabase,
            weddingId: adminProfile.wedding_id,
          })
        : Promise.resolve({ error: null, preview: null }),
    ]);
  const audienceCounts = countMessageTargetsByAudience(messageTargetsResult.targets);
  const blasts = (blastsResult.data ?? []).filter(isMessageBlastRow);
  const blastIds = blasts.map((blast) => blast.id);
  const deliveriesResult = blastIds.length
    ? await supabase
        .from("message_deliveries")
        .select("message_blast_id, delivery_status, error_text")
        .eq("wedding_id", adminProfile.wedding_id)
        .in("message_blast_id", blastIds)
    : { data: [], error: null };
  const deliveries = (deliveriesResult.data ?? []).filter(isMessageDeliveryRow);
  const deliveryCounts = getDeliveryCounts(deliveries);
  const message = getMessage(params);
  const inviteMessage = getInviteMessage(params);
  const showInvitePreview = getFirstParam(params.invite_preview) === "1";
  const selectedPreview = selectedPreviewResult.preview;
  const selectedSendDisabled =
    !smsStatus.isConfigured ||
    (isSelectedMode &&
      (Boolean(selectedPreviewResult.error) || !selectedPreview || selectedPreview.eligibleTargets.length === 0));
  const latestErrorsByBlast = deliveries.reduce<Map<string, string[]>>((errors, delivery) => {
    if (delivery.delivery_status !== "failed" || !delivery.error_text) {
      return errors;
    }

    const blastErrors = errors.get(delivery.message_blast_id) ?? [];

    if (blastErrors.length < 2) {
      blastErrors.push(delivery.error_text);
      errors.set(delivery.message_blast_id, blastErrors);
    }

    return errors;
  }, new Map());

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Meddelanden
            </h1>
            <p className="mt-2 text-zinc-600">
              Skicka SMS-uppdateringar och separata inbjudningslänkar till Gäster med sparade telefonnummer.
            </p>
          </div>
          <Link
            className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
            href="/admin"
          >
            Tillbaka till översikten
          </Link>
        </div>

        {[inviteMessage, message].filter(Boolean).map((pageMessage) => (
          <div
            className={`rounded-2xl px-5 py-4 text-sm font-medium ${getMessageToneClass(pageMessage!.tone)}`}
            key={pageMessage!.text}
            role={pageMessage!.tone === "error" ? "alert" : "status"}
          >
            {pageMessage!.text}
          </div>
        ))}

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Skicka inbjudnings-SMS-länkar</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Skicka personliga inbjudningslänkar via SMS till inbjudna Gäster som kan få SMS och inte fått inbjudnings-SMS. Bulkutskick hoppar över Gäster som redan fått inbjudnings-SMS, öppnat sin inbjudan eller skickat OSA.
              </p>
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                inviteOriginStatus.isAllowed
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : "bg-red-50 text-red-700 ring-1 ring-red-100"
              }`}
            >
              Ursprung för inbjudningslänkar: {inviteOriginStatus.origin}
              {inviteOriginStatus.isAllowed ? "" : " (blockerar riktiga utskick)"}
            </div>
          </div>

          {invitePreviewResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Kunde inte ladda förhandsvisning för inbjudnings-SMS.
            </p>
          ) : null}

          {invitePreviewResult.preview ? (
            <>
              <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Kan få bulkutskick</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {invitePreviewResult.preview.eligibleGuests.length}
                  </dd>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Överhoppade</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {Object.values(invitePreviewResult.preview.skippedByReason).flat().length}
                  </dd>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Kan få enskilt utskick</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {invitePreviewResult.preview.singleSendGuests.length}
                  </dd>
                </div>
              </dl>

              <form action={previewInviteSmsAction} className="mt-8 grid gap-5">
                <AdminTextArea
                  defaultValue={invitePreviewResult.preview.template}
                  helpText="Kräver {{first_name}} och {{invite_link}}. Okända platshållare nekas. Förhandsvisning sparar mallen utan att skapa inbjudningslänkar."
                  label="Mall för inbjudnings-SMS"
                  name="invite_sms_template"
                  required
                  rows={5}
                />
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 sm:w-fit"
                    type="submit"
                  >
                    Spara och förhandsvisa
                  </button>
                  <button
                    className="rounded-full border border-zinc-300 px-5 py-3 font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 sm:w-fit"
                    disabled={!smsStatus.isConfigured}
                    formAction={sendInviteSmsTestAction}
                    type="submit"
                  >
                    Spara och skicka test
                  </button>
                </div>
              </form>

              <InviteSmsPreviewDetails
                canSend={smsStatus.isConfigured && inviteOriginStatus.isAllowed}
                invitePreview={invitePreviewResult.preview}
                showPreview={showInvitePreview}
              />
              <SingleInviteSmsList
                canSend={smsStatus.isConfigured && inviteOriginStatus.isAllowed}
                guests={invitePreviewResult.preview.singleSendGuests}
                showPreview={showInvitePreview}
              />
            </>
          ) : null}
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Skriv SMS-uppdatering</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Leverantör: 46elks. Avsändare: {smsStatus.sender}. Endast Gäster med SMS-samtycke
                och strikt E.164-telefonnummer, till exempel +46701234567, inkluderas.
              </p>
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                smsStatus.isConfigured
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : "bg-red-50 text-red-700 ring-1 ring-red-100"
              }`}
            >
              {smsStatus.isConfigured
                ? smsStatus.mockSend
                  ? "46elks mockläge för utskick"
                  : "46elks är konfigurerat"
                : `46elks är inte klart${
                    smsStatus.missingEnv.length ? `: saknar ${smsStatus.missingEnv.join(", ")}` : ""
                  }${smsStatus.senderIsValid ? "" : ": ogiltig avsändare"}`}
            </div>
          </div>

          {messageTargetsResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Kunde inte ladda mottagarantal.
            </p>
          ) : (
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MESSAGE_AUDIENCES.map((audience) => (
                <div className="rounded-2xl bg-zinc-50 p-4" key={audience}>
                  <dt className="text-sm font-medium text-zinc-600">
                    {PAGE_MESSAGE_AUDIENCE_LABELS[audience]}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {audienceCounts[audience]}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {isSelectedMode ? (
            <SelectedMessageTargetsPanel
              error={selectedPreviewResult.error}
              preview={selectedPreview}
              selectedGuestIds={selectedGuestIds}
            />
          ) : null}

          <form action={sendMessageBlastAction} className="mt-8 grid gap-5">
            {isSelectedMode ? (
              <input name="selected_guests" type="hidden" value={selectedGuestIds.join(",")} />
            ) : null}
            <AdminField
              label="Rubrik"
              name="title"
              placeholder="Valfri rubrik, läggs först i SMS:et"
            />
            <AdminTextArea
              helpText="Håll texten kort. SMS debiteras per meddelandesegment; Unicode-tecken och emojis kan minska segmentlängden. Högst 1 000 tecken."
              label="Meddelandetext"
              name="body"
              placeholder="Ta med paraply till ceremonin idag."
              required
              rows={5}
            />
            {isSelectedMode ? (
              <div className="rounded-2xl bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700">
                Mottagarvalet är dolt. SMS-uppdateringen skickas bara till markerade Gäster som kan få SMS.
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
                Mottagare
                <select
                  className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                  defaultValue="all"
                  name="audience"
                  required
                >
                  {MESSAGE_AUDIENCES.map((audience) => (
                    <option key={audience} value={audience}>
                      {PAGE_MESSAGE_AUDIENCE_LABELS[audience]} ({audienceCounts[audience]})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm font-medium text-amber-800 ring-1 ring-amber-100">
              <input className="mt-1 h-4 w-4" name="confirm_send" required type="checkbox" />
              <span>
                Jag förstår att riktiga SMS skickas via 46elks och kan kosta
                per segment.
              </span>
            </label>
            <button
              className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:w-fit"
              disabled={selectedSendDisabled}
              type="submit"
            >
              Skicka SMS nu
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-950">Meddelandehistorik</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Senaste SMS-utskick och leveransförsök för bröllopet. Historik för inbjudnings-SMS lagrar mallar och tokenreferenser, inte råa inbjudningslänkar.
          </p>

          {blastsResult.error || deliveriesResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Kunde inte ladda meddelandehistorik.
            </p>
          ) : null}

          <div className="mt-6 grid gap-4">
            {blasts.map((blast) => {
              const counts = deliveryCounts.get(blast.id) ?? createEmptyDeliveryCounts();
              const failedErrors = latestErrorsByBlast.get(blast.id) ?? [];

              return (
                <article className="rounded-2xl bg-zinc-50 p-5" key={blast.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-zinc-950">
                        {blast.title ?? (blast.message_kind === "invite_sms" ? "Inbjudnings-SMS" : "SMS utan rubrik")}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        {PAGE_MESSAGE_KIND_LABELS[blast.message_kind]} · {PAGE_MESSAGE_AUDIENCE_LABELS[blast.audience]} · skapat {formatDate(blast.created_at)} · skickat {formatDate(blast.sent_at)}
                      </p>
                    </div>
                    <span
                      className={`w-fit rounded-full px-3 py-1 text-sm font-medium capitalize ${getStatusClass(
                        blast.send_status,
                      )}`}
                    >
                      {PAGE_SEND_STATUS_LABELS[blast.send_status]}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-line text-sm text-zinc-700">
                    {blast.message_kind === "invite_sms" ? `Mall: ${blast.body}` : blast.body}
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="font-medium text-zinc-950">Köade</dt>
                      <dd className="text-zinc-600">{counts.queued}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-zinc-950">Skickade</dt>
                      <dd className="text-zinc-600">{counts.sent}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-zinc-950">Misslyckade</dt>
                      <dd className="text-zinc-600">{counts.failed}</dd>
                    </div>
                  </dl>
                  {failedErrors.length ? (
                    <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
                      <p className="font-medium">Senaste leverantörsfel</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {failedErrors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {!blasts.length && !blastsResult.error ? (
            <p className="mt-6 rounded-2xl bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
              Inga SMS-meddelanden har skickats än.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}
