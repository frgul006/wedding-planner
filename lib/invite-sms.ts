import type { SupabaseClient } from "@supabase/supabase-js";

import { INVITE_ACCESS_SCOPE, isGuestKind } from "@/lib/guest-access-policy";
import {
  buildInviteSmsSampleUrl,
  estimateSmsSegments,
  getInviteSmsFirstName,
  INVITE_SMS_DEFAULT_TEMPLATE,
  INVITE_SMS_FIXED_TEST_FIRST_NAME,
  renderInviteSmsTemplate,
  validateInviteSmsTemplate,
  type SmsSegmentEstimate,
} from "@/lib/invite-sms-template";
import { INVITE_OPENED_STATUS, RSVP_STATUS } from "@/lib/invite-status";
import {
  MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH,
  type FinalMessageBlastStatus,
  type FinalMessageDeliveryStatus,
  type SmsProviderAdapter,
} from "@/lib/message-blast-command";
import { isE164PhoneNumber } from "@/lib/phone";
import { resolvePublicAppOrigin, type PublicUrlOptions } from "@/lib/public-url";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type InviteSmsSkipReason =
  | "already-opened-or-rsvped"
  | "already-sent"
  | "invalid-phone"
  | "no-sms-consent"
  | "not-invited-guest";

export type InviteSmsGuestSummary = {
  firstName: string;
  fullName: string;
  guestId: string;
  hasPriorSentInviteSms: boolean;
  phone: string | null;
  rsvpStatus: string;
};

export type InviteSmsSkippedGuest = InviteSmsGuestSummary & {
  reason: InviteSmsSkipReason;
};

export type InviteSmsDuplicatePhoneGroup = {
  guests: InviteSmsGuestSummary[];
  phone: string;
};

export type InviteSmsPreview = {
  duplicatePhoneGroups: InviteSmsDuplicatePhoneGroup[];
  eligibleGuests: InviteSmsGuestSummary[];
  sampleEstimate: SmsSegmentEstimate;
  sampleMessage: string;
  sampleName: string;
  singleSendGuests: InviteSmsGuestSummary[];
  skippedByReason: Record<InviteSmsSkipReason, InviteSmsSkippedGuest[]>;
  template: string;
  validationStatus: ReturnType<typeof validateInviteSmsTemplate>["status"];
};

export type InviteSmsDeliveryResult = {
  deliveryId: string;
  errorText: string | null;
  providerMessageId: string | null;
  status: FinalMessageDeliveryStatus;
};

export type InviteSmsSendResult = {
  blastId: string;
  failedCount: number;
  sendStatus: FinalMessageBlastStatus;
  sentCount: number;
  skippedCount: number;
  totalCount: number;
};

export type InviteSmsSendOriginStatus =
  | { isAllowed: true; origin: string; reason: null }
  | {
      isAllowed: false;
      origin: string;
      reason: "missing-site-url" | "non-production-origin";
    };

export type InviteSmsGeneratedLink = {
  inviteTokenId: string;
  inviteUrl: string;
};

export type InviteSmsLinkGenerator = (input: {
  accessScope: "full";
  guestId: string;
  weddingId: string;
}) => Promise<InviteSmsGeneratedLink>;

export type InviteSmsStore = {
  createBlast(input: {
    adminId: string;
    template: string;
    title: string;
    weddingId: string;
  }): Promise<{ id: string }>;
  createDelivery(input: {
    blastId: string;
    guestId: string;
    phone: string;
    weddingId: string;
  }): Promise<{ id: string }>;
  updateBlast(input: {
    blastId: string;
    sendStatus: FinalMessageBlastStatus;
    sentAt: string;
    weddingId: string;
  }): Promise<void>;
  updateDelivery(input: {
    deliveryId: string;
    deliveryStatus: FinalMessageDeliveryStatus;
    errorText: string | null;
    inviteTokenId: string | null;
    providerMessageId: string | null;
    weddingId: string;
  }): Promise<void>;
};

type InviteSmsGuestRow = {
  deleted_at: string | null;
  full_name: string;
  guest_kind: "invited" | "plus_one";
  id: string;
  invite_status: string;
  phone: string | null;
  rsvp_status: string;
  sms_opt_in: boolean;
  sms_opted_out_at: string | null;
};

type MessageBlastIdRow = {
  id: string;
};

type MessageDeliveryGuestRow = {
  guest_id: string;
};

type CreatedBlastRow = {
  id: string;
};

type CreatedDeliveryRow = {
  id: string;
};

const INVITE_SMS_GUEST_SELECT =
  "id, full_name, guest_kind, invite_status, rsvp_status, phone, sms_opt_in, sms_opted_out_at, deleted_at";
