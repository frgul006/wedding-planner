const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;

export const PHONE_FORMAT_EXAMPLE = "+46701234567";
export const PHONE_INPUT_PATTERN = String.raw`\+[1-9][0-9]{7,14}`;
export const PHONE_VALIDATION_MESSAGE = `Use country-code format, e.g. ${PHONE_FORMAT_EXAMPLE}.`;

export function isE164PhoneNumber(phone: string) {
  return PHONE_E164_REGEX.test(phone);
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

  if (!PHONE_E164_REGEX.test(phone)) {
    return { isValid: false, phone: null };
  }

  return { isValid: true, phone };
}
