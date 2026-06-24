import type { SupabaseClient } from "@supabase/supabase-js";

import { parseOptionalHttpUrl } from "@/lib/safe-url";
import {
  isWeddingSettingsSchemaCompatibilityError,
} from "@/lib/supabase/schema-compat";
import {
  formatStockholmDateTimeLocal,
  parseStockholmDateTimeLocal,
} from "@/lib/stockholm-date-time";
import {
  normalizeTimePlanEntries,
  parseTimePlanText,
  timePlanEntriesToText,
  type WeddingTimePlanEntry,
} from "@/lib/time-plan";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type WeddingSettings = {
  allow_anonymous_hub_upload: boolean;
  child_policy: string | null;
  dress_code: string | null;
  food_and_drink_info: string | null;
  gift_info: string | null;
  google_maps_url: string | null;
  invite_sms_template: string;
  invite_support_email: string | null;
  name: string;
  partner_one_name: string | null;
  partner_two_name: string | null;
  photo_upload_requires_review: boolean;
  policy: string | null;
  spotify_playlist_url: string | null;
  time_plan: WeddingTimePlanEntry[];
  venue_address: string | null;
  venue_area: string | null;
  venue_name: string | null;
  wedding_date: string | null;
 wedding_end_date: string | null;
};

export type InviteWeddingSettings = Omit<
  WeddingSettings,
  "allow_anonymous_hub_upload" | "invite_sms_template" | "photo_upload_requires_review"
>;

export type WeddingSettingsFormValues = Omit<
  WeddingSettings,
  "time_plan" | "wedding_date" | "wedding_end_date"
> & {
  timePlanText: string;
  weddingDateLocal: string;
 weddingEndDateLocal: string;
};

type WeddingSettingsLoadError = { message?: string } | null;

export type LoadWeddingSettingsResult = {
  error: WeddingSettingsLoadError;
  partnerNameFieldsAvailable: boolean;
  settings: WeddingSettings | null;
};

export type WeddingSettingsUpdateStatus =
  | "updated"
  | "missing-name"
  | "invalid-date"
 | "invalid-end-date"
  | "invalid-time-plan"
  | "invalid-google-maps-url"
  | "invalid-spotify-url"
  | "not-found"
  | "update-failed";

const weddingSettingsSelect =
  "name, partner_one_name, partner_two_name, wedding_date, wedding_end_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email, invite_sms_template, allow_anonymous_hub_upload, photo_upload_requires_review";
const legacyWeddingSettingsSelect =
  "name, wedding_date, wedding_end_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email, invite_sms_template, allow_anonymous_hub_upload, photo_upload_requires_review";
const weddingSettingsWithoutEndDateSelect =
  "name, partner_one_name, partner_two_name, wedding_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email, invite_sms_template, allow_anonymous_hub_upload, photo_upload_requires_review";
const legacyWeddingSettingsWithoutEndDateSelect =
  "name, wedding_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email, invite_sms_template, allow_anonymous_hub_upload, photo_upload_requires_review";
const inviteWeddingSettingsSelect =
  "name, partner_one_name, partner_two_name, wedding_date, wedding_end_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email";
const legacyInviteWeddingSettingsSelect =
  "name, wedding_date, wedding_end_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email";
const inviteWeddingSettingsWithoutEndDateSelect =
  "name, partner_one_name, partner_two_name, wedding_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email";
const legacyInviteWeddingSettingsWithoutEndDateSelect =
  "name, wedding_date, venue_name, venue_address, venue_area, google_maps_url, time_plan, policy, dress_code, child_policy, food_and_drink_info, gift_info, spotify_playlist_url, invite_support_email";
const weddingSettingsWithoutFoodAndDrinkInfoSelect = weddingSettingsSelect.replace(
  "food_and_drink_info, ",
  "",
);
const legacyWeddingSettingsWithoutFoodAndDrinkInfoSelect =
  legacyWeddingSettingsSelect.replace("food_and_drink_info, ", "");
const weddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect =
  weddingSettingsWithoutEndDateSelect.replace("food_and_drink_info, ", "");
const legacyWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect =
  legacyWeddingSettingsWithoutEndDateSelect.replace("food_and_drink_info, ", "");
