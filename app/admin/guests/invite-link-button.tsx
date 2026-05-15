"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { generateInviteLinkAction, type GenerateInviteLinkState } from "./actions";

const initialState: GenerateInviteLinkState = {};

export function InviteLinkButton({
  guestId,
  guestName,
  hasActiveToken,
}: {
  guestId: string;
  guestName: string;
  hasActiveToken: boolean;
}) {
  const generateInviteLinkWithId = generateInviteLinkAction.bind(null, guestId);
  const [state, formAction, isPending] = useActionState(
    generateInviteLinkWithId,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const inviteUrl = state.guestId === guestId ? state.inviteUrl : undefined;
  const error = state.guestId === guestId ? state.error : undefined;

  useEffect(() => {
    if (inviteUrl) {
      linkRef.current?.select();
    }
  }, [inviteUrl]);

  async function copyInviteUrl() {
    if (!inviteUrl) {
      return;
    }

    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <button
          className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending
            ? "Generating..."
            : hasActiveToken
              ? "Regenerate invite link"
              : "Generate invite link"}
        </button>
      </form>

      {inviteUrl ? (
        <div className="w-72 rounded-2xl bg-emerald-50 p-3 text-left ring-1 ring-emerald-100">
          <p className="text-xs font-medium text-emerald-800">
            New private link for {guestName}. Copy it now; it will not be shown after reload.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              aria-label={`New invite link for ${guestName}`}
              className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-2 py-1 text-xs text-zinc-950"
              readOnly
              ref={linkRef}
              value={inviteUrl}
            />
            <button
              className="rounded-xl bg-emerald-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-800"
              onClick={copyInviteUrl}
              type="button"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
