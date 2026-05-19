import { expect, test } from "@playwright/test";

import {
  getInitialRsvpFormModel,
  getRsvpAttendanceSummary,
  parseRsvpFormData,
  RSVP_ACTION_COPY,
  RSVP_FORM_FIELDS,
  type RsvpFormFieldName,
  type RsvpFormResponse,
  validateRsvpIntent,
} from "../lib/rsvp-form-contract";
import { RSVP_ATTENDANCE } from "../lib/rsvp-attendance";

function createFormData(
  fields: Partial<Record<RsvpFormFieldName, boolean | string | null | undefined>>,
) {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }

    formData.set(name, value === true ? "on" : value);
  }

  return formData;
}

const fullRsvpResponse = {
  allergy_notes: "No hazelnuts",
  attendance: RSVP_ATTENDANCE.maybe,
  extra_guests: 1,
  food_preference: "Vegetarian",
  plus_one_allergy_notes: "No almonds",
  plus_one_email: "guest@example.com",
  plus_one_food_preference: "Fish",
  plus_one_name: "Guest Friend",
  plus_one_phone: "+46701112233",
  plus_one_sms_opt_in: true,
} satisfies RsvpFormResponse;

test.describe("RSVP form contract", () => {
  test("parses the browser form field Interface into a normalized RSVP intent", () => {
    const intent = parseRsvpFormData(createFormData({
      [RSVP_FORM_FIELDS.allergyNotes]: " Peanuts ",
      [RSVP_FORM_FIELDS.attendance]: RSVP_ATTENDANCE.yes,
      [RSVP_FORM_FIELDS.foodPreference]: " Vegan ",
      [RSVP_FORM_FIELDS.includePlusOne]: true,
      [RSVP_FORM_FIELDS.phone]: " +46701234567 ",
      [RSVP_FORM_FIELDS.plusOneName]: " Guest Friend ",
      [RSVP_FORM_FIELDS.plusOnePhone]: " +46701112233 ",
      [RSVP_FORM_FIELDS.plusOneSmsOptIn]: true,
      [RSVP_FORM_FIELDS.smsOptIn]: true,
    }));

    expect(intent).toMatchObject({
      allergyNotes: "Peanuts",
      attendance: RSVP_ATTENDANCE.yes,
      foodPreference: "Vegan",
      hasPlusOnePayload: true,
      phone: { isValid: true, phone: "+46701234567" },
      plusOneName: "Guest Friend",
      plusOnePhone: { isValid: true, phone: "+46701112233" },
      values: {
        allergyNotes: "Peanuts",
        includePlusOne: true,
        phone: "+46701234567",
        plusOneSmsOptIn: true,
        smsOptIn: true,
      },
    });
  });

  test("validates SMS and Plus-one Guest invariants at the form Interface", () => {
    const intent = parseRsvpFormData(createFormData({
      [RSVP_FORM_FIELDS.attendance]: RSVP_ATTENDANCE.yes,
      [RSVP_FORM_FIELDS.includePlusOne]: true,
      [RSVP_FORM_FIELDS.plusOneSmsOptIn]: true,
      [RSVP_FORM_FIELDS.smsOptIn]: true,
    }));

    expect(validateRsvpIntent(intent)).toEqual({
      phone: RSVP_ACTION_COPY.validation.smsPhoneRequired,
      plus_one_name: RSVP_ACTION_COPY.validation.plusOneNameRequired,
      plus_one_phone: RSVP_ACTION_COPY.validation.plusOneSmsPhoneRequired,
    });
  });

  test("builds initial form model from Guest and saved RSVP state", () => {
    expect(getInitialRsvpFormModel({
      guest: {
        phone: "+46701234567",
        plus_one_allowed: true,
        sms_opt_in: false,
      },
      rsvpResponse: fullRsvpResponse,
    })).toEqual({
      allergyNotes: "No hazelnuts",
      attendance: RSVP_ATTENDANCE.maybe,
      foodPreference: "Vegetarian",
      includePlusOne: true,
      phone: "+46701234567",
      plusOneAllergyNotes: "No almonds",
      plusOneEmail: "guest@example.com",
      plusOneFoodPreference: "Fish",
      plusOneName: "Guest Friend",
      plusOnePhone: "+46701112233",
      plusOneSmsOptIn: true,
      smsOptIn: false,
    });
  });

  test("defaults first-time SMS opt-in only when phone is valid", () => {
    expect(getInitialRsvpFormModel({
      guest: {
        phone: "+46701234567",
        plus_one_allowed: false,
        sms_opt_in: false,
      },
      rsvpResponse: null,
    }).smsOptIn).toBe(true);

    expect(getInitialRsvpFormModel({
      guest: {
        phone: null,
        plus_one_allowed: false,
        sms_opt_in: true,
      },
      rsvpResponse: null,
    }).smsOptIn).toBe(false);
  });

  test("shares attendance presentation across Invite RSVP surfaces", () => {
    expect(getRsvpAttendanceSummary(RSVP_ATTENDANCE.no)).toEqual({
      detail: "jag kan tyvärr inte",
      label: "Nej",
    });
  });
});
