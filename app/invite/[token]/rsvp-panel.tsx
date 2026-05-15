"use client";

import { useActionState, useState } from "react";

import type { InviteRsvpResponse } from "@/lib/invite-tokens";
import {
  isE164PhoneNumber,
  PHONE_FORMAT_EXAMPLE,
  PHONE_INPUT_PATTERN,
} from "@/lib/phone";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "@/lib/rsvp-attendance";

import { submitRsvpAction, type RsvpActionField, type RsvpActionState } from "./actions";

type InviteGuest = {
  full_name: string;
  phone: string | null;
  plus_one_allowed: boolean;
  sms_opt_in: boolean;
};

type RsvpPanelProps = {
  guest: InviteGuest;
  rawToken: string;
  rsvpResponse: InviteRsvpResponse | null;
  showSubmittedConfirmation: boolean;
  weddingDate: string;
  weddingName: string;
};

const idleActionState: RsvpActionState = {
  fieldErrors: {},
  message: null,
  values: null,
};

const attendanceOptions: Array<{
  description: string;
  label: string;
  value: RsvpAttendance;
}> = [
  { description: "kommer", label: "Ja", value: RSVP_ATTENDANCE.yes },
  { description: "kan inte", label: "Nej", value: RSVP_ATTENDANCE.no },
  { description: "återkommer", label: "Kanske", value: RSVP_ATTENDANCE.maybe },
];

function getGuestFirstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function getAttendanceSummary(attendance: RsvpAttendance) {
  if (attendance === RSVP_ATTENDANCE.yes) {
    return { detail: "jag kommer gärna", label: "Ja" };
  }

  if (attendance === RSVP_ATTENDANCE.no) {
    return { detail: "jag kan tyvärr inte", label: "Nej" };
  }

  return { detail: "jag återkommer", label: "Kanske" };
}

