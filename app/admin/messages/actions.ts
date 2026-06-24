"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  buildInviteSmsSampleUrl,
  cleanInviteSmsTemplate,
  validateInviteSmsTemplate,
} from "@/lib/invite-sms-template";
import {
  getInviteSmsSendOriginStatus,
  InviteSmsGuestNotEligibleError,
  loadInviteSmsPreview,
  NoInviteSmsTargetsError,
  sendBulkInviteSmsCommand,
  sendInviteSmsTest,
  sendSingleInviteSmsCommand,
  updateInviteSmsTemplate,
  createSupabaseInviteSmsStore,
} from "@/lib/invite-sms";
import {
  MAX_MESSAGE_BODY_LENGTH,
  NoMessageTargetsError,
  sendMessageBlastCommand,
} from "@/lib/message-blast-command";
import { createSupabaseMessageBlastStore } from "@/lib/message-blast-store";
import { isMessageAudience, type MessageAudience } from "@/lib/message-audience";
import { loadSelectedMessageTargetsPreview, parseSelectedGuestIds } from "@/lib/message-targets";
import { isE164PhoneNumber } from "@/lib/phone";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { regenerateInviteToken } from "@/lib/invite-tokens";
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

function redirectToInviteSms(params: Record<string, string> = {}): never {
  redirectToMessages({ invite_preview: "1", ...params });
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

function getInviteSmsTemplateError(status: ReturnType<typeof validateInviteSmsTemplate>["status"]) {
  if (status === "missing-template") {
    return "invite-template-missing";
  }

  if (status === "missing-first-name") {
    return "invite-template-missing-first-name";
  }

  if (status === "missing-link") {
    return "invite-template-missing-link";
  }

  if (status === "unknown-placeholder") {
    return "invite-template-unknown-placeholder";
  }

  if (status === "too-long") {
    return "invite-template-too-long";
  }

  return null;
}

function getInviteSmsTestPhoneNumber() {
  const phone = process.env.ELK46_TEST_PHONE_NUMBER?.trim();
  return phone && isE164PhoneNumber(phone) ? phone : null;
}

async function saveInviteSmsTemplateFromForm({
  formData,
  requestOrigin,
  supabase,
  weddingId,
}: {
  formData: FormData;
  requestOrigin: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  weddingId: string;
}) {
  const template = cleanInviteSmsTemplate(formData.get("invite_sms_template"));
  const validation = validateInviteSmsTemplate({
    sampleInviteUrl: buildInviteSmsSampleUrl({ requestOrigin }),
    template,
  });
  const templateError = getInviteSmsTemplateError(validation.status);

  if (templateError || validation.status !== "ok") {
    redirectToInviteSms({ invite_error: templateError ?? "invite-template-invalid" });
  }

  try {
    await updateInviteSmsTemplate({
      supabase,
      template: validation.template,
      weddingId,
    });
  } catch (error) {
    console.error("Failed to save Invite SMS template", error);
    redirectToInviteSms({ invite_error: "invite-template-save-failed" });
  }

  return validation.template;
}

async function loadSavedInviteSmsTemplateOrRedirect({
  requestOrigin,
  supabase,
  weddingId,
}: {
  requestOrigin: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  weddingId: string;
}) {
  let preview: Awaited<ReturnType<typeof loadInviteSmsPreview>>;

  try {
    preview = await loadInviteSmsPreview({ requestOrigin, supabase, weddingId });
  } catch (error) {
    console.error("Failed to load Invite SMS preview", error);
    redirectToInviteSms({ invite_error: "invite-preview-failed" });
  }

  const templateError = getInviteSmsTemplateError(preview.validationStatus);

  if (templateError) {
    redirectToInviteSms({ invite_error: templateError });
  }

  return preview.template;
}

function getInviteSmsLinkGenerator({
  requestOrigin,
  supabase,
}: {
  requestOrigin: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  return async ({ accessScope, guestId, weddingId }: {
    accessScope: "full";
    guestId: string;
    weddingId: string;
  }) => regenerateInviteToken({
    accessScope,
    guestId,
    requestOrigin,
    supabase,
    weddingId,
  });
}

function ensureInviteSmsOriginAllowed(requestOrigin: string | null) {
  const smsStatus = getElk46RuntimeStatus();
  const originStatus = getInviteSmsSendOriginStatus({
    mockSend: smsStatus.mockSend,
    requestOrigin,
  });

  if (!originStatus.isAllowed) {
    redirectToInviteSms({ invite_error: originStatus.reason });
  }
}

export async function sendMessageBlastAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const title = cleanOptionalText(formData.get("title"));
  const body = cleanRequiredText(formData.get("body"));
  const selectedGuestIds = parseSelectedGuestIds(formData.get("selected_guests"));
  const isSelectedMode = selectedGuestIds.length > 0;
  const selectedRedirectParams: Record<string, string> = isSelectedMode
    ? { selected_guests: selectedGuestIds.join(",") }
    : {};
  const redirectMessageError = (params: Record<string, string>): never =>
    redirectToMessages({ ...selectedRedirectParams, ...params });
  const audience = isSelectedMode ? "all" : getAudienceFromForm(formData);
  const isConfirmed = formData.get("confirm_send") === "on";

  if (!body) {
    redirectMessageError({ error: "missing-body" });
  }

  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    redirectMessageError({ error: "body-too-long" });
  }

  if (!audience) {
    redirectMessageError({ error: "invalid-audience" });
    throw new Error("Redirected after invalid message audience.");
  }

  if (!isConfirmed) {
    redirectMessageError({ error: "confirm-required" });
  }

  const smsStatus = getElk46RuntimeStatus();

  if (!smsStatus.isConfigured) {
    redirectMessageError({ error: "sms-config" });
  }

  const supabase = await createSupabaseServerClient();
  const store = createSupabaseMessageBlastStore(supabase);
  const selectedTargets = isSelectedMode
    ? await loadSelectedMessageTargetsPreview({
        selectedGuestIds,
        supabase,
        weddingId: adminProfile.wedding_id,
      }).then((result) => {
        if (result.error || !result.preview) {
          console.error("Failed load selected Message targets", result.error);
          redirectMessageError({ error: "send-failed" });
          throw new Error("Redirected after selected Message target load failure.");
        }

        const preview = result.preview;

        if (preview.eligibleTargets.length === 0) {
          redirectMessageError({ error: "no-recipients" });
          throw new Error("Redirected after selected Message target empty result.");
        }

        return preview.eligibleTargets;
      })
    : undefined;

  const result = await sendMessageBlastCommand({
    adminId: adminProfile.id,
    audience,
    body,
    formatSendError: getSendErrorText,
    selectedTargets,
    smsProvider: { sendSms: sendElk46Sms },
    store,
    title,
    weddingId: adminProfile.wedding_id,
  }).catch((error: unknown) => {
    if (error instanceof NoMessageTargetsError) {
      redirectMessageError({ error: "no-recipients" });
    }

    console.error("Failed send message blast", error);
    redirectMessageError({ error: "send-failed" });
    throw new Error("Redirected after message blast failure.");
  });

  revalidatePath("/admin/messages");
  redirectToMessages({
    ...selectedRedirectParams,
    failed: String(result.failedCount),
    sent: String(result.sentCount),
    status: result.sendStatus,
  });
}

