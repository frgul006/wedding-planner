import {
  isE164PhoneNumber,
  parseOptionalPhone,
  PHONE_FORMAT_EXAMPLE,
} from "./phone";
import {
  isRsvpAttendance,
  RSVP_ATTENDANCE,
  type RsvpAttendance,
} from "./rsvp-attendance";

export const RSVP_FORM_FIELDS = {
  allergyNotes: "allergy_notes",
  attendance: "attendance",
  foodPreference: "food_preference",
  includePlusOne: "include_plus_one",
  phone: "phone",
  plusOneAllergyNotes: "plus_one_allergy_notes",
  plusOneEmail: "plus_one_email",
  plusOneFoodPreference: "plus_one_food_preference",
  plusOneName: "plus_one_name",
  plusOnePhone: "plus_one_phone",
  plusOneSmsOptIn: "plus_one_sms_opt_in",
  smsOptIn: "sms_opt_in",
} as const;

export type RsvpFormFieldName =
  (typeof RSVP_FORM_FIELDS)[keyof typeof RSVP_FORM_FIELDS];

export type RsvpActionField = Exclude<
  RsvpFormFieldName,
  | typeof RSVP_FORM_FIELDS.includePlusOne
  | typeof RSVP_FORM_FIELDS.plusOneSmsOptIn
  | typeof RSVP_FORM_FIELDS.smsOptIn
>;

export type RsvpSmsOptInField =
  | typeof RSVP_FORM_FIELDS.plusOneSmsOptIn
  | typeof RSVP_FORM_FIELDS.smsOptIn;

export type RsvpFormValues = {
  allergyNotes: string;
  attendance: string;
  foodPreference: string;
  includePlusOne: boolean;
  phone: string;
  plusOneAllergyNotes: string;
  plusOneEmail: string;
  plusOneFoodPreference: string;
  plusOneName: string;
  plusOnePhone: string;
  plusOneSmsOptIn: boolean;
  smsOptIn: boolean;
};

export type InitialRsvpFormModel = Omit<RsvpFormValues, "attendance"> & {
  attendance: RsvpAttendance;
};

export type RsvpFormGuest = {
  phone: string | null;
  plus_one_allowed: boolean;
  sms_opt_in: boolean;
};

export type RsvpFormResponse = {
  allergy_notes: string | null;
  attendance: RsvpAttendance;
  extra_guests: number;
  food_preference: string | null;
  plus_one_allergy_notes: string | null;
  plus_one_email: string | null;
  plus_one_food_preference: string | null;
  plus_one_name: string | null;
  plus_one_phone: string | null;
  plus_one_sms_opt_in: boolean;
};

export type RsvpIntent = {
  allergyNotes: string | null;
  attendance: RsvpAttendance | null;
  foodPreference: string | null;
  hasPlusOnePayload: boolean;
  phone: ReturnType<typeof parseOptionalPhone>;
  plusOneAllergyNotes: string | null;
  plusOneEmail: string | null;
  plusOneFoodPreference: string | null;
  plusOneName: string | null;
  plusOnePhone: ReturnType<typeof parseOptionalPhone>;
  values: RsvpFormValues;
};

export const RSVP_ACTION_COPY = {
  saveError: {
    generic: "Försök igen om en stund.",
    invalidInvite:
      "Inbjudningslänken kunde inte verifieras. Be om en ny länk och försök igen.",
    plusOneNotAllowed: "Du kan inte lägga till en +1 på den här inbjudan.",
  },
  validation: {
    attendanceRequired: "Välj Ja, Nej eller Kanske innan du sparar.",
    phoneFormat: `Använd internationellt format utan mellanslag, t.ex. ${PHONE_FORMAT_EXAMPLE}.`,
    plusOneNameRequired: "Skriv namnet på din gäst innan du sparar.",
    plusOneSmsPhoneRequired:
      "Lägg till din gästs telefonnummer om hen ska få SMS-uppdateringar.",
    smsPhoneRequired: "Lägg till ett telefonnummer om du vill få SMS-uppdateringar.",
  },
} as const;

export const RSVP_ATTENDANCE_OPTIONS = [
  { description: "kommer", label: "Ja", value: RSVP_ATTENDANCE.yes },
  { description: "kan inte", label: "Nej", value: RSVP_ATTENDANCE.no },
  { description: "återkommer", label: "Kanske", value: RSVP_ATTENDANCE.maybe },
] as const satisfies ReadonlyArray<{
  description: string;
  label: string;
  value: RsvpAttendance;
}>;

export function getRsvpAttendanceSummary(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return { detail: "jag kommer gärna", label: "Ja" };
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return { detail: "jag kan tyvärr inte", label: "Nej" };
  }

  return { detail: "jag återkommer", label: "Kanske" };
}

function getTextValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getBooleanValue(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function cleanOptionalText(value: string) {
  return value.length > 0 ? value : null;
}

function hasOptionalText(value: string | null) {
  return value !== null;
}

function parseAttendance(value: string): RsvpAttendance | null {
  if (!isRsvpAttendance(value)) {
    return null;
  }

  return value;
}

function getInitialSmsOptIn({
  hasExistingRsvp,
  phone,
  smsOptIn,
}: {
  hasExistingRsvp: boolean;
  phone: string;
  smsOptIn: boolean;
}) {
  if (!isE164PhoneNumber(phone)) {
    return false;
  }

  return hasExistingRsvp ? smsOptIn : true;
}

export function getInitialRsvpFormModel({
  guest,
  rsvpResponse,
}: {
  guest: RsvpFormGuest;
  rsvpResponse: RsvpFormResponse | null;
}): InitialRsvpFormModel {
  const hasExistingRsvp = Boolean(rsvpResponse);
  const phone = guest.phone ?? "";
  const plusOnePhone = rsvpResponse?.plus_one_phone ?? "";

  return {
    allergyNotes: rsvpResponse?.allergy_notes ?? "",
    attendance: rsvpResponse?.attendance ?? RSVP_ATTENDANCE.yes,
    foodPreference: rsvpResponse?.food_preference ?? "",
    includePlusOne: Boolean(
      guest.plus_one_allowed &&
        rsvpResponse?.extra_guests &&
        rsvpResponse.plus_one_name,
    ),
    phone,
    plusOneAllergyNotes: rsvpResponse?.plus_one_allergy_notes ?? "",
    plusOneEmail: rsvpResponse?.plus_one_email ?? "",
    plusOneFoodPreference: rsvpResponse?.plus_one_food_preference ?? "",
    plusOneName: rsvpResponse?.plus_one_name ?? "",
    plusOnePhone,
    plusOneSmsOptIn: isE164PhoneNumber(plusOnePhone)
      ? Boolean(rsvpResponse?.plus_one_sms_opt_in)
      : false,
    smsOptIn: getInitialSmsOptIn({
      hasExistingRsvp,
      phone,
      smsOptIn: guest.sms_opt_in,
    }),
  };
}

export function getRsvpFormValues(formData: FormData): RsvpFormValues {
  return {
    allergyNotes: getTextValue(formData.get(RSVP_FORM_FIELDS.allergyNotes)),
    attendance: getTextValue(formData.get(RSVP_FORM_FIELDS.attendance)),
    foodPreference: getTextValue(formData.get(RSVP_FORM_FIELDS.foodPreference)),
    includePlusOne: getBooleanValue(formData.get(RSVP_FORM_FIELDS.includePlusOne)),
    phone: getTextValue(formData.get(RSVP_FORM_FIELDS.phone)),
    plusOneAllergyNotes: getTextValue(
      formData.get(RSVP_FORM_FIELDS.plusOneAllergyNotes),
    ),
    plusOneEmail: getTextValue(formData.get(RSVP_FORM_FIELDS.plusOneEmail)),
    plusOneFoodPreference: getTextValue(
      formData.get(RSVP_FORM_FIELDS.plusOneFoodPreference),
    ),
    plusOneName: getTextValue(formData.get(RSVP_FORM_FIELDS.plusOneName)),
    plusOnePhone: getTextValue(formData.get(RSVP_FORM_FIELDS.plusOnePhone)),
    plusOneSmsOptIn: getBooleanValue(
      formData.get(RSVP_FORM_FIELDS.plusOneSmsOptIn),
    ),
    smsOptIn: getBooleanValue(formData.get(RSVP_FORM_FIELDS.smsOptIn)),
  };
}

export function parseRsvpFormData(formData: FormData): RsvpIntent {
  const values = getRsvpFormValues(formData);
  const phone = parseOptionalPhone(values.phone);
  const plusOnePhone = parseOptionalPhone(values.plusOnePhone);
  const foodPreference = cleanOptionalText(values.foodPreference);
  const allergyNotes = cleanOptionalText(values.allergyNotes);
  const plusOneName = cleanOptionalText(values.plusOneName);
  const plusOneEmail = cleanOptionalText(values.plusOneEmail);
  const plusOneFoodPreference = cleanOptionalText(values.plusOneFoodPreference);
  const plusOneAllergyNotes = cleanOptionalText(values.plusOneAllergyNotes);
  const hasPlusOnePayload =
    values.includePlusOne ||
    [plusOneName, plusOneEmail, plusOneFoodPreference, plusOneAllergyNotes].some(
      hasOptionalText,
    ) ||
    plusOnePhone.phone !== null ||
    values.plusOneSmsOptIn;

  return {
    allergyNotes,
    attendance: parseAttendance(values.attendance),
    foodPreference,
    hasPlusOnePayload,
    phone,
    plusOneAllergyNotes,
    plusOneEmail,
    plusOneFoodPreference,
    plusOneName,
    plusOnePhone,
    values,
  };
}

export function validateRsvpIntent(intent: RsvpIntent) {
  const fieldErrors: Partial<Record<RsvpActionField, string>> = {};

  if (!intent.attendance) {
    fieldErrors.attendance = RSVP_ACTION_COPY.validation.attendanceRequired;
  }

  if (!intent.phone.isValid) {
    fieldErrors.phone = RSVP_ACTION_COPY.validation.phoneFormat;
  } else if (intent.values.smsOptIn && !intent.phone.phone) {
    fieldErrors.phone = RSVP_ACTION_COPY.validation.smsPhoneRequired;
  }

  if (!intent.plusOnePhone.isValid) {
    fieldErrors.plus_one_phone = RSVP_ACTION_COPY.validation.phoneFormat;
  } else if (intent.values.plusOneSmsOptIn && !intent.plusOnePhone.phone) {
    fieldErrors.plus_one_phone =
      RSVP_ACTION_COPY.validation.plusOneSmsPhoneRequired;
  }

  if (intent.hasPlusOnePayload && !intent.plusOneName) {
    fieldErrors.plus_one_name = RSVP_ACTION_COPY.validation.plusOneNameRequired;
  }

  return fieldErrors;
}
