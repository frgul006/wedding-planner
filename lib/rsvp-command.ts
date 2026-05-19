import { hashInviteToken } from "./invite-token-crypto";
import type { RsvpAttendance } from "./rsvp-attendance";
import {
  parseRsvpFormData,
  RSVP_ACTION_COPY,
  validateRsvpIntent,
  type RsvpFormValues,
  type RsvpIntent,
} from "./rsvp-form-contract";
import {
  buildRsvpErrorState,
  buildSubmittedRsvpState,
  type RsvpActionState,
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
  const intent = parseRsvpFormData(formData);
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