const inviteWeddingSettingsWithoutFoodAndDrinkInfoSelect =
  inviteWeddingSettingsSelect.replace("food_and_drink_info, ", "");
const legacyInviteWeddingSettingsWithoutFoodAndDrinkInfoSelect =
  legacyInviteWeddingSettingsSelect.replace("food_and_drink_info, ", "");
const inviteWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect =
  inviteWeddingSettingsWithoutEndDateSelect.replace("food_and_drink_info, ", "");
const legacyInviteWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect =
  legacyInviteWeddingSettingsWithoutEndDateSelect.replace(
    "food_and_drink_info, ",
    "",
  );

function cleanOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanRequiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function withMissingWeddingSettingsColumns({
  foodAndDrinkInfoFieldAvailable,
  partnerNameFieldsAvailable,
  value,
  weddingEndDateFieldAvailable,
}: {
  foodAndDrinkInfoFieldAvailable: boolean;
  partnerNameFieldsAvailable: boolean;
  value: unknown;
  weddingEndDateFieldAvailable: boolean;
}) {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    ...(partnerNameFieldsAvailable
      ? {}
      : { partner_one_name: null, partner_two_name: null }),
    ...(weddingEndDateFieldAvailable ? {} : { wedding_end_date: null }),
    ...(foodAndDrinkInfoFieldAvailable
      ? {}
      : { food_and_drink_info: null }),
  };
}

function normalizeWeddingSettingsRow(value: unknown): WeddingSettings | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isNullableString(value.partner_one_name) ||
    !isNullableString(value.partner_two_name) ||
    !isNullableString(value.wedding_date) ||
    !isNullableString(value.wedding_end_date) ||
    !isNullableString(value.venue_name) ||
    !isNullableString(value.venue_address) ||
    !isNullableString(value.venue_area) ||
    !isNullableString(value.google_maps_url) ||
    !isNullableString(value.policy) ||
    !isNullableString(value.dress_code) ||
    !isNullableString(value.child_policy) ||
    !isNullableString(value.food_and_drink_info) ||
    !isNullableString(value.gift_info) ||
    !isNullableString(value.spotify_playlist_url) ||
    !isNullableString(value.invite_support_email) ||
    typeof value.invite_sms_template !== "string" ||
    typeof value.allow_anonymous_hub_upload !== "boolean" ||
    typeof value.photo_upload_requires_review !== "boolean"
  ) {
    return null;
  }

  return {
    allow_anonymous_hub_upload: value.allow_anonymous_hub_upload,
    child_policy: value.child_policy,
    dress_code: value.dress_code,
    food_and_drink_info: value.food_and_drink_info,
    gift_info: value.gift_info,
    google_maps_url: value.google_maps_url,
    invite_sms_template: value.invite_sms_template,
    invite_support_email: value.invite_support_email,
    name: value.name,
    partner_one_name: value.partner_one_name,
    partner_two_name: value.partner_two_name,
    photo_upload_requires_review: value.photo_upload_requires_review,
    policy: value.policy,
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: normalizeTimePlanEntries(value.time_plan),
    venue_address: value.venue_address,
    venue_area: value.venue_area,
    venue_name: value.venue_name,
    wedding_date: value.wedding_date,
    wedding_end_date: value.wedding_end_date,
  };
}

function normalizeInviteWeddingSettingsRow(
  value: unknown,
): InviteWeddingSettings | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name ||
    !isNullableString(value.partner_one_name) ||
    !isNullableString(value.partner_two_name) ||
    !isNullableString(value.wedding_date) ||
    !isNullableString(value.wedding_end_date) ||
    !isNullableString(value.venue_name) ||
    !isNullableString(value.venue_address) ||
    !isNullableString(value.venue_area) ||
    !isNullableString(value.google_maps_url) ||
    !isNullableString(value.policy) ||
    !isNullableString(value.dress_code) ||
    !isNullableString(value.child_policy) ||
    !isNullableString(value.food_and_drink_info) ||
    !isNullableString(value.gift_info) ||
    !isNullableString(value.spotify_playlist_url) ||
    !isNullableString(value.invite_support_email)
  ) {
    return null;
  }

  return {
    child_policy: value.child_policy,
    dress_code: value.dress_code,
    food_and_drink_info: value.food_and_drink_info,
    gift_info: value.gift_info,
    google_maps_url: value.google_maps_url,
    invite_support_email: value.invite_support_email,
    name: value.name,
    partner_one_name: value.partner_one_name,
    partner_two_name: value.partner_two_name,
    policy: value.policy,
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: normalizeTimePlanEntries(value.time_plan),
    venue_address: value.venue_address,
    venue_area: value.venue_area,
    venue_name: value.venue_name,
    wedding_date: value.wedding_date,
    wedding_end_date: value.wedding_end_date,
  };
}

