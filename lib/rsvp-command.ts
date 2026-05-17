import { hashInviteToken } from "./invite-token-crypto";
import { parseOptionalPhone } from "./phone";
import { isRsvpAttendance, type RsvpAttendance } from "./rsvp-attendance";
import {
  buildRsvpErrorState,
  buildSubmittedRsvpState,
  RSVP_ACTION_COPY,
  type RsvpActionField,
  type RsvpActionState,
  type RsvpFormValues,
} from "./rsvp-form-state";

export type SubmitRsvpResponseRpcArgs = {
  p_allergy_notes: string | null;
  p_attendance: RsvpAttendance;
  p_extra_guests: 0 | 1;
  p_food_preference: string | null;
  p_phone: string | null;
  p_plus_one_allergy_notes: string | null;
  p_plus_one_email: string | null;
  p_plus_one_food_preference: string | null;
  p_plus_one_name: string | null;
  p_plus_one_phone: string | null;
  p_plus_one_sms_opt_in: boolean;
  p_sms_opt_in: boolean;
  p_token_hash: string;
};

type RsvpDatabaseError = {
  code?: string;
  message?: string;
};

export type RsvpResponseRpcAdapter = {
  rpc(
    functionName: "submit_rsvp_response",
    args: SubmitRsvpResponseRpcArgs,
  ): PromiseLike<{ error: RsvpDatabaseError | null }>;
};

type RsvpCommandLogger = {
  error: (...args: unknown[]) => void;
};

type SubmitRsvpCommandInput = {
  formData: FormData;
  hashToken?: (rawToken: string) => string;
  logger?: RsvpCommandLogger;
  rawToken: string;
  rpcAdapter: RsvpResponseRpcAdapter;
};

type RsvpIntent = {
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

function getTextValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getBooleanValue(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function cleanOptionalText(value: string) {
  return value.length > 0 ? value : null;
}

function parseAttendance(value: string): RsvpAttendance | null {
  if (!isRsvpAttendance(value)) {
    return null;
  }

  return value;
}

function hasOptionalText(value: string | null) {
  return value !== null;
}

function getFormValues(formData: FormData): RsvpFormValues {
  return {
    allergyNotes: getTextValue(formData.get("allergy_notes")),
    attendance: getTextValue(formData.get("attendance")),
    foodPreference: getTextValue(formData.get("food_preference")),
    includePlusOne: getBooleanValue(formData.get("include_plus_one")),
    phone: getTextValue(formData.get("phone")),
    plusOneAllergyNotes: getTextValue(formData.get("plus_one_allergy_notes")),
    plusOneEmail: getTextValue(formData.get("plus_one_email")),
    plusOneFoodPreference: getTextValue(formData.get("plus_one_food_preference")),
    plusOneName: getTextValue(formData.get("plus_one_name")),
    plusOnePhone: getTextValue(formData.get("plus_one_phone")),
    plusOneSmsOptIn: getBooleanValue(formData.get("plus_one_sms_opt_in")),
    smsOptIn: getBooleanValue(formData.get("sms_opt_in")),
  };
}

function parseRsvpIntent(formData: FormData): RsvpIntent {
  const values = getFormValues(formData);
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

function validateRsvpIntent(intent: RsvpIntent) {
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
    fieldErrors.plus_one_phone = RSVP_ACTION_COPY.validation.plusOneSmsPhoneRequired;
  }

  if (intent.hasPlusOnePayload && !intent.plusOneName) {
    fieldErrors.plus_one_name = RSVP_ACTION_COPY.validation.plusOneNameRequired;
  }

  return fieldErrors;
}

function buildSubmitRsvpResponseArgs(
  intent: RsvpIntent,
  tokenHash: string,
): SubmitRsvpResponseRpcArgs {
  if (!intent.attendance || !intent.phone.isValid || !intent.plusOnePhone.isValid) {
    throw new Error("Cannot build RSVP RPC args from an invalid RSVP intent.");
  }

  return {
    p_allergy_notes: intent.allergyNotes,
    p_attendance: intent.attendance,
    p_extra_guests: intent.hasPlusOnePayload ? 1 : 0,
    p_food_preference: intent.foodPreference,
    p_phone: intent.phone.phone,
    p_plus_one_allergy_notes: intent.hasPlusOnePayload
      ? intent.plusOneAllergyNotes
      : null,
    p_plus_one_email: intent.hasPlusOnePayload ? intent.plusOneEmail : null,
    p_plus_one_food_preference: intent.hasPlusOnePayload
      ? intent.plusOneFoodPreference
      : null,
    p_plus_one_name: intent.hasPlusOnePayload ? intent.plusOneName : null,
    p_plus_one_phone: intent.hasPlusOnePayload ? intent.plusOnePhone.phone : null,
    p_plus_one_sms_opt_in: intent.hasPlusOnePayload
      ? intent.values.plusOneSmsOptIn
      : false,
    p_sms_opt_in: intent.values.smsOptIn,
    p_token_hash: tokenHash,
  };
}

function getRpcErrorState(error: RsvpDatabaseError, values: RsvpFormValues) {
  const message = error.message ?? "";

  if (error.code === "P0002") {
    return buildRsvpErrorState({
      message: RSVP_ACTION_COPY.saveError.invalidInvite,
      values,
    });
  }

  if (error.code === "42501" || message.includes("Plus-one not allowed")) {
    return buildRsvpErrorState({
      message: RSVP_ACTION_COPY.saveError.plusOneNotAllowed,
      values,
    });
  }

  if (message.includes("Plus-one name required")) {
    return buildRsvpErrorState({
      fieldErrors: {
        plus_one_name: RSVP_ACTION_COPY.validation.plusOneNameRequired,
      },
      values,
    });
  }

  if (message.includes("Plus-one SMS consent requires phone")) {
    return buildRsvpErrorState({
      fieldErrors: {
        plus_one_phone: RSVP_ACTION_COPY.validation.plusOneSmsPhoneRequired,
      },
      values,
    });
  }

  if (message.includes("Invalid plus-one phone")) {
    return buildRsvpErrorState({
      fieldErrors: {
        plus_one_phone: RSVP_ACTION_COPY.validation.phoneFormat,
      },
      values,
    });
  }

  if (message.includes("SMS consent requires phone")) {
    return buildRsvpErrorState({
      fieldErrors: {
        phone: RSVP_ACTION_COPY.validation.smsPhoneRequired,
      },
      values,
    });
  }

  if (message.includes("Invalid phone")) {
    return buildRsvpErrorState({
      fieldErrors: {
        phone: RSVP_ACTION_COPY.validation.phoneFormat,
      },
      values,
    });
  }

  return buildRsvpErrorState({
    message: RSVP_ACTION_COPY.saveError.generic,
    values,
  });
}

export async function submitRsvpCommand({
  formData,
  hashToken = hashInviteToken,
  logger = console,
  rawToken,
  rpcAdapter,
}: SubmitRsvpCommandInput): Promise<RsvpActionState> {
  const intent = parseRsvpIntent(formData);
  const fieldErrors = validateRsvpIntent(intent);

  if (Object.keys(fieldErrors).length > 0) {
    return buildRsvpErrorState({ fieldErrors, values: intent.values });
  }

  const { error: submitError } = await rpcAdapter.rpc(
    "submit_rsvp_response",
    buildSubmitRsvpResponseArgs(intent, hashToken(rawToken)),
  );

  if (submitError) {
    logger.error("Failed to submit RSVP response", submitError);
    return getRpcErrorState(submitError, intent.values);
  }

  return buildSubmittedRsvpState();
}
