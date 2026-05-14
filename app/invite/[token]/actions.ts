"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hashInviteToken } from "@/lib/invite-token-crypto";
import { parseOptionalPhone } from "@/lib/phone";
import { isRsvpAttendance, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function parseAttendance(value: FormDataEntryValue | null): RsvpAttendance | null {
  if (typeof value !== "string" || !isRsvpAttendance(value)) {
    return null;
  }

  return value;
}

function parseExtraGuests(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return 0;
  }

  const parsed = Number(text);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function hasOptionalText(value: string | null) {
  return value !== null;
}

function redirectToInvite(rawToken: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  redirect(`/invite/${encodeURIComponent(rawToken)}?${searchParams.toString()}`);
}

export async function submitRsvpAction(rawToken: string, formData: FormData) {
  const attendance = parseAttendance(formData.get("attendance"));
  const extraGuests = parseExtraGuests(formData.get("extra_guests"));
  const phone = parseOptionalPhone(formData.get("phone"));
  const smsOptIn = formData.get("sms_opt_in") === "on";
  const foodPreference = cleanOptionalText(formData.get("food_preference"));
  const allergyNotes = cleanOptionalText(formData.get("allergy_notes"));
  const plusOneName = cleanOptionalText(formData.get("plus_one_name"));
  const plusOneEmail = cleanOptionalText(formData.get("plus_one_email"));
  const plusOnePhone = parseOptionalPhone(formData.get("plus_one_phone"));
  const plusOneFoodPreference = cleanOptionalText(
    formData.get("plus_one_food_preference"),
  );
  const plusOneAllergyNotes = cleanOptionalText(formData.get("plus_one_allergy_notes"));
  const plusOneSmsOptIn = formData.get("plus_one_sms_opt_in") === "on";
  const hasPlusOnePayload = [
    plusOneName,
    plusOneEmail,
    plusOneFoodPreference,
    plusOneAllergyNotes,
  ].some(hasOptionalText) || plusOnePhone.phone !== null || plusOneSmsOptIn;

  if (!attendance) {
    redirectToInvite(rawToken, { rsvp_error: "attendance" });
  }

  if (extraGuests === null) {
    redirectToInvite(rawToken, { rsvp_error: "extra-guests" });
  }

  if (!phone.isValid || (smsOptIn && !phone.phone)) {
    redirectToInvite(rawToken, { rsvp_error: "phone" });
  }

  if (!plusOnePhone.isValid || (plusOneSmsOptIn && !plusOnePhone.phone)) {
    redirectToInvite(rawToken, { rsvp_error: "phone" });
  }

  if (hasPlusOnePayload && !plusOneName) {
    redirectToInvite(rawToken, { rsvp_error: "plus-one-name" });
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashInviteToken(rawToken);
  const { error: submitError } = await supabase.rpc("submit_rsvp_response", {
    p_allergy_notes: allergyNotes,
    p_attendance: attendance,
    p_extra_guests: extraGuests,
    p_food_preference: foodPreference,
    p_phone: phone.phone,
    p_plus_one_allergy_notes: plusOneAllergyNotes,
    p_plus_one_email: plusOneEmail,
    p_plus_one_food_preference: plusOneFoodPreference,
    p_plus_one_name: plusOneName,
    p_plus_one_phone: plusOnePhone.phone,
    p_plus_one_sms_opt_in: plusOneSmsOptIn,
    p_sms_opt_in: smsOptIn,
    p_token_hash: tokenHash,
  });

  if (submitError) {
    console.error("Failed to submit RSVP response", submitError);

    if (submitError.code === "P0002") {
      redirectToInvite(rawToken, { rsvp_error: "invalid" });
    }

    redirectToInvite(rawToken, { rsvp_error: "submit" });
  }

  revalidatePath(`/invite/${rawToken}`);
  revalidatePath("/admin/guests");
  redirectToInvite(rawToken, { rsvp_status: "submitted" });
}
