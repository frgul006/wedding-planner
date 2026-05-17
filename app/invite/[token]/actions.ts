"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { submitRsvpCommand } from "@/lib/rsvp-command";
import type { RsvpActionState } from "@/lib/rsvp-form-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function redirectToInvite(rawToken: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  const query = queryString ? `?${queryString}` : "";

  redirect(`/invite/${encodeURIComponent(rawToken)}${query}#osa`);
}

async function isClientActionRequest() {
  return (await headers()).get("accept")?.includes("text/x-component") ?? false;
}

export async function submitRsvpAction(
  rawToken: string,
  _previousState: RsvpActionState,
  formData: FormData,
): Promise<RsvpActionState> {
  const state = await submitRsvpCommand({
    formData,
    rawToken,
    rpcAdapter: createSupabaseAdminClient(),
  });

  if (state.status !== "submitted") {
    return state;
  }

  revalidatePath(`/invite/${rawToken}`);
  revalidatePath("/admin/guests");

  // Client action redirects can be dropped if the guest changes invite hashes while
  // the request is pending. Return a stateful success for the mounted form to finish.
  if (!(await isClientActionRequest())) {
    redirectToInvite(rawToken, { rsvp_status: "submitted" });
  }

  return state;
}
