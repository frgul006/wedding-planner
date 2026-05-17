"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  getInviteRsvpSubmittedHref,
  isInviteRsvpClientActionAcceptHeader,
} from "@/lib/invite-rsvp-navigation";
import { submitRsvpCommand } from "@/lib/rsvp-command";
import type { RsvpActionState } from "@/lib/rsvp-form-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

async function isClientActionRequest() {
  return isInviteRsvpClientActionAcceptHeader((await headers()).get("accept"));
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
    redirect(getInviteRsvpSubmittedHref(rawToken));
  }

  return state;
}