export const INVITE_SMS_SKIP_REASONS = [
  "already-opened-or-rsvped",
  "already-sent",
  "invalid-phone",
  "no-sms-consent",
  "not-invited-guest",
] as const satisfies readonly InviteSmsSkipReason[];
const INVITE_SMS_HISTORY_TITLE = "Invite SMS";
const PREVIEW_OR_STAGING_HOST_REGEX = /(^|[-.])(preview|staging)([-.]|$)/i;

export const INVITE_SMS_SKIP_REASON_LABELS: Record<InviteSmsSkipReason, string> = {
  "already-opened-or-rsvped": "Already opened or RSVP'd",
  "already-sent": "Already sent",
  "invalid-phone": "Missing or invalid phone",
  "no-sms-consent": "SMS consent missing",
  "not-invited-guest": "Not an Invited Guest",
};

function isInviteSmsGuestRow(value: unknown): value is InviteSmsGuestRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    isGuestKind(value.guest_kind) &&
    typeof value.invite_status === "string" &&
    typeof value.rsvp_status === "string" &&
    isNullableString(value.phone) &&
    typeof value.sms_opt_in === "boolean" &&
    isNullableString(value.sms_opted_out_at) &&
    isNullableString(value.deleted_at)
  );
}

function isMessageBlastIdRow(value: unknown): value is MessageBlastIdRow {
  return isRecord(value) && typeof value.id === "string";
}

function isMessageDeliveryGuestRow(value: unknown): value is MessageDeliveryGuestRow {
  return isRecord(value) && typeof value.guest_id === "string";
}

function isCreatedBlastRow(value: unknown): value is CreatedBlastRow {
  return isRecord(value) && typeof value.id === "string";
}

function isCreatedDeliveryRow(value: unknown): value is CreatedDeliveryRow {
  return isRecord(value) && typeof value.id === "string";
}

function emptySkippedByReason(): Record<InviteSmsSkipReason, InviteSmsSkippedGuest[]> {
  return {
    "already-opened-or-rsvped": [],
    "already-sent": [],
    "invalid-phone": [],
    "no-sms-consent": [],
    "not-invited-guest": [],
  };
}

function toGuestSummary(
  row: InviteSmsGuestRow,
  priorSentInviteSmsGuestIds: Set<string>,
): InviteSmsGuestSummary {
  return {
    firstName: getInviteSmsFirstName(row.full_name),
    fullName: row.full_name,
    guestId: row.id,
    hasPriorSentInviteSms: priorSentInviteSmsGuestIds.has(row.id),
    phone: row.phone,
    rsvpStatus: row.rsvp_status,
  };
}

function getBulkSkipReason(
  row: InviteSmsGuestRow,
  priorSentInviteSmsGuestIds: Set<string>,
): InviteSmsSkipReason | null {
  if (row.guest_kind !== "invited") {
    return "not-invited-guest";
  }

  if (!row.sms_opt_in || row.sms_opted_out_at) {
    return "no-sms-consent";
  }

  if (!row.phone || !isE164PhoneNumber(row.phone)) {
    return "invalid-phone";
  }

  if (priorSentInviteSmsGuestIds.has(row.id)) {
    return "already-sent";
  }

  if (
    row.invite_status !== INVITE_OPENED_STATUS.notReplied ||
    row.rsvp_status !== RSVP_STATUS.notReplied
  ) {
    return "already-opened-or-rsvped";
  }

  return null;
}

function isSingleSendEligible(row: InviteSmsGuestRow) {
  return (
    row.guest_kind === "invited" &&
    row.deleted_at === null &&
    row.sms_opt_in &&
    !row.sms_opted_out_at &&
    typeof row.phone === "string" &&
    isE164PhoneNumber(row.phone)
  );
}

function getDuplicatePhoneGroups(guests: InviteSmsGuestSummary[]) {
  const guestsByPhone = guests.reduce<Map<string, InviteSmsGuestSummary[]>>((groups, guest) => {
    if (!guest.phone) {
      return groups;
    }

    const phoneGuests = groups.get(guest.phone) ?? [];
    phoneGuests.push(guest);
    groups.set(guest.phone, phoneGuests);
    return groups;
  }, new Map());

  return Array.from(guestsByPhone.entries())
    .filter(([, phoneGuests]) => phoneGuests.length > 1)
    .map(([phone, phoneGuests]) => ({ guests: phoneGuests, phone }));
}

function getDefaultSendErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "Invite SMS send failed.";
  return message.slice(0, MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH);
}

