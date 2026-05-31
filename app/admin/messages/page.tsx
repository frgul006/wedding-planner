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
import {
  getMessageAudienceLabel,
  isMessageAudience,
  MESSAGE_AUDIENCES,
  type MessageAudience,
} from "@/lib/message-audience";
import { getMessageKindLabel, isMessageKind, type MessageKind } from "@/lib/message-kind";
import {
  countMessageTargetsByAudience,
  loadMessageTargets,
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
  title: "Messages | Wedding Planner",
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
    return "Not sent yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return dateFormatter.format(date);
}

function getMessage(searchParams: Awaited<MessagesPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);
  const sent = parseCount(getFirstParam(searchParams.sent));
  const failed = parseCount(getFirstParam(searchParams.failed));

  if (error === "missing-body") {
    return { tone: "error", text: "Message body is required." };
  }

  if (error === "body-too-long") {
    return { tone: "error", text: "Message body must be 1,000 characters or fewer." };
  }

  if (error === "invalid-audience") {
    return { tone: "error", text: "Choose a valid message audience." };
  }

  if (error === "confirm-required") {
    return { tone: "error", text: "Confirm the SMS send before submitting." };
  }

  if (error === "sms-config") {
    return { tone: "error", text: "SMS provider settings are missing or invalid." };
  }

  if (error === "no-recipients") {
    return { tone: "error", text: "No guests in that audience have a valid SMS phone number." };
  }

  if (error) {
    return { tone: "error", text: "Could not send the message. Please try again." };
  }

  if (status === "sent") {
    return { tone: "success", text: `Message sent to ${sent} guest${sent === 1 ? "" : "s"}.` };
  }

  if (status === "partial") {
    return {
      tone: "warning",
      text: `Message sent to ${sent} guest${sent === 1 ? "" : "s"}; ${failed} failed.`,
    };
  }

  if (status === "failed") {
    return { tone: "error", text: `Message failed for ${failed} guest${failed === 1 ? "" : "s"}.` };
  }

  return null;
}

