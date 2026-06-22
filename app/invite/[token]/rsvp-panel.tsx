"use client";

import { useActionState, useEffect, useState } from "react";

import type { InviteRsvpResponse } from "@/lib/invite-access";
import { CALENDAR_ACTION_LABEL } from "@/lib/invite-calendar";
import {
  getInviteRsvpEditHrefFromLocation,
  getInviteRsvpSubmittedHref,
} from "@/lib/invite-rsvp-navigation";
import { PHONE_FORMAT_EXAMPLE, PHONE_INPUT_PATTERN } from "@/lib/phone";
import type { RsvpAttendance } from "@/lib/rsvp-attendance";
import {
  getInitialRsvpFormModel,
  getRsvpAttendanceSummary,
  RSVP_ATTENDANCE_OPTIONS,
  RSVP_FORM_FIELDS,
  type RsvpSmsOptInField,
} from "@/lib/rsvp-form-contract";
import {
  idleRsvpActionState,
  type RsvpActionField,
  type RsvpActionState,
} from "@/lib/rsvp-form-state";

import {
  BrevkortBodyText,
  BrevkortButton,
  BrevkortCard,
  BrevkortCheckbox,
  BrevkortChoiceCard,
  BrevkortErrorText,
  BrevkortHeading,
  BrevkortLegend,
  BrevkortLinkButton,
  BrevkortStatusStrip,
  BrevkortTextInput,
  BrevkortTextarea,
} from "../_components/brevkort-primitives";
import { submitRsvpAction } from "./actions";

type InviteGuest = {
  full_name: string;
  phone: string | null;
  plus_one_allowed: boolean;
  sms_opt_in: boolean;
};

type RsvpPanelProps = {
  calendarHref: string | null;
  guest: InviteGuest;
  rawToken: string;
  rsvpResponse: InviteRsvpResponse | null;
  showSubmittedConfirmation: boolean;
  weddingDate: string;
  weddingName: string;
};

function getGuestFirstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function getFieldError(
  fieldErrors: RsvpActionState["fieldErrors"],
  field: RsvpActionField,
) {
  return fieldErrors[field] ?? null;
}

function clearSubmittedRsvpMarker() {
  window.history.replaceState(
    window.history.state,
    "",
    getInviteRsvpEditHrefFromLocation(window.location),
  );
}

function TextField({
  autoComplete,
  defaultValue,
  error,
  inputMode,
  label,
  name,
  pattern,
  placeholder,
  type = "text",
}: {
  autoComplete?: string;
  defaultValue?: string;
  error?: string | null;
  inputMode?: "email" | "tel" | "text";
  label: string;
  name: RsvpActionField;
  pattern?: string;
  placeholder?: string;
  type?: "email" | "tel" | "text";
}) {
  return (
    <BrevkortTextInput
      autoComplete={autoComplete}
      defaultValue={defaultValue}
      error={error}
      id={`rsvp-${name}`}
      inputMode={inputMode}
      label={label}
      name={name}
      pattern={pattern}
      placeholder={placeholder}
      type={type}
    />
  );
}

function TextAreaField({
  defaultValue,
  error,
  label,
  name,
  placeholder,
}: {
  defaultValue?: string;
  error?: string | null;
  label: string;
  name: RsvpActionField;
  placeholder: string;
}) {
  return (
    <BrevkortTextarea
      defaultValue={defaultValue}
      error={error}
      id={`rsvp-${name}`}
      label={label}
      name={name}
      placeholder={placeholder}
    />
  );
}

function AttendanceChoice({
  defaultChecked,
  description,
  label,
  value,
}: {
  defaultChecked: boolean;
  description: string;
  label: string;
  value: RsvpAttendance;
}) {
  return (
    <BrevkortChoiceCard
      defaultChecked={defaultChecked}
      description={description}
      label={label}
      name={RSVP_FORM_FIELDS.attendance}
      required
      value={value}
    />
  );
}

