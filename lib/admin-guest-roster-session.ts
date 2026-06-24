import { isE164PhoneNumber } from "@/lib/phone";
import { isRecord } from "@/lib/type-guards";

export type AdminGuestRosterSessionValues = {
  email: string | null;
  fullName: string;
  notes: string | null;
  phone: string | null;
  plusOneAllowed: boolean;
  smsOptIn: boolean;
};

export type AdminGuestRosterSessionChange = {
  draftId?: string;
  expectedUpdatedAt?: string;
  id?: string;
  rowKey: string;
  values: AdminGuestRosterSessionValues;
};

export type AdminGuestRosterSessionField =
  | "contact"
  | "fullName"
  | "phone"
  | "row";

export type AdminGuestRosterSessionFieldErrors = Partial<
  Record<AdminGuestRosterSessionField, string>
>;

export type AdminGuestRosterSessionErrors = Record<
  string,
  AdminGuestRosterSessionFieldErrors
>;

export type SaveAdminGuestRosterSessionResult =
  | { savedCount: number; status: "success" }
  | {
      errors: AdminGuestRosterSessionErrors;
      message: string;
      status: "validation-error";
    }
  | { message: string; status: "error" };

type NormalizedAdminGuestRosterSessionChange = {
  draft_id: string | null;
  email: string | null;
  expected_updated_at: string | null;
  full_name: string;
  id: string | null;
  notes: string | null;
  phone: string | null;
  plus_one_allowed: boolean;
  row_key: string;
  sms_opt_in: boolean;
};

type AdminGuestRosterSessionRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type AdminGuestRosterSessionRpcAdapter = {
  rpc(
    functionName: "save_admin_guest_roster_session",
    args: {
      p_changes: NormalizedAdminGuestRosterSessionChange[];
      p_wedding_id: string;
    },
  ): PromiseLike<AdminGuestRosterSessionRpcResult>;
};

function cleanRequiredText(value: string) {
  return value.trim();
}

function cleanOptionalText(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function addFieldError(
  errors: AdminGuestRosterSessionErrors,
  rowKey: string,
  field: AdminGuestRosterSessionField,
  message: string,
) {
  errors[rowKey] = { ...errors[rowKey], [field]: message };
}

export function normalizeAdminGuestRosterSessionChanges(
  changes: AdminGuestRosterSessionChange[],
) {
  const errors: AdminGuestRosterSessionErrors = {};
  const normalized = changes.map((change, index) => {
    const rowKey = change.rowKey || change.id || change.draftId || `row-${index + 1}`;
    const fullName = cleanRequiredText(change.values.fullName);
    const email = cleanOptionalText(change.values.email);
    const phone = cleanOptionalText(change.values.phone);
    const notes = cleanOptionalText(change.values.notes);

    if (!fullName) {
      addFieldError(errors, rowKey, "fullName", "Namn krävs.");
    }

    if (!email && !phone) {
      addFieldError(
        errors,
        rowKey,
        "contact",
        "Ange e-post eller telefonnummer.",
      );
    }

    if (change.values.smsOptIn && (!phone || !isE164PhoneNumber(phone))) {
      addFieldError(
        errors,
        rowKey,
        "phone",
        "SMS kräver telefonnummer i format +46701234567.",
      );
    }

    if (change.id && !change.expectedUpdatedAt) {
      addFieldError(
        errors,
        rowKey,
        "row",
        "Raden saknar versionsstämpel. Ladda om sidan.",
      );
    }

    if (!change.id && !change.draftId) {
      addFieldError(
        errors,
        rowKey,
        "row",
        "Ny rad saknar utkast-id.",
      );
    }

    return {
      draft_id: change.draftId ?? null,
      email,
      expected_updated_at: change.expectedUpdatedAt ?? null,
      full_name: fullName,
      id: change.id ?? null,
      notes,
      phone,
      plus_one_allowed: change.values.plusOneAllowed,
      row_key: rowKey,
      sms_opt_in: change.values.smsOptIn,
    } satisfies NormalizedAdminGuestRosterSessionChange;
  });

  return { errors, normalized };
}

function hasErrors(errors: AdminGuestRosterSessionErrors) {
  return Object.keys(errors).length > 0;
}

function isSaveRpcSuccess(value: unknown): value is {
  saved_count: number;
  status: "success";
} {
  return (
    isRecord(value) &&
    value.status === "success" &&
    typeof value.saved_count === "number"
  );
}

function isSaveRpcValidationError(value: unknown): value is {
  errors: AdminGuestRosterSessionErrors;
  message?: string;
  status: "validation-error";
} {
  return (
    isRecord(value) &&
    value.status === "validation-error" &&
    isRecord(value.errors)
  );
}

function coerceErrors(value: unknown): AdminGuestRosterSessionErrors {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([rowKey, rowErrors]) => {
      if (!isRecord(rowErrors)) {
        return [];
      }

      const fields = Object.fromEntries(
        Object.entries(rowErrors).filter(
          (entry): entry is [AdminGuestRosterSessionField, string] =>
            typeof entry[1] === "string" &&
            ["contact", "fullName", "phone", "row"].includes(entry[0]),
        ),
      );

      return Object.keys(fields).length ? [[rowKey, fields]] : [];
    }),
  );
}

export async function saveAdminGuestRosterSession({
  changes,
  logger = console,
  rpcAdapter,
  weddingId,
}: {
  changes: AdminGuestRosterSessionChange[];
  logger?: Pick<Console, "error">;
  rpcAdapter: AdminGuestRosterSessionRpcAdapter;
  weddingId: string;
}): Promise<SaveAdminGuestRosterSessionResult> {
  if (changes.length === 0) {
    return { savedCount: 0, status: "success" };
  }

  const { errors, normalized } = normalizeAdminGuestRosterSessionChanges(changes);

  if (hasErrors(errors)) {
    return {
      errors,
      message: "Rätta markerade fält innan du sparar.",
      status: "validation-error",
    };
  }

  const { data, error } = await rpcAdapter.rpc("save_admin_guest_roster_session", {
    p_changes: normalized,
    p_wedding_id: weddingId,
  });

  if (error) {
    logger.error("Failed save Admin Guest roster session", error);
    return {
      message: "Kunde inte spara ändringarna. Försök igen.",
      status: "error",
    };
  }

  if (isSaveRpcSuccess(data)) {
    return { savedCount: data.saved_count, status: "success" };
  }

  if (isSaveRpcValidationError(data)) {
    return {
      errors: coerceErrors(data.errors),
      message: data.message ?? "Rätta markerade fält innan du sparar.",
      status: "validation-error",
    };
  }

  logger.error("Unexpected Admin Guest roster session RPC result", data);
  return {
    message: "Kunde inte tolka svaret från databasen.",
    status: "error",
  };
}
