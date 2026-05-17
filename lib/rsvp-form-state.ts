import { PHONE_FORMAT_EXAMPLE } from "./phone";

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
  status: "error" | "idle" | "submitted";
  values: RsvpFormValues | null;
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

export const idleRsvpActionState: RsvpActionState = {
  fieldErrors: {},
  message: null,
  status: "idle",
  values: null,
};

export function buildRsvpErrorState({
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
    status: "error",
    values,
  };
}

export function buildSubmittedRsvpState(): RsvpActionState {
  return {
    fieldErrors: {},
    message: null,
    status: "submitted",
    values: null,
  };
}