function PlusOneChoice({
  checked,
  description,
  label,
  onChange,
  value,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
  value: "false" | "true";
}) {
  return (
    <BrevkortChoiceCard
      checked={checked}
      description={description}
      label={label}
      name={RSVP_FORM_FIELDS.includePlusOne}
      onChange={() => onChange()}
      value={value}
    />
  );
}

function SmsCheckbox({
  defaultChecked,
  label,
  name,
}: {
  defaultChecked: boolean;
  label: string;
  name: RsvpSmsOptInField;
}) {
  return (
    <BrevkortCheckbox defaultChecked={defaultChecked} name={name}>
      {label}
    </BrevkortCheckbox>
  );
}

function SubmitButton({
  hasExistingRsvp,
  pending,
}: {
  hasExistingRsvp: boolean;
  pending: boolean;
}) {
  return (
    <BrevkortButton className="w-full" disabled={pending} tone="rust" type="submit">
      {pending
        ? "Skickar…"
        : hasExistingRsvp
          ? "Spara ändringar →"
          : "Skicka mitt svar →"}
    </BrevkortButton>
  );
}

function Confirmation({
  calendarHref,
  guestName,
  onEdit,
  phone,
  rsvpResponse,
  weddingDate,
  weddingName,
}: {
  calendarHref: string | null;
  guestName: string;
  onEdit: () => void;
  phone: string;
  rsvpResponse: InviteRsvpResponse;
  weddingDate: string;
  weddingName: string;
}) {
  const attendance = getRsvpAttendanceSummary(rsvpResponse.attendance);
  const closingLine =
    weddingDate === "Kommer snart" ? "Vi ses på bröllopet." : `Vi ses ${weddingDate}.`;
  const hasPlusOne = rsvpResponse.extra_guests > 0 && rsvpResponse.plus_one_name;

  return (
    <BrevkortCard className="bg-invite-paper-light p-6 text-center sm:p-8">
      <p className="brevkort-display text-4xl text-invite-walnut">❦</p>
      <BrevkortHeading className="mt-4 text-4xl" id="osa-heading" level={3}>
        Tack {getGuestFirstName(guestName)}
      </BrevkortHeading>
      <BrevkortBodyText className="mx-auto mt-3 max-w-md">
        Vi har sparat ditt svar. Vi hörs igen med ett par detaljer närmare dagen.
      </BrevkortBodyText>

      <dl className="mx-auto mt-6 grid max-w-md gap-3 bg-invite-paper-muted/80 p-5 text-left">
        <div className="grid gap-1">
          <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
            Närvaro
          </dt>
          <dd className="text-lg font-semibold text-invite-ink">
            {attendance.label}{" "}
            <span className="font-normal text-invite-walnut">
              — {attendance.detail}
            </span>
          </dd>
        </div>
        {phone ? (
          <div className="grid gap-1">
            <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
              Telefon
            </dt>
            <dd className="text-invite-ink">{phone}</dd>
          </div>
        ) : null}
        {rsvpResponse.food_preference ? (
          <div className="grid gap-1">
            <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
              Mat
            </dt>
            <dd className="text-invite-ink">{rsvpResponse.food_preference}</dd>
          </div>
        ) : null}
        {hasPlusOne ? (
          <div className="grid gap-1">
            <dt className="brevkort-metadata text-[0.68rem] font-semibold text-invite-walnut">
              Gäst
            </dt>
            <dd className="text-invite-ink">{rsvpResponse.plus_one_name}</dd>
          </div>
        ) : null}
      </dl>

      {calendarHref ? (
        <BrevkortLinkButton className="mt-6 w-full" download href={calendarHref} tone="rust">
          {CALENDAR_ACTION_LABEL}
        </BrevkortLinkButton>
      ) : null}
      <BrevkortButton
        className={calendarHref ? "mt-3" : "mt-6"}
        onClick={onEdit}
        tone="outline"
        type="button"
      >
        Uppdatera mitt svar
      </BrevkortButton>
      <p className="mt-6 text-sm text-invite-walnut">{closingLine}</p>
      <p className="brevkort-display mt-1 text-lg text-invite-ink">{weddingName}</p>
    </BrevkortCard>
  );
}

