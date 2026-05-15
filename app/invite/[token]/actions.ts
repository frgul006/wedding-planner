"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hashInviteToken } from "@/lib/invite-token-crypto";
import { PHONE_FORMAT_EXAMPLE, parseOptionalPhone } from "@/lib/phone";
import { isRsvpAttendance, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

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

export type RsvpActionField =
  | "allergy_notes"
  | "attendance"
  | "food_preference"
  | "phone"
  | "plus_one_allergy_notes"
  | "plus_one_email"
  | "plus_one_food_preference"
  | "plus_one_name"
  | "plus_one_phone";

export type RsvpActionState = {
  fieldErrors: Partial<Record<RsvpActionField, string>>;
  message: string | null;
  values: RsvpFormValues | null;
};

const compactPhoneMessage = `Använd internationellt format utan mellanslag, t.ex. ${PHONE_FORMAT_EXAMPLE}.`;

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function getTextValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getBooleanValue(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function parseAttendance(value: FormDataEntryValue | null): RsvpAttendance | null {
  if (typeof value !== "string" || !isRsvpAttendance(value)) {
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

function buildErrorState({
  fieldErrors = {},
  message = null,
  values,
}: {
  fieldErrors?: Partial<Record<RsvpActionField, string>>;
  message?: string | null;
  values: RsvpFormValues;
}): RsvpActionState {
  return {
    fieldErrors,
    message,
    values,
  };
}

function redirectToInvite(rawToken: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  const query = queryString ? `?${queryString}` : "";

  redirect(`/invite/${encodeURIComponent(rawToken)}${query}#osa`);
}

function getRpcErrorState(error: { code?: string; message?: string }, values: RsvpFormValues) {
  const message = error.message ?? "";

  if (error.code === "P0002") {
    return buildErrorState({
      message: "Inbjudningslänken kunde inte verifieras. Be om en ny länk och försök igen.",
      values,
    });
  }

  if (error.code === "42501" || message.includes("Plus-one not allowed")) {
    return buildErrorState({
      message: "Du kan inte lägga till en +1 på den här inbjudan.",
      values,
    });
  }

  if (message.includes("Plus-one name required")) {
    return buildErrorState({
      fieldErrors: {
        plus_one_name: "Skriv namnet på din gäst innan du sparar.",
      },
      values,
    });
  }

  if (message.includes("Invalid plus-one phone")) {
    return buildErrorState({
      fieldErrors: {
        plus_one_phone: compactPhoneMessage,
      },
      values,
    });
  }

  if (message.includes("Invalid phone")) {
    return buildErrorState({
      fieldErrors: {
        phone: compactPhoneMessage,
      },
      values,
    });
  }

  return buildErrorState({
    message: "Försök igen om en stund.",
    values,
  });
}

export async function submitRsvpAction(
  rawToken: string,
  _previousState: RsvpActionState,
  formData: FormData,
): Promise<RsvpActionState> {
  const values = getFormValues(formData);
  const attendance = parseAttendance(formData.get("attendance"));
  const phone = parseOptionalPhone(formData.get("phone"));
  const plusOnePhone = parseOptionalPhone(formData.get("plus_one_phone"));
  const foodPreference = cleanOptionalText(formData.get("food_preference"));
  const allergyNotes = cleanOptionalText(formData.get("allergy_notes"));
  const plusOneName = cleanOptionalText(formData.get("plus_one_name"));
  const plusOneEmail = cleanOptionalText(formData.get("plus_one_email"));
  const plusOneFoodPreference = cleanOptionalText(
    formData.get("plus_one_food_preference"),
  );
  const plusOneAllergyNotes = cleanOptionalText(formData.get("plus_one_allergy_notes"));
  const hasPlusOnePayload =
    values.includePlusOne ||
    [plusOneName, plusOneEmail, plusOneFoodPreference, plusOneAllergyNotes].some(
      hasOptionalText,
    ) ||
    plusOnePhone.phone !== null ||
    values.plusOneSmsOptIn;
  const fieldErrors: Partial<Record<RsvpActionField, string>> = {};

  if (!attendance) {
    fieldErrors.attendance = "Välj Ja, Nej eller Kanske innan du sparar.";
  }

  if (!phone.isValid) {
    fieldErrors.phone = compactPhoneMessage;
  } else if (values.smsOptIn && !phone.phone) {
    fieldErrors.phone = "Lägg till ett telefonnummer om du vill få SMS-uppdateringar.";
  }

  if (!plusOnePhone.isValid) {
    fieldErrors.plus_one_phone = compactPhoneMessage;
  } else if (values.plusOneSmsOptIn && !plusOnePhone.phone) {
    fieldErrors.plus_one_phone =
      "Lägg till din gästs telefonnummer om hen ska få SMS-uppdateringar.";
  }

  if (hasPlusOnePayload && !plusOneName) {
    fieldErrors.plus_one_name = "Skriv namnet på din gäst innan du sparar.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return buildErrorState({ fieldErrors, values });
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashInviteToken(rawToken);
  const { error: submitError } = await supabase.rpc("submit_rsvp_response", {
    p_allergy_notes: allergyNotes,
    p_attendance: attendance,
    p_extra_guests: hasPlusOnePayload ? 1 : 0,
    p_food_preference: foodPreference,
    p_phone: phone.phone,
    p_plus_one_allergy_notes: hasPlusOnePayload ? plusOneAllergyNotes : null,
    p_plus_one_email: hasPlusOnePayload ? plusOneEmail : null,
    p_plus_one_food_preference: hasPlusOnePayload ? plusOneFoodPreference : null,
    p_plus_one_name: hasPlusOnePayload ? plusOneName : null,
    p_plus_one_phone: hasPlusOnePayload ? plusOnePhone.phone : null,
    p_plus_one_sms_opt_in: hasPlusOnePayload ? values.plusOneSmsOptIn : false,
    p_sms_opt_in: values.smsOptIn,
    p_token_hash: tokenHash,
  });

  if (submitError) {
    console.error("Failed to submit RSVP response", submitError);
    return getRpcErrorState(submitError, values);
  }

  revalidatePath(`/invite/${rawToken}`);
  revalidatePath("/admin/guests");
  redirectToInvite(rawToken, { rsvp_status: "submitted" });
}