function getBlastStatus(results: InviteSmsDeliveryResult[]): FinalMessageBlastStatus {
  const failedCount = results.filter((result) => result.status === "failed").length;

  if (failedCount === 0) {
    return "sent";
  }

  if (failedCount === results.length) {
    return "failed";
  }

  return "partial";
}

function getConfiguredSiteUrl() {
  const value = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return value?.trim() || null;
}

function isNonProductionOrigin(origin: string) {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    PREVIEW_OR_STAGING_HOST_REGEX.test(hostname) ||
    (process.env.VERCEL_ENV ? process.env.VERCEL_ENV !== "production" : false)
  );
}

async function loadPriorSentInviteSmsGuestIds({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}) {
  const { data: blasts, error: blastsError } = await supabase
    .from("message_blasts")
    .select("id")
    .eq("wedding_id", weddingId)
    .eq("message_kind", "invite_sms");

  if (blastsError) {
    throw blastsError;
  }

  const blastIds = (blasts ?? []).filter(isMessageBlastIdRow).map((blast) => blast.id);

  if (!blastIds.length) {
    return new Set<string>();
  }

  const { data: deliveries, error: deliveriesError } = await supabase
    .from("message_deliveries")
    .select("guest_id")
    .eq("wedding_id", weddingId)
    .eq("delivery_status", "sent")
    .in("message_blast_id", blastIds);

  if (deliveriesError) {
    throw deliveriesError;
  }

  return new Set(
    (deliveries ?? [])
      .filter(isMessageDeliveryGuestRow)
      .map((delivery) => delivery.guest_id),
  );
}

async function loadInviteSmsTemplate({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}) {
  const { data, error } = await supabase
    .from("weddings")
    .select("invite_sms_template")
    .eq("id", weddingId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!isRecord(data) || typeof data.invite_sms_template !== "string") {
    return INVITE_SMS_DEFAULT_TEMPLATE;
  }

  return data.invite_sms_template;
}

async function loadInviteSmsGuestRows({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}) {
  const { data, error } = await supabase
    .from("guests")
    .select(INVITE_SMS_GUEST_SELECT)
    .eq("wedding_id", weddingId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).filter(isInviteSmsGuestRow);
}

export function getInviteSmsSendOriginStatus({
  mockSend,
  requestOrigin,
  requestUrl,
}: PublicUrlOptions & { mockSend: boolean }): InviteSmsSendOriginStatus {
  const origin = resolvePublicAppOrigin({ requestOrigin, requestUrl });

  if (mockSend) {
    return { isAllowed: true, origin, reason: null };
  }

  if (!getConfiguredSiteUrl()) {
    return { isAllowed: false, origin, reason: "missing-site-url" };
  }

  if (isNonProductionOrigin(origin)) {
    return { isAllowed: false, origin, reason: "non-production-origin" };
  }

  return { isAllowed: true, origin, reason: null };
}

export async function updateInviteSmsTemplate({
  supabase,
  template,
  weddingId,
}: {
  supabase: SupabaseClient;
  template: string;
  weddingId: string;
}) {
  const { data, error } = await supabase
    .from("weddings")
    .update({ invite_sms_template: template })
    .eq("id", weddingId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Wedding settings were not found.");
  }
}