function getInitialAttendance(rsvpResponse: InviteRsvpResponse | null) {
  return rsvpResponse?.attendance ?? RSVP_ATTENDANCE.yes;
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

function getFieldError(
  fieldErrors: RsvpActionState["fieldErrors"],
  field: RsvpActionField,
) {
  return fieldErrors[field] ?? null;
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
  const inputId = `rsvp-${name}`;

  return (
    <label className="grid gap-2" htmlFor={inputId}>
      <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
        {label}
      </span>
      <input
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        autoComplete={autoComplete}
        className={`rounded-[1.15rem] border bg-[#fffaf0] px-4 py-3 text-base text-[#15130f] shadow-inner shadow-[#6f4f33]/5 outline-none transition placeholder:text-[#8a7b68] focus:ring-2 ${
          error
            ? "border-[#b34a2c] focus:border-[#b34a2c] focus:ring-[#b34a2c]/25"
            : "border-[#6f4f33]/20 focus:border-[#6f4f33] focus:ring-[#6f4f33]/20"
        }`}
        defaultValue={defaultValue}
        id={inputId}
        inputMode={inputMode}
        name={name}
        pattern={pattern}
        placeholder={placeholder}
        type={type}
      />
      {error ? (
        <span className="text-sm font-medium text-[#b34a2c]" id={`${inputId}-error`} role="alert">
          — {error}
        </span>
      ) : null}
    </label>
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
  const inputId = `rsvp-${name}`;

  return (
    <label className="grid gap-2" htmlFor={inputId}>
      <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
        {label}
      </span>
      <textarea
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={`min-h-28 rounded-[1.15rem] border bg-[#fffaf0] px-4 py-3 text-base text-[#15130f] shadow-inner shadow-[#6f4f33]/5 outline-none transition placeholder:text-[#8a7b68] focus:ring-2 ${
          error
            ? "border-[#b34a2c] focus:border-[#b34a2c] focus:ring-[#b34a2c]/25"
            : "border-[#6f4f33]/20 focus:border-[#6f4f33] focus:ring-[#6f4f33]/20"
        }`}
        defaultValue={defaultValue}
        id={inputId}
        name={name}
        placeholder={placeholder}
      />
      {error ? (
        <span className="text-sm font-medium text-[#b34a2c]" id={`${inputId}-error`} role="alert">
          — {error}
        </span>
      ) : null}
    </label>
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
    <label className="min-w-0 cursor-pointer">
      <input
        className="peer sr-only"
        defaultChecked={defaultChecked}
        name="attendance"
        required
        type="radio"
        value={value}
      />
      <span className="grid min-w-0 gap-1 rounded-[1.2rem] border border-[#6f4f33]/20 bg-[#fffaf0]/85 px-3 py-3 text-[#3b2b1f] transition peer-checked:border-[#15130f] peer-checked:bg-[#15130f] peer-checked:text-[#fffaf0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#b34a2c]/40 sm:px-4">
        <span className="text-sm font-semibold leading-none sm:text-lg">{label}</span>
        <span className="text-[0.68rem] opacity-75 sm:text-xs">{description}</span>
      </span>
    </label>
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
    <label className="min-w-0 cursor-pointer">
      <input
        checked={checked}
        className="peer sr-only"
        name="include_plus_one"
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span className="grid min-w-0 gap-1 rounded-[1.2rem] border border-[#6f4f33]/20 bg-[#fffaf0]/85 px-3 py-3 text-[#3b2b1f] transition peer-checked:border-[#15130f] peer-checked:bg-[#15130f] peer-checked:text-[#fffaf0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#b34a2c]/40 sm:px-4">
        <span className="text-sm font-semibold leading-none sm:text-lg">{label}</span>
        <span className="text-[0.68rem] opacity-75 sm:text-xs">{description}</span>
      </span>
    </label>
  );
}

function SmsCheckbox({
  defaultChecked,
  label,
  name,
}: {
  defaultChecked: boolean;
  label: string;
  name: "plus_one_sms_opt_in" | "sms_opt_in";
}) {
  return (
    <label className="flex gap-3 rounded-[1.2rem] border border-[#6f4f33]/15 bg-[#fffaf0]/75 px-4 py-3 text-sm font-medium leading-6 text-[#3b2b1f]">
      <input
        className="mt-1 h-4 w-4 rounded border-[#6f4f33]/40 accent-[#15130f]"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function SubmitButton({ hasExistingRsvp, pending }: { hasExistingRsvp: boolean; pending: boolean }) {
  return (
    <button
      className="inline-flex items-center justify-center rounded-full bg-[#15130f] px-5 py-3 text-sm font-semibold text-[#fffaf0] shadow-sm transition hover:bg-[#3b2b1f] disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Skickar…" : hasExistingRsvp ? "Spara ändringar →" : "Skicka mitt svar →"}
    </button>
  );
}

function Confirmation({
  guestName,
  onEdit,
  phone,
  rsvpResponse,
  weddingDate,
  weddingName,
}: {
  guestName: string;
  onEdit: () => void;
  phone: string;
  rsvpResponse: InviteRsvpResponse;
  weddingDate: string;
  weddingName: string;
}) {
  const attendance = getAttendanceSummary(rsvpResponse.attendance);
  const closingLine =
    weddingDate === "Kommer snart" ? "Vi ses på bröllopet." : `Vi ses ${weddingDate}.`;
  const hasPlusOne = rsvpResponse.extra_guests > 0 && rsvpResponse.plus_one_name;

  return (
    <section className="mt-8 rounded-[2rem] bg-[#fffaf0]/85 p-6 text-center shadow-sm ring-1 ring-[#6f4f33]/15 sm:p-8">
      <p className="font-serif text-3xl text-[#6f4f33]">❦</p>
      <h3 className="mt-4 font-serif text-4xl font-semibold tracking-tight text-[#15130f]">
        Tack {getGuestFirstName(guestName)}
      </h3>
      <p className="mx-auto mt-3 max-w-md leading-7 text-[#3b2b1f]">
        Vi har sparat ditt svar. Vi hörs igen med ett par detaljer närmare dagen.
      </p>

      <dl className="mx-auto mt-6 grid max-w-md gap-3 rounded-[1.4rem] bg-[#e6dcc7]/70 p-5 text-left">
        <div className="grid gap-1">
          <dt className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
            Närvaro
          </dt>
          <dd className="text-lg font-semibold text-[#15130f]">
            {attendance.label} <span className="font-normal text-[#6f4f33]">— {attendance.detail}</span>
          </dd>
        </div>
        {phone ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
              Telefon
            </dt>
            <dd className="text-[#15130f]">{phone}</dd>
          </div>
        ) : null}
        {rsvpResponse.food_preference ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
              Mat
            </dt>
            <dd className="text-[#15130f]">{rsvpResponse.food_preference}</dd>
          </div>
        ) : null}
        {hasPlusOne ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
              Gäst
            </dt>
            <dd className="text-[#15130f]">{rsvpResponse.plus_one_name}</dd>
          </div>
        ) : null}
      </dl>

      <button
        className="mt-6 rounded-full border border-[#6f4f33]/40 px-5 py-3 text-sm font-semibold text-[#6f4f33] transition hover:bg-[#e6dcc7]/70"
        onClick={onEdit}
        type="button"
      >
        Uppdatera mitt svar
      </button>
      <p className="mt-6 text-sm text-[#6f4f33]">{closingLine}</p>
      <p className="mt-1 font-serif text-lg text-[#15130f]">{weddingName}</p>
    </section>
  );
}

