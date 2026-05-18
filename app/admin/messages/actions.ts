"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  MAX_MESSAGE_BODY_LENGTH,
  NoMessageTargetsError,
  sendMessageBlastCommand,
} from "@/lib/message-blast-command";
import { createSupabaseMessageBlastStore } from "@/lib/message-blast-store";
import { isMessageAudience, type MessageAudience } from "@/lib/message-audience";
import {
  Elk46ConfigError,
  Elk46SendError,
  getElk46RuntimeStatus,
  sendElk46Sms,
} from "@/lib/sms/elk46";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function redirectToMessages(params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);
  redirect(`/admin/messages?${searchParams.toString()}`);
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

  return message;
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
  const store = createSupabaseMessageBlastStore(supabase);

  const result = await sendMessageBlastCommand({
    adminId: adminProfile.id,
    audience,
    body,
    formatSendError: getSendErrorText,
    smsProvider: { sendSms: sendElk46Sms },
    store,
    title,
    weddingId: adminProfile.wedding_id,
  }).catch((error: unknown) => {
    if (error instanceof NoMessageTargetsError) {
      redirectToMessages({ error: "no-recipients" });
    }

    console.error("Failed to send message blast", error);
    redirectToMessages({ error: "send-failed" });
  });

  revalidatePath("/admin/messages");
  redirectToMessages({
    failed: String(result.failedCount),
    sent: String(result.sentCount),
    status: result.sendStatus,
  });
}
