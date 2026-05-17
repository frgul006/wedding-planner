import { expect, test } from "@playwright/test";

import {
  submitRsvpCommand,
  type RsvpResponseRpcAdapter,
  type SubmitRsvpResponseRpcArgs,
} from "../lib/rsvp-command";
import { RSVP_ATTENDANCE } from "../lib/rsvp-attendance";
import { RSVP_ACTION_COPY, type RsvpActionState } from "../lib/rsvp-form-state";

type RpcError = {
  code?: string;
  message?: string;
};

function createFormData(fields: Record<string, boolean | string | null | undefined>) {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }

    formData.set(name, value === true ? "on" : value);
  }

  return formData;
}

function createRpcAdapter({
  error = null,
  onRpc,
}: {
  error?: RpcError | null;
  onRpc?: (
    functionName: "submit_rsvp_response",
    args: SubmitRsvpResponseRpcArgs,
  ) => void;
} = {}) {
  let callCount = 0;
  const adapter: RsvpResponseRpcAdapter = {
    async rpc(functionName, args) {
      callCount += 1;
      onRpc?.(functionName, args);

      return { error };
    },
  };

  return {
    adapter,
    getCallCount: () => callCount,
  };
}

function runCommand(formData: FormData, rpcAdapter: RsvpResponseRpcAdapter) {
  return submitRsvpCommand({
    formData,
    hashToken: () => "hashed-token",
    logger: { error: () => undefined },
    rawToken: "raw-token",
    rpcAdapter,
  });
}

function expectFieldError(
  state: RsvpActionState,
  expectedFieldErrors: RsvpActionState["fieldErrors"],
) {
  expect(state.status).toBe("error");
  expect(state.message).toBeNull();
  expect(state.fieldErrors).toEqual(expectedFieldErrors);
}

test.describe("RSVP command", () => {
  test("rejects invalid attendance before calling the RPC", async () => {
    const rpc = createRpcAdapter();
    const state = await runCommand(createFormData({ phone: "" }), rpc.adapter);

    expectFieldError(state, {
      attendance: RSVP_ACTION_COPY.validation.attendanceRequired,
    });
    expect(rpc.getCallCount()).toBe(0);
  });

  test("rejects invalid guest phone before calling the RPC", async () => {
    const rpc = createRpcAdapter();
    const state = await runCommand(
      createFormData({ attendance: RSVP_ATTENDANCE.yes, phone: "0701234567" }),
      rpc.adapter,
    );

    expectFieldError(state, {
      phone: RSVP_ACTION_COPY.validation.phoneFormat,
    });
    expect(rpc.getCallCount()).toBe(0);
  });

  test("requires guest phone before SMS opt-in", async () => {
    const rpc = createRpcAdapter();
    const state = await runCommand(
      createFormData({
        attendance: RSVP_ATTENDANCE.yes,
        phone: "",
        sms_opt_in: true,
      }),
      rpc.adapter,
    );

    expectFieldError(state, {
      phone: RSVP_ACTION_COPY.validation.smsPhoneRequired,
    });
    expect(rpc.getCallCount()).toBe(0);
  });

  test("requires +1 name when any +1 payload is present", async () => {
    const rpc = createRpcAdapter();
    const state = await runCommand(
      createFormData({
        attendance: RSVP_ATTENDANCE.yes,
        include_plus_one: true,
        phone: "",
      }),
      rpc.adapter,
    );

    expectFieldError(state, {
      plus_one_name: RSVP_ACTION_COPY.validation.plusOneNameRequired,
    });
    expect(rpc.getCallCount()).toBe(0);
  });

  test("requires +1 phone before +1 SMS opt-in", async () => {
    const rpc = createRpcAdapter();
    const state = await runCommand(
      createFormData({
        attendance: RSVP_ATTENDANCE.yes,
        include_plus_one: true,
        phone: "",
        plus_one_name: "Guest Friend",
        plus_one_phone: "",
        plus_one_sms_opt_in: true,
      }),
      rpc.adapter,
    );

    expectFieldError(state, {
      plus_one_phone: RSVP_ACTION_COPY.validation.plusOneSmsPhoneRequired,
    });
    expect(rpc.getCallCount()).toBe(0);
  });

  test("translates invalid-token RPC errors into Invite-friendly copy", async () => {
    const rpc = createRpcAdapter({
      error: { code: "P0002", message: "Invite token not valid" },
    });
    const state = await runCommand(
      createFormData({
        attendance: RSVP_ATTENDANCE.yes,
        food_preference: "Vegetarian",
        phone: "",
      }),
      rpc.adapter,
    );

    expect(state).toMatchObject({
      fieldErrors: {},
      message: RSVP_ACTION_COPY.saveError.invalidInvite,
      status: "error",
      values: { foodPreference: "Vegetarian" },
    });
    expect(rpc.getCallCount()).toBe(1);
  });

  test("translates +1 permission RPC errors into friendly copy", async () => {
    const rpc = createRpcAdapter({
      error: { code: "42501", message: "Plus-one not allowed for guest" },
    });
    const state = await runCommand(
      createFormData({
        attendance: RSVP_ATTENDANCE.yes,
        include_plus_one: true,
        phone: "",
        plus_one_name: "Unexpected Plus One",
      }),
      rpc.adapter,
    );

    expect(state).toMatchObject({
      fieldErrors: {},
      message: RSVP_ACTION_COPY.saveError.plusOneNotAllowed,
      status: "error",
      values: { plusOneName: "Unexpected Plus One" },
    });
    expect(rpc.getCallCount()).toBe(1);
  });

  test("maps a valid RSVP intent to the submit_rsvp_response RPC payload", async () => {
    let rpcFunctionName: "submit_rsvp_response" | null = null;
    let rpcArgs: SubmitRsvpResponseRpcArgs | null = null;
    const rpc = createRpcAdapter({
      onRpc(functionName, args) {
        rpcFunctionName = functionName;
        rpcArgs = args;
      },
    });
    const state = await runCommand(
      createFormData({
        allergy_notes: " Peanuts ",
        attendance: RSVP_ATTENDANCE.maybe,
        food_preference: " Vegan ",
        include_plus_one: true,
        phone: "+46701234567",
        plus_one_allergy_notes: " No shellfish ",
        plus_one_email: " guest@example.com ",
        plus_one_food_preference: " Fish ",
        plus_one_name: " Guest Friend ",
        plus_one_phone: "+46701112233",
        plus_one_sms_opt_in: true,
        sms_opt_in: true,
      }),
      rpc.adapter,
    );

    expect(state).toEqual({
      fieldErrors: {},
      message: null,
      status: "submitted",
      values: null,
    });
    expect(rpcFunctionName).toBe("submit_rsvp_response");
    expect(rpcArgs).toEqual({
      p_allergy_notes: "Peanuts",
      p_attendance: RSVP_ATTENDANCE.maybe,
      p_extra_guests: 1,
      p_food_preference: "Vegan",
      p_phone: "+46701234567",
      p_plus_one_allergy_notes: "No shellfish",
      p_plus_one_email: "guest@example.com",
      p_plus_one_food_preference: "Fish",
      p_plus_one_name: "Guest Friend",
      p_plus_one_phone: "+46701112233",
      p_plus_one_sms_opt_in: true,
      p_sms_opt_in: true,
      p_token_hash: "hashed-token",
    });
    expect(rpc.getCallCount()).toBe(1);
  });
});