export function RsvpPanel({
  guest,
  rawToken,
  rsvpResponse,
  showSubmittedConfirmation,
  weddingDate,
  weddingName,
}: RsvpPanelProps) {
  const hasExistingRsvp = Boolean(rsvpResponse);
  const initialAttendance = getInitialAttendance(rsvpResponse);
  const initialPhone = guest.phone ?? "";
  const initialPlusOneSelected = Boolean(
    guest.plus_one_allowed && rsvpResponse?.extra_guests && rsvpResponse.plus_one_name,
  );
  const [plusOneSelected, setPlusOneSelected] = useState(initialPlusOneSelected);
  const [showConfirmation, setShowConfirmation] = useState(
    showSubmittedConfirmation && Boolean(rsvpResponse),
  );
  const [state, formAction, pending] = useActionState(
    submitRsvpAction.bind(null, rawToken),
    idleActionState,
  );
  const fieldErrors = state.fieldErrors;
  const defaultSmsOptIn = getInitialSmsOptIn({
    hasExistingRsvp,
    phone: initialPhone,
    smsOptIn: guest.sms_opt_in,
  });
  const plusOnePhone = rsvpResponse?.plus_one_phone ?? "";
  const defaultPlusOneSmsOptIn = isE164PhoneNumber(plusOnePhone)
    ? Boolean(rsvpResponse?.plus_one_sms_opt_in)
    : false;

  if (showConfirmation && rsvpResponse) {
    return (
      <Confirmation
        guestName={guest.full_name}
        onEdit={() => setShowConfirmation(false)}
        phone={initialPhone}
        rsvpResponse={rsvpResponse}
        weddingDate={weddingDate}
        weddingName={weddingName}
      />
    );
  }

  return (
    <section className="mt-8 rounded-[2rem] bg-[#fffaf0]/85 p-6 shadow-sm ring-1 ring-[#6f4f33]/15 sm:p-8">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.26em] text-[#6f4f33]">
        Sida tre
      </p>
      <h3 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-[#15130f]">
        {hasExistingRsvp ? "Uppdatera svar" : "Låt oss veta"}
      </h3>
      <p className="mt-3 max-w-2xl leading-7 text-[#3b2b1f]">
        {hasExistingRsvp
          ? "Något har ändrats? Du kan uppdatera ditt svar när som helst innan 1 augusti."
          : "Skicka ditt svar och eventuella mat- eller allergiönskemål. Du kan uppdatera senare."}
      </p>

      {state.message ? (
        <div
          aria-live="polite"
          className="mt-6 rounded-[1.4rem] border border-[#b34a2c]/30 bg-[#f8ead8] px-5 py-4 text-[#7c2f1c]"
          role="alert"
        >
          <p className="font-semibold">Kunde inte spara</p>
          <p className="mt-1 text-sm">{state.message}</p>
        </div>
      ) : null}

      <form action={formAction} className="mt-8 grid gap-6" noValidate>
        <fieldset className="grid gap-3">
          <legend className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
            Närvaro
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {attendanceOptions.map((option) => (
              <AttendanceChoice
                defaultChecked={initialAttendance === option.value}
                description={option.description}
                key={option.value}
                label={option.label}
                value={option.value}
              />
            ))}
          </div>
          {getFieldError(fieldErrors, "attendance") ? (
            <p className="text-sm font-medium text-[#b34a2c]" role="alert">
              — {getFieldError(fieldErrors, "attendance")}
            </p>
          ) : null}
        </fieldset>

        <TextField
          autoComplete="tel"
          defaultValue={state.values?.phone ?? initialPhone}
          error={getFieldError(fieldErrors, "phone")}
          inputMode="tel"
          label="Telefon"
          name="phone"
          pattern={PHONE_INPUT_PATTERN}
          placeholder={PHONE_FORMAT_EXAMPLE}
          type="tel"
        />

        <TextField
          defaultValue={state.values?.foodPreference ?? rsvpResponse?.food_preference ?? ""}
          error={getFieldError(fieldErrors, "food_preference")}
          label="Matpreferens"
          name="food_preference"
          placeholder="Vegetariskt, veganskt eller annat"
        />

        <TextAreaField
          defaultValue={state.values?.allergyNotes ?? rsvpResponse?.allergy_notes ?? ""}
          error={getFieldError(fieldErrors, "allergy_notes")}
          label="Allergier & övriga önskemål"
          name="allergy_notes"
          placeholder="Berätta om allergier eller annat vi bör veta."
        />

        <SmsCheckbox
          defaultChecked={state.values?.smsOptIn ?? defaultSmsOptIn}
          label="Skicka mig viktiga SMS-uppdateringar."
          name="sms_opt_in"
        />

        {guest.plus_one_allowed ? (
          <fieldset className="grid gap-3">
            <legend className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#6f4f33]">
              Tar du med en gäst?
            </legend>
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
          <section className="grid gap-4 rounded-[1.6rem] bg-[#e6dcc7]/70 p-5 ring-1 ring-[#6f4f33]/15">
            <h4 className="font-serif text-2xl font-semibold text-[#15130f]">Din gäst</h4>
            <TextField
              autoComplete="name"
              defaultValue={state.values?.plusOneName ?? rsvpResponse?.plus_one_name ?? ""}
              error={getFieldError(fieldErrors, "plus_one_name")}
              label="Namn"
              name="plus_one_name"
              placeholder="För- och efternamn"
            />
            <TextField
              autoComplete="email"
              defaultValue={state.values?.plusOneEmail ?? rsvpResponse?.plus_one_email ?? ""}
              error={getFieldError(fieldErrors, "plus_one_email")}
              inputMode="email"
              label="E-post"
              name="plus_one_email"
              placeholder="namn@example.com"
              type="email"
            />
            <TextField
              autoComplete="tel"
              defaultValue={state.values?.plusOnePhone ?? rsvpResponse?.plus_one_phone ?? ""}
              error={getFieldError(fieldErrors, "plus_one_phone")}
              inputMode="tel"
              label="Telefon"
              name="plus_one_phone"
              pattern={PHONE_INPUT_PATTERN}
              placeholder={PHONE_FORMAT_EXAMPLE}
              type="tel"
            />
            <TextField
              defaultValue={
                state.values?.plusOneFoodPreference ??
                rsvpResponse?.plus_one_food_preference ??
                ""
              }
              error={getFieldError(fieldErrors, "plus_one_food_preference")}
              label="Matpreferens"
              name="plus_one_food_preference"
              placeholder="Veganskt, glutenfritt eller annat"
            />
            <TextAreaField
              defaultValue={
                state.values?.plusOneAllergyNotes ??
                rsvpResponse?.plus_one_allergy_notes ??
                ""
              }
              error={getFieldError(fieldErrors, "plus_one_allergy_notes")}
              label="Allergier & övriga önskemål"
              name="plus_one_allergy_notes"
              placeholder="Allergier eller annat vi bör veta om din gäst."
            />
            <SmsCheckbox
              defaultChecked={state.values?.plusOneSmsOptIn ?? defaultPlusOneSmsOptIn}
              label="Skicka även SMS-uppdateringar till din gäst."
              name="plus_one_sms_opt_in"
            />
          </section>
        ) : null}

        <SubmitButton hasExistingRsvp={hasExistingRsvp} pending={pending} />
      </form>

      <div className="mt-8 text-[#3b2b1f]">
        <p>Vi ser fram emot att fira med dig.</p>
        <p className="mt-1 font-serif text-lg text-[#15130f]">{weddingName}</p>
      </div>
    </section>
  );
}
