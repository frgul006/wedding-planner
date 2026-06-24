type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

function isMissingColumnError(
  error: SupabaseErrorLike | null | undefined,
  columnNames: readonly string[],
) {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  const mentionsColumn = columnNames.some((columnName) =>
    message.includes(columnName.toLowerCase()),
  );

  if (!mentionsColumn) {
    return false;
  }

  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("could not find")
  );
}

export function isMissingPartnerNameColumnError(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingColumnError(error, ["partner_one_name", "partner_two_name"]);
}

export function isMissingWeddingEndDateColumnError(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingColumnError(error, ["wedding_end_date"]);
}

export function isMissingFoodAndDrinkInfoColumnError(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingColumnError(error, ["food_and_drink_info"]);
}

export function isWeddingSettingsSchemaCompatibilityError(
  error: SupabaseErrorLike | null | undefined,
) {
  return (
    isMissingPartnerNameColumnError(error) ||
    isMissingWeddingEndDateColumnError(error) ||
    isMissingFoodAndDrinkInfoColumnError(error)
  );
}
