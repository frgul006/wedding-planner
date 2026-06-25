"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { generateInviteLinkAction, type GenerateInviteLinkState } from "./actions";

const initialState: GenerateInviteLinkState = {};

export function InviteLinkButton({
  accessScope = "full",
  disabled = false,
  guestId,
  guestName,
  hasActiveToken,
}: {
  accessScope?: "full" | "scoped";
  disabled?: boolean;
  guestId: string;
  guestName: string;
  hasActiveToken: boolean;
}) {
  const generateInviteLinkWithId = generateInviteLinkAction.bind(null, guestId);
  const [state, formAction, isPending] = useActionState(generateInviteLinkWithId, initialState);
  const [hasNewLinkOnClipboard, setHasNewLinkOnClipboard] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const inviteUrl = state.guestId === guestId ? state.inviteUrl : undefined;
  const error = state.guestId === guestId ? state.error : undefined;
  const inviteLabel = accessScope === "scoped" ? "begränsad inbjudningslänk" : "inbjudningslänk";
  const isRegenerateActionVisible = hasActiveToken && !disabled && !isPending;
  const regenerateTitle = isRegenerateActionVisible
    ? "Skapar en ny inbjudningslänk och ogiltigförklarar/ersätter den gamla aktiva länken."
    : undefined;

  useEffect(() => {
    if (inviteUrl) {
      linkRef.current?.select();
    }
  }, [inviteUrl]);

  async function copyNewInviteUrl() {
    if (!inviteUrl) {
      return;
    }

    await navigator.clipboard.writeText(inviteUrl);
    setHasNewLinkOnClipboard(true);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction} onSubmit={() => setHasNewLinkOnClipboard(false)}>
        <button
          className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || isPending}
          title={regenerateTitle}
          type="submit"
        >
          {disabled
            ? "Spara listan först"
            : isPending
              ? "Skapar…"
              : hasActiveToken
                ? "Ny länk"
                : `Skapa ${inviteLabel}`}
        </button>
      </form>

      {inviteUrl ? (
        <div className="w-72 rounded-2xl bg-emerald-50 p-3 text-left ring-1 ring-emerald-100">
          <p className="text-xs font-medium text-emerald-800">
            Ny {inviteLabel} för {guestName}. Kopiera den nu om du behöver URL:en; den visas inte efter omladdning.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              aria-label={`Ny ${inviteLabel} för ${guestName}`}
              className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-2 py-1 text-xs text-zinc-950"
              readOnly
              ref={linkRef}
              value={inviteUrl}
            />
            <button
              className="rounded-xl bg-emerald-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-800"
              onClick={copyNewInviteUrl}
              type="button"
            >
              {hasNewLinkOnClipboard ? "Ny länk kopierad" : "Kopiera ny länk"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