export async function loadInviteSmsPreview({
  requestOrigin,
  requestUrl,
  supabase,
  weddingId,
}: PublicUrlOptions & {
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<InviteSmsPreview> {
  const [template, priorSentInviteSmsGuestIds, guestRows] = await Promise.all([
    loadInviteSmsTemplate({ supabase, weddingId }),
    loadPriorSentInviteSmsGuestIds({ supabase, weddingId }),
    loadInviteSmsGuestRows({ supabase, weddingId }),
  ]);
  const eligibleGuests: InviteSmsGuestSummary[] = [];
  const singleSendGuests: InviteSmsGuestSummary[] = [];
  const skippedByReason = emptySkippedByReason();

  for (const row of guestRows) {
    const summary = toGuestSummary(row, priorSentInviteSmsGuestIds);
    const skipReason = getBulkSkipReason(row, priorSentInviteSmsGuestIds);

    if (skipReason) {
      skippedByReason[skipReason].push({ ...summary, reason: skipReason });
    } else {
      eligibleGuests.push(summary);
    }

    if (isSingleSendEligible(row)) {
      singleSendGuests.push(summary);
    }
  }

  const sampleName = eligibleGuests[0]?.firstName ?? INVITE_SMS_FIXED_TEST_FIRST_NAME;
  const sampleInviteUrl = buildInviteSmsSampleUrl({ requestOrigin, requestUrl });
  const validation = validateInviteSmsTemplate({
    sampleInviteUrl,
    sampleName,
    template,
  });
  const sampleMessage = renderInviteSmsTemplate({
    firstName: sampleName,
    inviteUrl: sampleInviteUrl,
    template,
  });

  return {
    duplicatePhoneGroups: getDuplicatePhoneGroups(eligibleGuests),
    eligibleGuests,
    sampleEstimate: estimateSmsSegments(sampleMessage),
    sampleMessage,
    sampleName,
    singleSendGuests,
    skippedByReason,
    template,
    validationStatus: validation.status,
  };
}

export function createSupabaseInviteSmsStore(supabase: SupabaseClient): InviteSmsStore {
  return {
    async createBlast({ adminId, template, title, weddingId }) {
      const { data, error } = await supabase
        .from("message_blasts")
        .insert({
          audience: "all",
          body: template,
          created_by_admin_id: adminId,
          message_kind: "invite_sms",
          send_status: "queued",
          title,
          wedding_id: weddingId,
        })
        .select("id")
        .single();

      if (error || !isCreatedBlastRow(data)) {
        throw error ?? new Error("Failed to create Invite SMS blast.");
      }

      return data;
    },
    async createDelivery({ blastId, guestId, phone, weddingId }) {
      const { data, error } = await supabase
        .from("message_deliveries")
        .insert({
          delivery_status: "queued",
          guest_id: guestId,
          message_blast_id: blastId,
          phone,
          wedding_id: weddingId,
        })
        .select("id")
        .single();

      if (error || !isCreatedDeliveryRow(data)) {
        throw error ?? new Error("Failed to create Invite SMS delivery.");
      }

      return data;
    },
    async updateBlast({ blastId, sendStatus, sentAt, weddingId }) {
      const { error } = await supabase
        .from("message_blasts")
        .update({ send_status: sendStatus, sent_at: sentAt })
        .eq("id", blastId)
        .eq("wedding_id", weddingId);

      if (error) {
        throw error;
      }
    },
    async updateDelivery({
      deliveryId,
      deliveryStatus,
      errorText,
      inviteTokenId,
      providerMessageId,
      weddingId,
    }) {
      const { error } = await supabase
        .from("message_deliveries")
        .update({
          delivery_status: deliveryStatus,
          error_text: errorText,
          invite_token_id: inviteTokenId,
          provider_message_id: providerMessageId,
        })
        .eq("id", deliveryId)
        .eq("wedding_id", weddingId);

      if (error) {
        throw error;
      }
    },
  };
}

export class NoInviteSmsTargetsError extends Error {
  constructor() {
    super("No eligible Invited Guests match the Invite SMS rules.");
    this.name = "NoInviteSmsTargetsError";
  }
}

export class InviteSmsGuestNotEligibleError extends Error {
  constructor() {
    super("Guest is not eligible for Invite SMS.");
    this.name = "InviteSmsGuestNotEligibleError";
  }
}

export async function sendInviteSmsTest({
  inviteUrl,
  smsProvider,
  template,
  to,
}: {
  inviteUrl: string;
  smsProvider: SmsProviderAdapter;
  template: string;
  to: string;
}) {
  const message = renderInviteSmsTemplate({
    firstName: INVITE_SMS_FIXED_TEST_FIRST_NAME,
    inviteUrl,
    template,
  });
  await smsProvider.sendSms({ message, to });
  return {
    estimate: estimateSmsSegments(message),
    message,
  };
}

async function sendInviteSmsToTargets({
  adminId,
  formatSendError = getDefaultSendErrorText,
  generateInviteLink,
  now = () => new Date(),
  smsProvider,
  store,
  targets,
  template,
  title = INVITE_SMS_HISTORY_TITLE,
  weddingId,
}: {
  adminId: string;
  formatSendError?: (error: unknown) => string;
  generateInviteLink: InviteSmsLinkGenerator;
  now?: () => Date;
  smsProvider: SmsProviderAdapter;
  store: InviteSmsStore;
  targets: InviteSmsGuestSummary[];
  template: string;
  title?: string;
  weddingId: string;
}): Promise<InviteSmsSendResult> {
  if (targets.length === 0) {
    throw new NoInviteSmsTargetsError();
  }

  const blast = await store.createBlast({
    adminId,
    template,
    title,
    weddingId,
  });
  const results: InviteSmsDeliveryResult[] = [];

  for (const target of targets) {
    if (!target.phone) {
      continue;
    }

    let delivery: { id: string };

    try {
      delivery = await store.createDelivery({
        blastId: blast.id,
        guestId: target.guestId,
        phone: target.phone,
        weddingId,
      });
    } catch (error) {
      console.error("Failed to create Invite SMS delivery", {
        blastId: blast.id,
        error,
        guestId: target.guestId,
      });

      try {
        await store.updateBlast({
          blastId: blast.id,
          sendStatus: results.some((result) => result.status === "sent") ? "partial" : "failed",
          sentAt: now().toISOString(),
          weddingId,
        });
      } catch (updateError) {
        console.error("Failed to update Invite SMS blast after delivery creation failure", {
          blastId: blast.id,
          error: updateError,
        });
      }

      throw error;
    }

    let inviteTokenId: string | null = null;
    let result: InviteSmsDeliveryResult;

    try {
      const inviteLink = await generateInviteLink({
        accessScope: INVITE_ACCESS_SCOPE.full,
        guestId: target.guestId,
        weddingId,
      });
      inviteTokenId = inviteLink.inviteTokenId;
      const message = renderInviteSmsTemplate({
        firstName: target.firstName,
        inviteUrl: inviteLink.inviteUrl,
        template,
      });
      const smsResult = await smsProvider.sendSms({ message, to: target.phone });
      result = {
        deliveryId: delivery.id,
        errorText: null,
        providerMessageId: smsResult.providerMessageId,
        status: "sent",
      };
    } catch (error) {
      console.error("Failed to send Invite SMS delivery", {
        deliveryId: delivery.id,
        error,
        guestId: target.guestId,
      });
      result = {
        deliveryId: delivery.id,
        errorText: formatSendError(error).slice(0, MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH),
        providerMessageId: null,
        status: "failed",
      };
    }

    results.push(result);

    try {
      await store.updateDelivery({
        deliveryId: result.deliveryId,
        deliveryStatus: result.status,
        errorText: result.errorText,
        inviteTokenId,
        providerMessageId: result.providerMessageId,
        weddingId,
      });
    } catch (error) {
      console.error("Failed to update Invite SMS delivery", {
        deliveryId: result.deliveryId,
        error,
      });
    }
  }

  const sendStatus = getBlastStatus(results);
  const failedCount = results.filter((result) => result.status === "failed").length;
  const sentCount = results.length - failedCount;
  const sentAt = now().toISOString();

  try {
    await store.updateBlast({
      blastId: blast.id,
      sendStatus,
      sentAt,
      weddingId,
    });
  } catch (error) {
    console.error("Failed to update Invite SMS blast status", { blastId: blast.id, error });
  }

  return {
    blastId: blast.id,
    failedCount,
    sendStatus,
    sentCount,
    skippedCount: 0,
    totalCount: results.length,
  };
}

export async function sendBulkInviteSmsCommand({
  adminId,
  formatSendError,
  generateInviteLink,
  now,
  requestOrigin,
  requestUrl,
  smsProvider,
  store,
  supabase,
  template,
  weddingId,
}: PublicUrlOptions & {
  adminId: string;
  formatSendError?: (error: unknown) => string;
  generateInviteLink: InviteSmsLinkGenerator;
  now?: () => Date;
  smsProvider: SmsProviderAdapter;
  store: InviteSmsStore;
  supabase: SupabaseClient;
  template: string;
  weddingId: string;
}) {
  const preview = await loadInviteSmsPreview({
    requestOrigin,
    requestUrl,
    supabase,
    weddingId,
  });

  return sendInviteSmsToTargets({
    adminId,
    formatSendError,
    generateInviteLink,
    now,
    smsProvider,
    store,
    targets: preview.eligibleGuests,
    template,
    weddingId,
  });
}

export async function sendSingleInviteSmsCommand({
  adminId,
  formatSendError,
  generateInviteLink,
  guestId,
  now,
  requestOrigin,
  requestUrl,
  smsProvider,
  store,
  supabase,
  template,
  weddingId,
}: PublicUrlOptions & {
  adminId: string;
  formatSendError?: (error: unknown) => string;
  generateInviteLink: InviteSmsLinkGenerator;
  guestId: string;
  now?: () => Date;
  smsProvider: SmsProviderAdapter;
  store: InviteSmsStore;
  supabase: SupabaseClient;
  template: string;
  weddingId: string;
}) {
  const preview = await loadInviteSmsPreview({
    requestOrigin,
    requestUrl,
    supabase,
    weddingId,
  });
  const target = preview.singleSendGuests.find((guest) => guest.guestId === guestId);

  if (!target) {
    throw new InviteSmsGuestNotEligibleError();
  }

  return sendInviteSmsToTargets({
    adminId,
    formatSendError,
    generateInviteLink,
    now,
    smsProvider,
    store,
    targets: [target],
    template,
    title: `Invite SMS to ${target.fullName}`,
    weddingId,
  });
}
