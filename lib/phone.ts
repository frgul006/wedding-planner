const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
const PHONE_SWEDISH_MOBILE_REGEX = /^07\d{8}$/;

export const PHONE_FORMAT_EXAMPLE = "+46701234567";
export const PHONE_LOCAL_FORMAT_EXAMPLE = "0701234567";
export const PHONE_FORMAT_HINT = `${PHONE_FORMAT_EXAMPLE} eller ${PHONE_LOCAL_FORMAT_EXAMPLE}`;
export const PHONE_INPUT_PATTERN = String.raw`(?:\+[1-9][0-9]{7,14}|07[0-9]{8})`;
export const PHONE_VALIDATION_MESSAGE = `Use +46 format or Swedish mobile format, e.g. ${PHONE_FORMAT_HINT}.`;

export function isE164PhoneNumber(phone: string) {
  return PHONE_E164_REGEX.test(phone);
}

export function normalizePhoneNumberInput(phone: string) {
  const trimmed = phone.trim();

  if (PHONE_E164_REGEX.test(trimmed)) {
    return trimmed;
  }

  if (PHONE_SWEDISH_MOBILE_REGEX.test(trimmed)) {
    return `+46${trimmed.slice(1)}`;
  }

  return null;
}

type OptionalPhoneParseResult =
  | { isValid: true; phone: string | null }
  | { isValid: false; phone: null };

export function parseOptionalPhone(
  value: FormDataEntryValue | null,
): OptionalPhoneParseResult {
  const phone = typeof value === "string" ? value.trim() : "";

  if (!phone) {
    return { isValid: true, phone: null };
  }

  const normalizedPhone = normalizePhoneNumberInput(phone);

  if (!normalizedPhone) {
    return { isValid: false, phone: null };
  }

  return { isValid: true, phone: normalizedPhone };
}