function getInviteMessage(searchParams: Awaited<MessagesPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.invite_error);
  const status = getFirstParam(searchParams.invite_status);
  const sent = parseCount(getFirstParam(searchParams.invite_sent));
  const failed = parseCount(getFirstParam(searchParams.invite_failed));

  if (error === "invite-template-missing") {
    return { tone: "error", text: "Invite SMS template is required." };
  }

  if (error === "invite-template-missing-first-name") {
    return { tone: "error", text: "Invite SMS template must include {{first_name}}." };
  }

  if (error === "invite-template-missing-link") {
    return { tone: "error", text: "Invite SMS template must include {{invite_link}}." };
  }

  if (error === "invite-template-unknown-placeholder") {
    return {
      tone: "error",
      text: "Invite SMS template can only use {{first_name}} and {{invite_link}}.",
    };
  }

  if (error === "invite-template-too-long") {
    return { tone: "error", text: "Rendered Invite SMS messages must be 1,000 characters or fewer." };
  }

  if (error === "invite-template-save-failed") {
    return { tone: "error", text: "Could not save the Invite SMS template." };
  }

  if (error === "invite-test-phone") {
    return { tone: "error", text: "ELK46_TEST_PHONE_NUMBER is missing or invalid." };
  }

  if (error === "invite-test-failed") {
    return { tone: "error", text: "Could not send the Invite SMS test." };
  }

  if (error === "invite-confirm-required") {
    return { tone: "error", text: "Confirm before sending real Invite SMS messages." };
  }

  if (error === "invite-single-confirm-required") {
    return { tone: "error", text: "Confirm before sending this Invite SMS." };
  }

  if (error === "invite-no-targets") {
    return { tone: "error", text: "No eligible unsent Invited Guests match the Invite SMS rules." };
  }

  if (error === "invite-guest-not-eligible") {
    return { tone: "error", text: "That Guest is not currently eligible for Invite SMS." };
  }

  if (error === "missing-site-url") {
    return { tone: "error", text: "Set SITE_URL or NEXT_PUBLIC_SITE_URL before real Invite SMS sends." };
  }

  if (error === "non-production-origin") {
    return { tone: "error", text: "Real Invite SMS sends are blocked for local, preview, or staging origins." };
  }

  if (error === "sms-config") {
    return { tone: "error", text: "SMS provider settings are missing or invalid." };
  }

  if (error) {
    return { tone: "error", text: "Could not complete the Invite SMS action. Please try again." };
  }

  if (status === "preview-ready") {
    return { tone: "success", text: "Invite SMS template saved and preview refreshed." };
  }

  if (status === "test-sent") {
    return { tone: "success", text: "Invite SMS test sent." };
  }

  if (status === "sent") {
    return { tone: "success", text: `Invite SMS sent to ${sent} guest${sent === 1 ? "" : "s"}.` };
  }

  if (status === "partial") {
    return {
      tone: "warning",
      text: `Invite SMS sent to ${sent} guest${sent === 1 ? "" : "s"}; ${failed} failed.`,
    };
  }

  if (status === "failed") {
    return { tone: "error", text: `Invite SMS failed for ${failed} guest${failed === 1 ? "" : "s"}.` };
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
    return <p className="text-sm text-zinc-500">None.</p>;
  }

  return (
    <ul className="mt-2 grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
      {guests.slice(0, 20).map((guest) => (
        <li key={guest.guestId}>
          {guest.fullName}{guest.phone ? ` · ${guest.phone}` : ""}
        </li>
      ))}
      {guests.length > 20 ? <li className="text-zinc-500">+{guests.length - 20} more</li> : null}
    </ul>
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
        <h3 className="text-base font-semibold text-zinc-950">Rendered example</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-zinc-700">
          {invitePreview.sampleMessage}
        </p>
        <p className="mt-3 text-xs font-medium text-zinc-500">
          Estimated {invitePreview.sampleEstimate.segments} SMS segment
          {invitePreview.sampleEstimate.segments === 1 ? "" : "s"} · {invitePreview.sampleEstimate.length} {invitePreview.sampleEstimate.encoding === "gsm-7" ? "GSM-7 units" : "Unicode characters"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-100">
          <h3 className="text-base font-semibold text-emerald-900">
            Eligible for bulk send ({invitePreview.eligibleGuests.length})
          </h3>
          <GuestList guests={invitePreview.eligibleGuests} />
        </div>
        <div className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-100">
          <h3 className="text-base font-semibold text-amber-900">Duplicate phone warnings</h3>
          {invitePreview.duplicatePhoneGroups.length ? (
            <ul className="mt-2 grid gap-2 text-sm text-amber-800">
              {invitePreview.duplicatePhoneGroups.map((group) => (
                <li key={group.phone}>
                  {group.phone}: {group.guests.map((guest) => guest.fullName).join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-amber-800">No duplicate eligible phones.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-50 p-5">
        <h3 className="text-base font-semibold text-zinc-950">Skipped Guests</h3>
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
            I understand this sends real Invite SMS messages and regenerates a fresh full Invite link for each eligible Guest.
          </span>
        </label>
        <button
          className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:w-fit"
          disabled={!canSend || invitePreview.eligibleGuests.length === 0}
          type="submit"
        >
          Send Invite SMS to {invitePreview.eligibleGuests.length} Guest
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
      <h3 className="text-base font-semibold text-zinc-950">Send or resend one Guest</h3>
      <p className="mt-1 text-sm text-zinc-600">
        Available for current Invited Guest Message targets, regardless of RSVP status. Each send regenerates that Guest&apos;s full Invite link.
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
                  {guest.phone} · {guest.hasPriorSentInviteSms ? "prior Invite SMS sent" : "no prior Invite SMS"} · {guest.rsvpStatus}
                </p>
                <label className="mt-2 flex gap-2 text-xs font-medium text-amber-800">
                  <input className="mt-0.5 h-3.5 w-3.5" name="confirm_single_invite_sms_send" required type="checkbox" />
                  Confirm one real SMS and fresh Invite link
                </label>
              </div>
              <button
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                disabled={!canSend}
                type="submit"
              >
                {guest.hasPriorSentInviteSms ? "Resend Invite SMS" : "Send Invite SMS"}
              </button>
            </form>
          );
        })}
      </div>
      {!guests.length ? (
        <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
          No current Invited Guest Message targets are eligible for single sends.
        </p>
      ) : null}
    </div>
  );
}

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const smsStatus = getElk46RuntimeStatus();
  const inviteOriginStatus = getInviteSmsSendOriginStatus({
    mockSend: smsStatus.mockSend,
    requestOrigin,
  });
  const [messageTargetsResult, blastsResult, invitePreviewResult] = await Promise.all([
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
              Messages
            </h1>
            <p className="mt-2 text-zinc-600">
              Send SMS updates and individual Invite links to guests with saved phone numbers.
            </p>
          </div>
          <Link
            className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
            href="/admin"
          >
            Back to dashboard
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
              <h2 className="text-xl font-semibold text-zinc-950">Send invite links</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Send personal Invite links to unsent Invited Guests who are current Message targets. Bulk sends skip Guests who already received an Invite SMS, opened their Invite, or submitted an RSVP.
              </p>
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                inviteOriginStatus.isAllowed
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : "bg-red-50 text-red-700 ring-1 ring-red-100"
              }`}
            >
              Invite link origin: {inviteOriginStatus.origin}
              {inviteOriginStatus.isAllowed ? "" : " (blocked for real sends)"}
            </div>
          </div>

          {invitePreviewResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Could not load Invite SMS preview data.
            </p>
          ) : null}

          {invitePreviewResult.preview ? (
            <>
              <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Bulk eligible</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {invitePreviewResult.preview.eligibleGuests.length}
                  </dd>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Skipped</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {Object.values(invitePreviewResult.preview.skippedByReason).flat().length}
                  </dd>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <dt className="text-sm font-medium text-zinc-600">Single-send eligible</dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {invitePreviewResult.preview.singleSendGuests.length}
                  </dd>
                </div>
              </dl>

              <form action={previewInviteSmsAction} className="mt-8 grid gap-5">
                <AdminTextArea
                  defaultValue={invitePreviewResult.preview.template}
                  helpText="Requires {{first_name}} and {{invite_link}}. Unknown placeholders are rejected. Preview saves the template without creating Invite links."
                  label="Invite SMS template"
                  name="invite_sms_template"
                  required
                  rows={5}
                />
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 sm:w-fit"
                    type="submit"
                  >
                    Save and preview
                  </button>
                  <button
                    className="rounded-full border border-zinc-300 px-5 py-3 font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 sm:w-fit"
                    disabled={!smsStatus.isConfigured}
                    formAction={sendInviteSmsTestAction}
                    type="submit"
                  >
                    Save and send test
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
              <h2 className="text-xl font-semibold text-zinc-950">SMS composer</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Provider: 46elks. Sender: {smsStatus.sender}. Only guests who opted in
                with strict E.164 phone numbers, for example +46701234567, are included.
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
                  ? "46elks mock send mode"
                  : "46elks is configured"
                : `46elks is not ready${
                    smsStatus.missingEnv.length ? `: missing ${smsStatus.missingEnv.join(", ")}` : ""
                  }${smsStatus.senderIsValid ? "" : ": invalid sender"}`}
            </div>
          </div>

          {messageTargetsResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Could not load recipient counts.
            </p>
          ) : (
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MESSAGE_AUDIENCES.map((audience) => (
                <div className="rounded-2xl bg-zinc-50 p-4" key={audience}>
                  <dt className="text-sm font-medium text-zinc-600">
                    {getMessageAudienceLabel(audience)}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-950">
                    {audienceCounts[audience]}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <form action={sendMessageBlastAction} className="mt-8 grid gap-5">
            <AdminField
              label="Title"
              name="title"
              placeholder="Optional heading, included at the start of the SMS"
            />
            <AdminTextArea
              helpText="Keep it short. SMS is billed per message segment; Unicode characters and emojis can reduce segment length. Maximum 1,000 characters."
              label="Body text"
              name="body"
              placeholder="Bring an umbrella for the ceremony today."
              required
              rows={5}
            />
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
              Audience
              <select
                className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
                defaultValue="all"
                name="audience"
                required
              >
                {MESSAGE_AUDIENCES.map((audience) => (
                  <option key={audience} value={audience}>
                    {getMessageAudienceLabel(audience)} ({audienceCounts[audience]})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm font-medium text-amber-800 ring-1 ring-amber-100">
              <input className="mt-1 h-4 w-4" name="confirm_send" required type="checkbox" />
              <span>
                I understand this sends real SMS messages through 46elks and may incur
                per-segment costs.
              </span>
            </label>
            <button
              className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:w-fit"
              disabled={!smsStatus.isConfigured}
              type="submit"
            >
              Send SMS now
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-950">Message history</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Latest SMS blasts and delivery attempts for this wedding. Invite SMS history stores templates and token references, not raw Invite links.
          </p>

          {blastsResult.error || deliveriesResult.error ? (
            <p className="mt-6 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Could not load message history.
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
                        {blast.title ?? (blast.message_kind === "invite_sms" ? "Invite SMS" : "Untitled SMS")}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        {getMessageKindLabel(blast.message_kind)} · {getMessageAudienceLabel(blast.audience)} · created {formatDate(blast.created_at)} · sent {formatDate(blast.sent_at)}
                      </p>
                    </div>
                    <span
                      className={`w-fit rounded-full px-3 py-1 text-sm font-medium capitalize ${getStatusClass(
                        blast.send_status,
                      )}`}
                    >
                      {blast.send_status}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-line text-sm text-zinc-700">
                    {blast.message_kind === "invite_sms" ? `Template: ${blast.body}` : blast.body}
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="font-medium text-zinc-950">Queued</dt>
                      <dd className="text-zinc-600">{counts.queued}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-zinc-950">Sent</dt>
                      <dd className="text-zinc-600">{counts.sent}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-zinc-950">Failed</dt>
                      <dd className="text-zinc-600">{counts.failed}</dd>
                    </div>
                  </dl>
                  {failedErrors.length ? (
                    <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
                      <p className="font-medium">Latest provider errors</p>
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
              No SMS messages have been sent yet.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}