type WeddingSettingsSelectOption = {
  foodAndDrinkInfoFieldAvailable: boolean;
  partnerNameFieldsAvailable: boolean;
  select: string;
  weddingEndDateFieldAvailable: boolean;
};

const adminWeddingSettingsSelectOptions: WeddingSettingsSelectOption[] = [
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: true,
    select: weddingSettingsSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: true,
    select: weddingSettingsWithoutFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: false,
    select: legacyWeddingSettingsSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: false,
    select: legacyWeddingSettingsWithoutFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: true,
    select: weddingSettingsWithoutEndDateSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: true,
    select: weddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: false,
    select: legacyWeddingSettingsWithoutEndDateSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: false,
    select: legacyWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: false,
  },
];

const inviteWeddingSettingsSelectOptions: WeddingSettingsSelectOption[] = [
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: true,
    select: inviteWeddingSettingsSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: true,
    select: inviteWeddingSettingsWithoutFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: false,
    select: legacyInviteWeddingSettingsSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: false,
    select: legacyInviteWeddingSettingsWithoutFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: true,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: true,
    select: inviteWeddingSettingsWithoutEndDateSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: true,
    select: inviteWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: true,
    partnerNameFieldsAvailable: false,
    select: legacyInviteWeddingSettingsWithoutEndDateSelect,
    weddingEndDateFieldAvailable: false,
  },
  {
    foodAndDrinkInfoFieldAvailable: false,
    partnerNameFieldsAvailable: false,
    select: legacyInviteWeddingSettingsWithoutEndDateAndFoodAndDrinkInfoSelect,
    weddingEndDateFieldAvailable: false,
  },
];

