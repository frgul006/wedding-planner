import { buildPublicUrl, type PublicUrlOptions } from "@/lib/public-url";

export const INVITE_SMS_FIRST_NAME_PLACEHOLDER = "{{first_name}}";
export const INVITE_SMS_LINK_PLACEHOLDER = "{{invite_link}}";
export const INVITE_SMS_DEFAULT_TEMPLATE =
  "Hej {{first_name}}! Välkomna att fira vår dag tillsammans med oss. Här är er personliga inbjudan där ni kan OSA: {{invite_link}} / Fredrik & Matilda";
export const INVITE_SMS_FIXED_TEST_FIRST_NAME = "Fredrik";
export const INVITE_SMS_SAMPLE_TOKEN = "x".repeat(43);
export const MAX_INVITE_SMS_RENDERED_LENGTH = 1_000;

const ALLOWED_PLACEHOLDERS = new Set([
  INVITE_SMS_FIRST_NAME_PLACEHOLDER,
  INVITE_SMS_LINK_PLACEHOLDER,
]);
const PLACEHOLDER_REGEX = /{{[^{}]+}}/g;
const GSM_BASIC_CHARS = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM_EXTENDED_CHARS = new Set(Array.from("^{}\\[~]|€"));

export type InviteSmsTemplateValidationStatus =
  | "ok"
  | "missing-first-name"
  | "missing-link"
  | "missing-template"
  | "too-long"
  | "unknown-placeholder";

export type InviteSmsTemplateValidationResult =
  | { status: "ok"; template: string }
  | {
      status: Exclude<InviteSmsTemplateValidationStatus, "ok">;
      unknownPlaceholders?: string[];
    };

export type SmsSegmentEstimate = {
  encoding: "gsm-7" | "unicode";
  length: number;
  segments: number;
};

export function cleanInviteSmsTemplate(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : "";
}

function getUnknownPlaceholders(template: string) {
  return Array.from(new Set(template.match(PLACEHOLDER_REGEX) ?? [])).filter(
    (placeholder) => !ALLOWED_PLACEHOLDERS.has(placeholder),
  );
}

export function getInviteSmsFirstName(fullName: string) {
  const trimmedName = fullName.trim();
  const firstWord = trimmedName.split(/\s+/)[0];
  return firstWord && firstWord.length > 0 ? firstWord : trimmedName;
}

export function buildInviteSmsSampleUrl(options?: PublicUrlOptions) {
  return buildPublicUrl(`/invite/${INVITE_SMS_SAMPLE_TOKEN}`, options);
}

export function renderInviteSmsTemplate({
  firstName,
  inviteUrl,
  template,
}: {
  firstName: string;
  inviteUrl: string;
  template: string;
}) {
  return template
    .replaceAll(INVITE_SMS_FIRST_NAME_PLACEHOLDER, firstName)
    .replaceAll(INVITE_SMS_LINK_PLACEHOLDER, inviteUrl);
}

export function estimateSmsSegments(message: string): SmsSegmentEstimate {
  let gsmLength = 0;

  for (const character of Array.from(message)) {
    if (GSM_BASIC_CHARS.has(character)) {
      gsmLength += 1;
    } else if (GSM_EXTENDED_CHARS.has(character)) {
      gsmLength += 2;
    } else {
      const length = Array.from(message).length;
      return {
        encoding: "unicode",
        length,
        segments: Math.max(1, Math.ceil(length / (length > 70 ? 67 : 70))),
      };
    }
  }

  return {
    encoding: "gsm-7",
    length: gsmLength,
    segments: Math.max(1, Math.ceil(gsmLength / (gsmLength > 160 ? 153 : 160))),
  };
}

export function validateInviteSmsTemplate({
  sampleInviteUrl,
  sampleName = INVITE_SMS_FIXED_TEST_FIRST_NAME,
  template,
}: {
  sampleInviteUrl: string;
  sampleName?: string;
  template: string;
}): InviteSmsTemplateValidationResult {
  const cleanedTemplate = template.trim();

  if (!cleanedTemplate) {
    return { status: "missing-template" };
  }

  if (!cleanedTemplate.includes(INVITE_SMS_FIRST_NAME_PLACEHOLDER)) {
    return { status: "missing-first-name" };
  }

  if (!cleanedTemplate.includes(INVITE_SMS_LINK_PLACEHOLDER)) {
    return { status: "missing-link" };
  }

  const unknownPlaceholders = getUnknownPlaceholders(cleanedTemplate);

  if (unknownPlaceholders.length > 0) {
    return { status: "unknown-placeholder", unknownPlaceholders };
  }

  const renderedMessage = renderInviteSmsTemplate({
    firstName: sampleName,
    inviteUrl: sampleInviteUrl,
    template: cleanedTemplate,
  });

  if (renderedMessage.length > MAX_INVITE_SMS_RENDERED_LENGTH) {
    return { status: "too-long" };
  }

  return { status: "ok", template: cleanedTemplate };
}