export function RsvpPanel({
  calendarHref,
  guest,
  rawToken,
  rsvpResponse,
  showSubmittedConfirmation,
  weddingDate,
  weddingName,
}: RsvpPanelProps) {
  const hasExistingRsvp = Boolean(rsvpResponse);
  const initialModel = getInitialRsvpFormModel({ guest, rsvpResponse });
  const [plusOneSelected, setPlusOneSelected] = useState(
    initialModel.includePlusOne,
  );
  const [showConfirmation, setShowConfirmation] = useState(
    showSubmittedConfirmation && Boolean(rsvpResponse),
  );
  const [state, formAction, pending] = useActionState(
    submitRsvpAction.bind(null, rawToken),
    idleRsvpActionState,
  );
  const fieldErrors = state.fieldErrors;

  useEffect(() => {
    // Complete successful client actions even after hash-only panel navigation.
    if (state.status !== "submitted") {
      return;
    }

    window.location.assign(getInviteRsvpSubmittedHref(rawToken));
  }, [rawToken, state.status]);

  if (showConfirmation && rsvpResponse) {
    return (
      <Confirmation
        calendarHref={calendarHref}
        guestName={guest.full_name}
        onEdit={() => {
          clearSubmittedRsvpMarker();
          setShowConfirmation(false);
        }}
        phone={initialModel.phone}
        rsvpResponse={rsvpResponse}
        weddingDate={weddingDate}
        weddingName={weddingName}
      />
    );
  }

  return (
    <BrevkortCard className="bg-invite-paper-light p-6 sm:p-8">
      <BrevkortHeading className="text-4xl" id="osa-heading" level={3}>
        {hasExistingRsvp ? "Uppdatera svar" : "Låt oss veta"}
      </BrevkortHeading>
      <BrevkortBodyText className="mt-3 max-w-2xl">
        {hasExistingRsvp
          ? "Något har ändrats? Du kan uppdatera ditt svar när som helst innan 1 augusti."
          : "Skicka ditt svar och eventuella mat- eller allergiönskemål. Du kan uppdatera senare."}
      </BrevkortBodyText>

      {state.message ? (
        <BrevkortStatusStrip aria-live="polite" className="mt-6" role="alert" tone="warning">
          <p className="font-semibold">Kunde inte spara</p>
          <p className="mt-1 text-sm">{state.message}</p>
        </BrevkortStatusStrip>
      ) : null}

      <form action={formAction} className="mt-8 grid gap-6" noValidate>
        <fieldset className="grid gap-3">
          <BrevkortLegend>Närvaro</BrevkortLegend>
          <div className="grid grid-cols-3 gap-2">
            {RSVP_ATTENDANCE_OPTIONS.map((option) => (
              <AttendanceChoice
                defaultChecked={initialModel.attendance === option.value}
                description={option.description}
                key={option.value}
                label={option.label}
                value={option.value}
              />
            ))}
          </div>
          {getFieldError(fieldErrors, RSVP_FORM_FIELDS.attendance) ? (
            <BrevkortErrorText>
              — {getFieldError(fieldErrors, RSVP_FORM_FIELDS.attendance)}
            </BrevkortErrorText>
          ) : null}
        </fieldset>

        <TextField
          autoComplete="tel"
          defaultValue={state.values?.phone ?? initialModel.phone}
          error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.phone)}
          inputMode="tel"
          label="Telefon"
          name={RSVP_FORM_FIELDS.phone}
          pattern={PHONE_INPUT_PATTERN}
          placeholder={PHONE_FORMAT_EXAMPLE}
          type="tel"
        />

        <TextField
          defaultValue={state.values?.foodPreference ?? initialModel.foodPreference}
          error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.foodPreference)}
          label="Matpreferens"
          name={RSVP_FORM_FIELDS.foodPreference}
          placeholder="Vegetariskt, veganskt eller annat"
        />

        <TextAreaField
          defaultValue={state.values?.allergyNotes ?? initialModel.allergyNotes}
          error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.allergyNotes)}
          label="Allergier & övriga önskemål"
          name={RSVP_FORM_FIELDS.allergyNotes}
          placeholder="Berätta om allergier eller annat vi bör veta."
        />

        <SmsCheckbox
          defaultChecked={state.values?.smsOptIn ?? initialModel.smsOptIn}
          label="Skicka mig viktiga SMS-uppdateringar."
          name={RSVP_FORM_FIELDS.smsOptIn}
        />

        {guest.plus_one_allowed ? (
          <fieldset className="grid gap-3">
            <BrevkortLegend>Tar du med en gäst?</BrevkortLegend>
            <div className="grid grid-cols-2 gap-2">
              <PlusOneChoice
                checked={!plusOneSelected}
                description="bara jag"
                label="Nej"
                onChange={() => setPlusOneSelected(false)}
                value="false"
              />
              <PlusOneChoice
                checked={plusOneSelected}
                description="+1 gäst"
                label="Ja"
                onChange={() => setPlusOneSelected(true)}
                value="true"
              />
            </div>
          </fieldset>
        ) : null}

        {guest.plus_one_allowed && plusOneSelected ? (
          <BrevkortCard className="grid gap-4 bg-invite-paper-muted/70 p-5">
            <BrevkortHeading className="text-2xl" level={4}>
              Din gäst
            </BrevkortHeading>
            <TextField
              autoComplete="name"
              defaultValue={state.values?.plusOneName ?? initialModel.plusOneName}
              error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.plusOneName)}
              label="Namn"
              name={RSVP_FORM_FIELDS.plusOneName}
              placeholder="För- och efternamn"
            />
            <TextField
              autoComplete="email"
              defaultValue={state.values?.plusOneEmail ?? initialModel.plusOneEmail}
              error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.plusOneEmail)}
              inputMode="email"
              label="E-post"
              name={RSVP_FORM_FIELDS.plusOneEmail}
              placeholder="namn@example.com"
              type="email"
            />
            <TextField
              autoComplete="tel"
              defaultValue={state.values?.plusOnePhone ?? initialModel.plusOnePhone}
              error={getFieldError(fieldErrors, RSVP_FORM_FIELDS.plusOnePhone)}
              inputMode="tel"
              label="Telefon"
              name={RSVP_FORM_FIELDS.plusOnePhone}
              pattern={PHONE_INPUT_PATTERN}
              placeholder={PHONE_FORMAT_EXAMPLE}
              type="tel"
            />
            <TextField
              defaultValue={
                state.values?.plusOneFoodPreference ??
                initialModel.plusOneFoodPreference
              }
              error={getFieldError(
                fieldErrors,
                RSVP_FORM_FIELDS.plusOneFoodPreference,
              )}
              label="Matpreferens"
              name={RSVP_FORM_FIELDS.plusOneFoodPreference}
              placeholder="Veganskt, glutenfritt eller annat"
            />
            <TextAreaField
              defaultValue={
                state.values?.plusOneAllergyNotes ??
                initialModel.plusOneAllergyNotes
              }
              error={getFieldError(
                fieldErrors,
                RSVP_FORM_FIELDS.plusOneAllergyNotes,
              )}
              label="Allergier & övriga önskemål"
              name={RSVP_FORM_FIELDS.plusOneAllergyNotes}
              placeholder="Allergier eller annat vi bör veta om din gäst."
            />
            <SmsCheckbox
              defaultChecked={
                state.values?.plusOneSmsOptIn ?? initialModel.plusOneSmsOptIn
              }
              label="Skicka även SMS-uppdateringar till din gäst."
              name={RSVP_FORM_FIELDS.plusOneSmsOptIn}
            />
          </BrevkortCard>
        ) : null}

        <SubmitButton hasExistingRsvp={hasExistingRsvp} pending={pending} />
      </form>

      <div className="mt-8 text-invite-body">
        <p>Vi ser fram emot att fira med dig.</p>
        <p className="brevkort-display mt-1 text-lg text-invite-ink">{weddingName}</p>
      </div>
    </BrevkortCard>
  );
}