async function loadWeddingSettingsRow({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<LoadWeddingSettingsResult> {
  for (const option of adminWeddingSettingsSelectOptions) {
    const result = await supabase
      .from("weddings")
      .select(option.select)
      .eq("id", weddingId)
      .maybeSingle();

    if (!isWeddingSettingsSchemaCompatibilityError(result.error)) {
      return {
        error: result.error,
        partnerNameFieldsAvailable: option.partnerNameFieldsAvailable,
        settings: normalizeWeddingSettingsRow(
          withMissingWeddingSettingsColumns({
            foodAndDrinkInfoFieldAvailable:
              option.foodAndDrinkInfoFieldAvailable,
            partnerNameFieldsAvailable: option.partnerNameFieldsAvailable,
            value: result.data,
            weddingEndDateFieldAvailable: option.weddingEndDateFieldAvailable,
          }),
        ),
      };
    }
  }

  return {
    error: { message: "Wedding settings schema compatibility fallback failed." },
    partnerNameFieldsAvailable: false,
    settings: null,
  };
}

async function loadInviteWeddingSettingsRow({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<{
  error: WeddingSettingsLoadError;
  settings: InviteWeddingSettings | null;
}> {
  for (const option of inviteWeddingSettingsSelectOptions) {
    const result = await supabase
      .from("weddings")
      .select(option.select)
      .eq("id", weddingId)
      .maybeSingle();

    if (!isWeddingSettingsSchemaCompatibilityError(result.error)) {
      return {
        error: result.error,
        settings: normalizeInviteWeddingSettingsRow(
          withMissingWeddingSettingsColumns({
            foodAndDrinkInfoFieldAvailable:
              option.foodAndDrinkInfoFieldAvailable,
            partnerNameFieldsAvailable: option.partnerNameFieldsAvailable,
            value: result.data,
            weddingEndDateFieldAvailable: option.weddingEndDateFieldAvailable,
          }),
        ),
      };
    }
  }

  return {
    error: { message: "Invite Wedding settings schema compatibility fallback failed." },
    settings: null,
  };
}

function parseWeddingDate(value: FormDataEntryValue | null) {
  const rawValue = cleanOptionalText(value);

  if (!rawValue) {
    return { status: "ok" as const, value: null };
  }

  const stockholmDateTime = parseStockholmDateTimeLocal(rawValue);

  if (!stockholmDateTime) {
    return { status: "invalid-date" as const };
  }

  return { status: "ok" as const, value: stockholmDateTime };
}

function parseWeddingEndDate({
  endValue,
  startValue,
}: {
  endValue: FormDataEntryValue | null;
  startValue: string | null;
}) {
  const rawValue = cleanOptionalText(endValue);

  if (!rawValue) {
    return { status: "ok" as const, value: null };
  }

  const stockholmDateTime = parseStockholmDateTimeLocal(rawValue);

  if (!stockholmDateTime || !startValue) {
    return { status: "invalid-end-date" as const };
  }

  const startDate = new Date(startValue);
  const endDate = new Date(stockholmDateTime);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate <= startDate
  ) {
    return { status: "invalid-end-date" as const };
  }

  return { status: "ok" as const, value: stockholmDateTime };
}

function parseGuestFacingUrl(
  value: FormDataEntryValue | null,
  invalidStatus: Extract<
    WeddingSettingsUpdateStatus,
    "invalid-google-maps-url" | "invalid-spotify-url"
  >,
) {
  const result = parseOptionalHttpUrl(value);

  if (!result.isValid) {
    return { status: invalidStatus } as const;
  }

  return { status: "ok" as const, value: result.url };
}

function getWeddingSettingsUpdate(formData: FormData) {
  const name = cleanRequiredText(formData.get("name"));

  if (!name) {
    return { status: "missing-name" as const };
  }

  const weddingDate = parseWeddingDate(formData.get("wedding_date"));

  if (weddingDate.status !== "ok") {
    return weddingDate;
  }

  const weddingEndDate = parseWeddingEndDate({
    endValue: formData.get("wedding_end_date"),
    startValue: weddingDate.value,
  });

  if (weddingEndDate.status !== "ok") {
    return weddingEndDate;
  }

  const googleMapsUrl = parseGuestFacingUrl(
    formData.get("google_maps_url"),
    "invalid-google-maps-url",
  );

  if (googleMapsUrl.status !== "ok") {
    return googleMapsUrl;
  }

  const spotifyPlaylistUrl = parseGuestFacingUrl(
    formData.get("spotify_playlist_url"),
    "invalid-spotify-url",
  );

  if (spotifyPlaylistUrl.status !== "ok") {
    return spotifyPlaylistUrl;
  }

  const timePlan = parseTimePlanText(formData.get("time_plan"));

  if (timePlan.status !== "ok") {
    return { status: "invalid-time-plan" as const };
  }

  return {
    partnerNameUpdate: {
      partner_one_name: cleanOptionalText(formData.get("partner_one_name")),
      partner_two_name: cleanOptionalText(formData.get("partner_two_name")),
    },
    status: "ok" as const,
    update: {
      allow_anonymous_hub_upload:
        formData.get("allow_anonymous_hub_upload") === "on",
      child_policy: cleanOptionalText(formData.get("child_policy")),
      dress_code: cleanOptionalText(formData.get("dress_code")),
      food_and_drink_info: cleanOptionalText(
        formData.get("food_and_drink_info"),
      ),
      gift_info: cleanOptionalText(formData.get("gift_info")),
      google_maps_url: googleMapsUrl.value,
      invite_support_email: cleanOptionalText(formData.get("invite_support_email")),
      name,
      photo_upload_requires_review:
        formData.get("photo_upload_requires_review") === "on",
      policy: cleanOptionalText(formData.get("policy")),
      spotify_playlist_url: spotifyPlaylistUrl.value,
      time_plan: timePlan.entries,
      venue_address: cleanOptionalText(formData.get("venue_address")),
      venue_area: cleanOptionalText(formData.get("venue_area")),
      venue_name: cleanOptionalText(formData.get("venue_name")),
      wedding_date: weddingDate.value,
      wedding_end_date: weddingEndDate.value,
    },
  };
}

export async function loadAdminWeddingSettings(input: {
  supabase: SupabaseClient;
  weddingId: string;
}) {
  return loadWeddingSettingsRow(input);
}

export async function loadInviteWeddingSettings(input: {
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<InviteWeddingSettings | null> {
  const result = await loadInviteWeddingSettingsRow(input);

  if (result.error) {
    console.error("Failed to load Invite Wedding settings", result.error);
    return null;
  }

  return result.settings;
}

export function getWeddingSettingsFormValues(
  settings: WeddingSettings,
): WeddingSettingsFormValues {
  return {
    allow_anonymous_hub_upload: settings.allow_anonymous_hub_upload,
    child_policy: settings.child_policy,
    dress_code: settings.dress_code,
    food_and_drink_info: settings.food_and_drink_info,
    gift_info: settings.gift_info,
    google_maps_url: settings.google_maps_url,
    invite_sms_template: settings.invite_sms_template,
    invite_support_email: settings.invite_support_email,
    name: settings.name,
    partner_one_name: settings.partner_one_name,
    partner_two_name: settings.partner_two_name,
    photo_upload_requires_review: settings.photo_upload_requires_review,
    policy: settings.policy,
    spotify_playlist_url: settings.spotify_playlist_url,
    timePlanText: timePlanEntriesToText(settings.time_plan),
    venue_address: settings.venue_address,
    venue_area: settings.venue_area,
    venue_name: settings.venue_name,
    weddingDateLocal: formatStockholmDateTimeLocal(settings.wedding_date),
    weddingEndDateLocal: formatStockholmDateTimeLocal(settings.wedding_end_date),
  };
}

export { getSafeWeddingSettingsUrl } from "@/lib/wedding-settings-display";

export async function updateAdminWeddingSettings({
  formData,
  supabase,
  weddingId,
}: {
  formData: FormData;
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<{ status: WeddingSettingsUpdateStatus }> {
  const parsed = getWeddingSettingsUpdate(formData);

  if (parsed.status !== "ok") {
    return { status: parsed.status };
  }

  const updateWithoutFoodAndDrinkInfo = Object.fromEntries(
    Object.entries(parsed.update).filter(
      ([key]) => key !== "food_and_drink_info",
    ),
  );
  const updateWithoutEndDate = Object.fromEntries(
    Object.entries(parsed.update).filter(([key]) => key !== "wedding_end_date"),
  );
  const updateWithoutEndDateOrFoodAndDrinkInfo = Object.fromEntries(
    Object.entries(parsed.update).filter(
      ([key]) =>
        key !== "wedding_end_date" && key !== "food_and_drink_info",
    ),
  );
  const updateAttempts = [
    { ...parsed.update, ...parsed.partnerNameUpdate },
    parsed.update,
    { ...updateWithoutFoodAndDrinkInfo, ...parsed.partnerNameUpdate },
    updateWithoutFoodAndDrinkInfo,
    { ...updateWithoutEndDate, ...parsed.partnerNameUpdate },
    updateWithoutEndDate,
    {
      ...updateWithoutEndDateOrFoodAndDrinkInfo,
      ...parsed.partnerNameUpdate,
    },
    updateWithoutEndDateOrFoodAndDrinkInfo,
  ];

  let data: { id: string } | null = null;
  let error: WeddingSettingsLoadError = null;

  for (const update of updateAttempts) {
    const result = await supabase
      .from("weddings")
      .update(update)
      .eq("id", weddingId)
      .select("id")
      .maybeSingle();

    data = result.data;
    error = result.error;

    if (!isWeddingSettingsSchemaCompatibilityError(error)) {
      break;
    }
  }

  if (error) {
    console.error("Failed to update Wedding settings", error);
    return { status: "update-failed" };
  }

  if (!data) {
    return { status: "not-found" };
  }

  return { status: "updated" };
}
