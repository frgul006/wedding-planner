import { type MessageAudience } from "@/lib/message-audience";
import { type MessageKind } from "@/lib/message-kind";
import { filterMessageTargetsByAudience, type MessageTarget } from "@/lib/message-targets";

export const MAX_MESSAGE_BODY_LENGTH = 1_000;
export const MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH = 500;

export type FinalMessageBlastStatus = "failed" | "partial" | "sent";
export type FinalMessageDeliveryStatus = "failed" | "sent";

export type CreatedMessageBlast = {
  id: string;
};

export type CreatedMessageDelivery = {
  guestId: string;
  id: string;
  phone: string;
};

export type MessageBlastStore = {
  listMessageTargets(input: { weddingId: string }): Promise<MessageTarget[]>;
  createMessageBlast(input: {
    adminId: string;
    audience: MessageAudience;
    body: string;
    messageKind?: MessageKind;
    title: string | null;
    weddingId: string;
  }): Promise<CreatedMessageBlast>;
  createMessageDeliveries(input: {
    blastId: string;
    targets: MessageTarget[];
    weddingId: string;
  }): Promise<CreatedMessageDelivery[]>;
  updateMessageDelivery(input: {
    deliveryId: string;
    deliveryStatus: FinalMessageDeliveryStatus;
    errorText: string | null;
    providerMessageId: string | null;
    weddingId: string;
  }): Promise<void>;
  updateMessageBlast(input: {
    blastId: string;
    sendStatus: FinalMessageBlastStatus;
    sentAt: string;
    weddingId: string;
  }): Promise<void>;
};

export type SmsProviderAdapter = {
  sendSms(input: { message: string; to: string }): Promise<{ providerMessageId: string | null }>;
};

export type SendMessageBlastCommandResult = {
  blastId: string;
  failedCount: number;
  sendStatus: FinalMessageBlastStatus;
  sentCount: number;
  totalCount: number;
};

type DeliveryResult = {
  deliveryId: string;
  errorText: string | null;
  providerMessageId: string | null;
  status: FinalMessageDeliveryStatus;
};

export class NoMessageTargetsError extends Error {
  constructor() {
    super("No Message targets match this audience.");
    this.name = "NoMessageTargetsError";
  }
}

function getDefaultSendErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "SMS provider request failed.";
  return message.slice(0, MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH);
}

function getBlastStatus(results: DeliveryResult[]): FinalMessageBlastStatus {
  const failedCount = results.filter((result) => result.status === "failed").length;

  if (failedCount === 0) {
    return "sent";
  }

  if (failedCount === results.length) {
    return "failed";
  }

  return "partial";
}

export function buildSmsMessage({ body, title }: { body: string; title: string | null }) {
  return title ? `${title}\n${body}` : body;
}

export async function sendMessageBlastCommand({
  adminId,
  audience,
  body,
  formatSendError = getDefaultSendErrorText,
  now = () => new Date(),
  selectedTargets,
  smsProvider,
  store,
  title,
  weddingId,
}: {
  adminId: string;
  audience: MessageAudience;
  body: string;
  formatSendError?: (error: unknown) => string;
  now?: () => Date;
  selectedTargets?: MessageTarget[];
  smsProvider: SmsProviderAdapter;
  store: MessageBlastStore;
  title: string | null;
  weddingId: string;
}): Promise<SendMessageBlastCommandResult> {
  const messageTargets = selectedTargets
    ? selectedTargets
    : filterMessageTargetsByAudience(await store.listMessageTargets({ weddingId }), audience);

  if (messageTargets.length === 0) {
    throw new NoMessageTargetsError();
  }

  const blast = await store.createMessageBlast({
    adminId,
    audience,
    body,
    messageKind: "custom",
    title,
    weddingId,
  });
  let deliveries: CreatedMessageDelivery[];

  try {
    deliveries = await store.createMessageDeliveries({
      blastId: blast.id,
      targets: messageTargets,
      weddingId,
    });
  } catch (error) {
    const sentAt = now().toISOString();

    try {
      await store.updateMessageBlast({
        blastId: blast.id,
        sendStatus: "failed",
        sentAt,
        weddingId,
      });
    } catch (updateError) {
      console.error("Failed to update message blast status", { blastId: blast.id, error: updateError });
    }

    throw error;
  }

  const smsMessage = buildSmsMessage({ body, title });
  const results: DeliveryResult[] = [];

  for (const delivery of deliveries) {
    let result: DeliveryResult;

    try {
      const smsResult = await smsProvider.sendSms({ message: smsMessage, to: delivery.phone });
      result = {
        deliveryId: delivery.id,
        errorText: null,
        providerMessageId: smsResult.providerMessageId,
        status: "sent",
      };
    } catch (error) {
      console.error("Failed to send SMS delivery", { deliveryId: delivery.id, error });
      result = {
        deliveryId: delivery.id,
        errorText: formatSendError(error).slice(0, MAX_MESSAGE_SEND_ERROR_TEXT_LENGTH),
        providerMessageId: null,
        status: "failed",
      };
    }

    results.push(result);

    try {
      await store.updateMessageDelivery({
        deliveryId: result.deliveryId,
        deliveryStatus: result.status,
        errorText: result.errorText,
        providerMessageId: result.providerMessageId,
        weddingId,
      });
    } catch (error) {
      console.error("Failed to update message delivery", { deliveryId: result.deliveryId, error });
    }
  }

  const sendStatus = getBlastStatus(results);
  const failedCount = results.filter((result) => result.status === "failed").length;
  const sentCount = results.length - failedCount;
  const sentAt = now().toISOString();

  try {
    await store.updateMessageBlast({
      blastId: blast.id,
      sendStatus,
      sentAt,
      weddingId,
    });
  } catch (error) {
    console.error("Failed to update message blast status", { blastId: blast.id, error });
  }

  return {
    blastId: blast.id,
    failedCount,
    sendStatus,
    sentCount,
    totalCount: results.length,
  };
}
