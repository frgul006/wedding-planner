"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { isMessageAudience, type MessageAudience } from "@/lib/message-audience";
import { isE164PhoneNumber } from "@/lib/phone";
import {
  Elk46ConfigError,
  Elk46SendError,
  getElk46RuntimeStatus,
  sendElk46Sms,
} from "@/lib/sms/elk46";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecord } from "@/lib/type-guards";

const MAX_MESSAGE_BODY_LENGTH = 1_000;
const MAX_ERROR_TEXT_LENGTH = 500;

type GuestRecipient = {
  id: string;
  full_name: string;
  phone: string;
};

type DeliveryRow = {
  id: string;
  guest_id: string;
  phone: string;
};

type DeliveryResult = {
  deliveryId: string;
  errorText: string | null;
  providerMessageId: string | null;
  status: "failed" | "sent";
};

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function redirectToMessages(params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  redirect(`/admin/messages?${searchParams.toString()}`);
}

function isGuestRecipient(value: unknown): value is GuestRecipient {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.phone === "string"
  );
}

function isDeliveryRow(value: unknown): value is DeliveryRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.guest_id === "string" &&
    typeof value.phone === "string"
  );
}

function buildSmsMessage({ body, title }: { body: string; title: string | null }) {
  return title ? `${title}\n${body}` : body;
}

function getAudienceFromForm(formData: FormData): MessageAudience | null {
  const audience = formData.get("audience");
  return isMessageAudience(audience) ? audience : null;
}

function getSendErrorText(error: unknown) {
  let message = "SMS provider request failed.";

  if (error instanceof Elk46ConfigError) {
    message = error.message;
  } else if (error instanceof Elk46SendError) {
    message = `${error.message} ${error.providerText}`.trim();
  } else if (error instanceof Error) {
    message = error.message;
  }

  return message.slice(0, MAX_ERROR_TEXT_LENGTH);
}

function getBlastStatus(results: DeliveryResult[]) {
  const failedCount = results.filter((result) => result.status === "failed").length;

  if (failedCount === 0) {
    return "sent";
  }

  if (failedCount === results.length) {
    return "failed";
  }

  return "partial";
}

export async function sendMessageBlastAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const title = cleanOptionalText(formData.get("title"));
  const body = cleanRequiredText(formData.get("body"));
  const audience = getAudienceFromForm(formData);
  const isConfirmed = formData.get("confirm_send") === "on";

  if (!body) {
    redirectToMessages({ error: "missing-body" });
  }

  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    redirectToMessages({ error: "body-too-long" });
  }

  if (!audience) {
    redirectToMessages({ error: "invalid-audience" });
  }

  if (!isConfirmed) {
    redirectToMessages({ error: "confirm-required" });
  }

  const smsStatus = getElk46RuntimeStatus();

  if (!smsStatus.isConfigured) {
    redirectToMessages({ error: "sms-config" });
  }

  const supabase = await createSupabaseServerClient();
  let guestsQuery = supabase
    .from("guests")
    .select("id, full_name, phone")
    .eq("wedding_id", adminProfile.wedding_id)
    .eq("sms_opt_in", true)
    .is("sms_opted_out_at", null)
    .is("deleted_at", null)
    .not("phone", "is", null)
    .order("full_name", { ascending: true });

  if (audience !== "all") {
    guestsQuery = guestsQuery.eq("rsvp_status", audience);
  }

  const { data: recipientRows, error: recipientError } = await guestsQuery;

  if (recipientError) {
    console.error("Failed to load SMS recipients", recipientError);
    redirectToMessages({ error: "recipient-load" });
  }

  const recipients = (recipientRows ?? [])
    .filter(isGuestRecipient)
    .filter((guest) => isE164PhoneNumber(guest.phone));

  if (recipients.length === 0) {
    redirectToMessages({ error: "no-recipients" });
  }

  const { data: blast, error: blastError } = await supabase
    .from("message_blasts")
    .insert({
      audience,
      body,
      created_by_admin_id: adminProfile.id,
      send_status: "queued",
      title,
      wedding_id: adminProfile.wedding_id,
    })
    .select("id")
    .single();

  const blastId = typeof blast?.id === "string" ? blast.id : null;

  if (blastError || !blastId) {
    console.error("Failed to create message blast", blastError);
    redirectToMessages({ error: "create-failed" });
  }

  const { data: deliveryRows, error: deliveryCreateError } = await supabase
    .from("message_deliveries")
    .insert(
      recipients.map((recipient) => ({
        delivery_status: "queued",
        guest_id: recipient.id,
        message_blast_id: blastId,
        phone: recipient.phone,
        wedding_id: adminProfile.wedding_id,
      })),
    )
    .select("id, guest_id, phone");

  if (deliveryCreateError) {
    console.error("Failed to create message delivery rows", deliveryCreateError);
    await supabase
      .from("message_blasts")
      .update({ send_status: "failed", sent_at: new Date().toISOString() })
      .eq("id", blastId)
      .eq("wedding_id", adminProfile.wedding_id);
    redirectToMessages({ error: "create-failed" });
  }

  const deliveries = (deliveryRows ?? []).filter(isDeliveryRow);
  const smsMessage = buildSmsMessage({ body, title });
  const results: DeliveryResult[] = [];

  for (const delivery of deliveries) {
    let result: DeliveryResult;

    try {
      const smsResult = await sendElk46Sms({ message: smsMessage, to: delivery.phone });
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
        errorText: getSendErrorText(error),
        providerMessageId: null,
        status: "failed",
      };
    }

    results.push(result);

    const { error: updateDeliveryError } = await supabase
      .from("message_deliveries")
      .update({
        delivery_status: result.status,
        error_text: result.errorText,
        provider_message_id: result.providerMessageId,
      })
      .eq("id", result.deliveryId)
      .eq("wedding_id", adminProfile.wedding_id);

    if (updateDeliveryError) {
      console.error("Failed to update message delivery", updateDeliveryError);
    }
  }

  const sendStatus = getBlastStatus(results);
  const failedCount = results.filter((result) => result.status === "failed").length;
  const sentCount = results.length - failedCount;
  const { error: updateBlastError } = await supabase
    .from("message_blasts")
    .update({ send_status: sendStatus, sent_at: new Date().toISOString() })
    .eq("id", blastId)
    .eq("wedding_id", adminProfile.wedding_id);

  if (updateBlastError) {
    console.error("Failed to update message blast status", updateBlastError);
  }

  revalidatePath("/admin/messages");
  redirectToMessages({
    failed: String(failedCount),
    sent: String(sentCount),
    status: sendStatus,
  });
}