export async function previewInviteSmsAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const requestOrigin = getRequestOriginFromHeaders(await headers());

  await saveInviteSmsTemplateFromForm({
    formData,
    requestOrigin,
    supabase,
    weddingId: adminProfile.wedding_id,
  });

  revalidatePath("/admin/messages");
  redirectToInviteSms({ invite_status: "preview-ready" });
}

export async function sendInviteSmsTestAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const smsStatus = getElk46RuntimeStatus();

  if (!smsStatus.isConfigured) {
    redirectToInviteSms({ invite_error: "sms-config" });
  }

  const testPhoneNumber = getInviteSmsTestPhoneNumber();

  if (!testPhoneNumber) {
    redirectToInviteSms({ invite_error: "invite-test-phone" });
  }

  const template = await saveInviteSmsTemplateFromForm({
    formData,
    requestOrigin,
    supabase,
    weddingId: adminProfile.wedding_id,
  });

  try {
    await sendInviteSmsTest({
      inviteUrl: buildInviteSmsSampleUrl({ requestOrigin }),
      smsProvider: { sendSms: sendElk46Sms },
      template,
      to: testPhoneNumber,
    });
  } catch (error) {
    console.error("Failed to send Invite SMS test", error);
    redirectToInviteSms({ invite_error: "invite-test-failed" });
  }

  revalidatePath("/admin/messages");
  redirectToInviteSms({ invite_status: "test-sent" });
}

