import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  getMessageAudienceLabel,
  isMessageAudience,
  MESSAGE_AUDIENCES,
  type MessageAudience,
} from "@/lib/message-audience";
import { isE164PhoneNumber } from "@/lib/phone";
import { getElk46RuntimeStatus } from "@/lib/sms/elk46";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNullableString, isRecord } from "@/lib/type-guards";

import { AdminField, AdminTextArea } from "../_components/form-controls";
import { sendMessageBlastAction } from "./actions";

export const metadata: Metadata = {
  title: "Messages | Wedding Planner",
};

type MessagesPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    failed?: string | string[];
    sent?: string | string[];
    status?: string | string[];
  }>;
};

type GuestMessagingRow = {
  rsvp_status: string;
  phone: string | null;
  sms_opt_in: boolean;
  sms_opted_out_at: string | null;
};

type MessageBlastRow = {
  id: string;
  audience: MessageAudience;
  body: string;
  created_at: string;
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

function isGuestMessagingRow(value: unknown): value is GuestMessagingRow {
  return (
    isRecord(value) &&
    typeof value.rsvp_status === "string" &&
    isNullableString(value.phone) &&
    typeof value.sms_opt_in === "boolean" &&
    isNullableString(value.sms_opted_out_at)
  );
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

function getAudienceCounts(guestRows: GuestMessagingRow[]) {
  return MESSAGE_AUDIENCES.reduce<Record<MessageAudience, number>>(
    (counts, audience) => {
      counts[audience] = guestRows.filter((guest) => {
        if (
          !guest.phone ||
          !guest.sms_opt_in ||
          guest.sms_opted_out_at ||
          !isE164PhoneNumber(guest.phone)
        ) {
          return false;
        }

        return audience === "all" || guest.rsvp_status === audience;
      }).length;
      return counts;
    },
    {
      all: 0,
      "rsvp maybe": 0,
      "rsvp no": 0,
      "rsvp yes": 0,
    },
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

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  await connection();

  const params = await searchParams;
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const smsStatus = getElk46RuntimeStatus();
  const [guestsResult, blastsResult] = await Promise.all([
    supabase
      .from("guests")
      .select("phone, rsvp_status, sms_opt_in, sms_opted_out_at")
      .eq("wedding_id", adminProfile.wedding_id)
      .is("deleted_at", null),
    supabase
      .from("message_blasts")
      .select("id, title, body, audience, send_status, created_at, sent_at")
      .eq("wedding_id", adminProfile.wedding_id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const guestRows = (guestsResult.data ?? []).filter(isGuestMessagingRow);
  const audienceCounts = getAudienceCounts(guestRows);
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
              Send SMS updates to guests with saved phone numbers.
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
                : message.tone === "warning"
                  ? "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
                  : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
            }`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

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

          {guestsResult.error ? (
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
            Latest SMS blasts and delivery attempts for this wedding.
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
                        {blast.title ?? "Untitled SMS"}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        {getMessageAudienceLabel(blast.audience)} · created {formatDate(blast.created_at)} · sent {formatDate(blast.sent_at)}
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
                  <p className="mt-4 whitespace-pre-line text-sm text-zinc-700">{blast.body}</p>
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
