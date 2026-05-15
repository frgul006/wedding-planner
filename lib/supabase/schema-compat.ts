type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

export function isMissingPartnerNameColumnError(
  error: SupabaseErrorLike | null | undefined,
) {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  const mentionsPartnerNameColumn =
    message.includes("partner_one_name") || message.includes("partner_two_name");

  if (!mentionsPartnerNameColumn) {
    return false;
  }

  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("could not find")
  );
}