export async function sendBulkInviteSmsAction(formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const isConfirmed = formData.get("confirm_invite_sms_send") === "on";

  if (!isConfirmed) {
    redirectToInviteSms({ invite_error: "invite-confirm-required" });
  }

  const smsStatus = getElk46RuntimeStatus();

  if (!smsStatus.isConfigured) {
    redirectToInviteSms({ invite_error: "sms-config" });
  }

  ensureInviteSmsOriginAllowed(requestOrigin);

  const supabase = await createSupabaseServerClient();
  const template = await loadSavedInviteSmsTemplateOrRedirect({
    requestOrigin,
    supabase,
    weddingId: adminProfile.wedding_id,
  });
  const result = await sendBulkInviteSmsCommand({
    adminId: adminProfile.id,
    formatSendError: getSendErrorText,
    generateInviteLink: getInviteSmsLinkGenerator({ requestOrigin, supabase }),
    requestOrigin,
    smsProvider: { sendSms: sendElk46Sms },
    store: createSupabaseInviteSmsStore(supabase),
    supabase,
    template,
    weddingId: adminProfile.wedding_id,
  }).catch((error: unknown) => {
    if (error instanceof NoInviteSmsTargetsError) {
      redirectToInviteSms({ invite_error: "invite-no-targets" });
    }

    console.error("Failed to send Invite SMS", error);
    redirectToInviteSms({ invite_error: "invite-send-failed" });
  });

  revalidatePath("/admin/messages");
  redirectToInviteSms({
    invite_failed: String(result.failedCount),
    invite_sent: String(result.sentCount),
    invite_status: result.sendStatus,
  });
}

export async function sendSingleInviteSmsAction(guestId: string, formData: FormData) {
  const adminProfile = await requireActiveAdminProfile();
  const requestOrigin = getRequestOriginFromHeaders(await headers());
  const isConfirmed = formData.get("confirm_single_invite_sms_send") === "on";

  if (!isConfirmed) {
    redirectToInviteSms({ invite_error: "invite-single-confirm-required" });
  }

  const smsStatus = getElk46RuntimeStatus();

  if (!smsStatus.isConfigured) {
    redirectToInviteSms({ invite_error: "sms-config" });
  }

  ensureInviteSmsOriginAllowed(requestOrigin);

  const supabase = await createSupabaseServerClient();
  const template = await loadSavedInviteSmsTemplateOrRedirect({
    requestOrigin,
    supabase,
    weddingId: adminProfile.wedding_id,
  });
  const result = await sendSingleInviteSmsCommand({
    adminId: adminProfile.id,
    formatSendError: getSendErrorText,
    generateInviteLink: getInviteSmsLinkGenerator({ requestOrigin, supabase }),
    guestId,
    requestOrigin,
    smsProvider: { sendSms: sendElk46Sms },
    store: createSupabaseInviteSmsStore(supabase),
    supabase,
    template,
    weddingId: adminProfile.wedding_id,
  }).catch((error: unknown) => {
    if (error instanceof InviteSmsGuestNotEligibleError) {
      redirectToInviteSms({ invite_error: "invite-guest-not-eligible" });
    }

    console.error("Failed to send single Invite SMS", error);
    redirectToInviteSms({ invite_error: "invite-send-failed" });
  });

  revalidatePath("/admin/messages");
  redirectToInviteSms({
    invite_failed: String(result.failedCount),
    invite_sent: String(result.sentCount),
    invite_status: result.sendStatus,
  });
}
