import type { RsvpActionField, RsvpFormValues } from "./rsvp-form-contract";

export {
  RSVP_ACTION_COPY,
  RSVP_FORM_FIELDS,
  type RsvpActionField,
  type RsvpFormValues,
} from "./rsvp-form-contract";

export type RsvpActionState = {
  fieldErrors: Partial<Record<RsvpActionField, string>>;
  message: string | null;
  status: "error" | "idle" | "submitted";
  values: RsvpFormValues | null;
};

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
