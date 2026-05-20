import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingPartnerNameColumnError } from "@/lib/supabase/schema-compat";
import { isNullableString, isRecord } from "@/lib/type-guards";
import { getInviteSupportDisplayName } from "@/lib/wedding-settings-display";

type InviteSupportWeddingRow = {
  invite_support_email: string | null;
  partner_one_name: string | null;
  partner_two_name: string | null;
};

export type InviteSupportContact = {
  displayName: string | null;
  email: string;
};

const inviteSupportContactSelect =
  "invite_support_email, partner_one_name, partner_two_name";
const legacyInviteSupportContactSelect = "invite_support_email";

function getConfiguredWeddingId() {
  return process.env.WEDDING_ID ?? process.env.NEXT_PUBLIC_WEDDING_ID ?? null;
}

function cleanText(value: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function cleanSupportEmail(value: string | null) {
  const email = cleanText(value);

  if (!email || !email.includes("@") || /[\s<>?&#]/.test(email)) {
    return null;
  }

  return email;
}

function normalizeInviteSupportWedding(value: unknown): InviteSupportWeddingRow | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.invite_support_email) ||
    !isNullableString(value.partner_one_name) ||
    !isNullableString(value.partner_two_name)
  ) {
    return null;
  }

  return {
    invite_support_email: value.invite_support_email,
    partner_one_name: value.partner_one_name,
    partner_two_name: value.partner_two_name,
  };
}

function withMissingPartnerNameColumns(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    partner_one_name: null,
    partner_two_name: null,
  };
}

async function getInviteSupportWeddingById({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}) {
  const result = await supabase
    .from("weddings")
    .select(inviteSupportContactSelect)
    .eq("id", weddingId)
    .maybeSingle();
  let data: unknown = result.data;
  let error = result.error;

  if (isMissingPartnerNameColumnError(error)) {
    const fallbackResult = await supabase
      .from("weddings")
      .select(legacyInviteSupportContactSelect)
      .eq("id", weddingId)
      .maybeSingle();

    data = withMissingPartnerNameColumns(fallbackResult.data);
    error = fallbackResult.error;
  }

  if (error) {
    console.error("Failed to load configured invite support contact", error);
    return null;
  }

  return normalizeInviteSupportWedding(data);
}

async function getSingleInviteSupportWedding({
  supabase,
}: {
  supabase: SupabaseClient;
}) {
  const result = await supabase
    .from("weddings")
    .select(inviteSupportContactSelect)
    .order("created_at", { ascending: true })
    .limit(2);
  let data: unknown = result.data;
  let error = result.error;

  if (isMissingPartnerNameColumnError(error)) {
    const fallbackResult = await supabase
      .from("weddings")
      .select(legacyInviteSupportContactSelect)
      .order("created_at", { ascending: true })
      .limit(2);

    data = Array.isArray(fallbackResult.data)
      ? fallbackResult.data.map(withMissingPartnerNameColumns)
      : fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    console.error("Failed to load default invite support contact", error);
    return null;
  }

  if (!Array.isArray(data) || data.length !== 1) {
    if (Array.isArray(data) && data.length > 1) {
      console.error(
        "Multiple weddings found for invalid invite support contact. Set WEDDING_ID to choose the public fallback contact.",
      );
    }

    return null;
  }

  return normalizeInviteSupportWedding(data[0]);
}

export async function getInviteSupportContact(
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<InviteSupportContact | null> {
  const configuredWeddingId = getConfiguredWeddingId();
  const wedding = configuredWeddingId
    ? await getInviteSupportWeddingById({ supabase, weddingId: configuredWeddingId })
    : await getSingleInviteSupportWedding({ supabase });

  if (!wedding) {
    return null;
  }

  const email = cleanSupportEmail(wedding.invite_support_email);

  if (!email) {
    return null;
  }

  return {
    displayName: getInviteSupportDisplayName(wedding),
    email,
  };
}
