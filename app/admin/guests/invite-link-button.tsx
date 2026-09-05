"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  generateInviteLinkAction,
  type GenerateInviteLinkState,
} from "./actions";

const initialState: GenerateInviteLinkState = {};

export function InviteLinkButton({
  accessScope = "full",
  disabled = false,
  guestId,
  guestName,
}: {
  accessScope?: "full" | "scoped";
  disabled?: boolean;
  guestId: string;
  guestName: string;
}) {
  const [state, formAction, isPending] = useActionState(
    generateInviteLinkAction.bind(null, guestId),
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inviteUrl = state.guestId === guestId ? state.inviteUrl : undefined;
  const error = state.guestId === guestId ? state.error : undefined;
  const inviteLabel =
    accessScope === "scoped" ? "begränsad inbjudningslänk" : "inbjudningslänk";

  useEffect(() => {
    if (inviteUrl) {
      dialogRef.current?.showModal();
      linkRef.current?.select();
    }
  }, [inviteUrl]);

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
      linkRef.current?.select();
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <form
        action={formAction}
        onSubmit={() => {
          setCopied(false);
          setCopyError(false);
        }}
      >
        <button
          className="bulk-button"
          disabled={disabled || isPending}
          title={
            disabled || isPending
              ? undefined
              : "Skapar en ny inbjudningslänk. Finns en aktiv länk sedan tidigare ogiltigförklaras/ersätts den."
          }
          type="submit"
        >
          {disabled ? "Spara listan först" : isPending ? "Skapar…" : "Ny länk"}
        </button>
      </form>
      {inviteUrl ? (
        <>
          <button
            type="button"
            className="text-left text-xs font-semibold underline"
            onClick={() => dialogRef.current?.showModal()}
          >
            Visa ny länk
          </button>
          {/* Native top layer avoids clipping inside narrow table cells and traps focus. */}
          <dialog
            ref={dialogRef}
            aria-labelledby={`invite-link-title-${guestId}`}
            className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-5 text-left text-[#211910] shadow-2xl backdrop:bg-black/40"
          >
            <h2
              id={`invite-link-title-${guestId}`}
              className="font-serif text-2xl"
            >
              Ny {inviteLabel}
            </h2>
            <p className="mt-2 break-words text-sm">
              För {guestName}. Kopiera länken nu; den visas inte efter
              omladdning.
            </p>
            <input
              ref={linkRef}
              aria-label={`Ny ${inviteLabel} för ${guestName}`}
              className="cell-input mt-4 w-full min-w-0"
              readOnly
              value={inviteUrl}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="bulk-button bg-emerald-100"
                type="button"
                onClick={copyLink}
              >
                {copied ? "Ny länk kopierad" : "Kopiera ny länk"}
              </button>
              <button
                className="bulk-button"
                type="button"
                onClick={() => dialogRef.current?.close()}
              >
                Stäng
              </button>
            </div>
            {copyError ? (
              <p role="status" className="mt-3 text-sm text-amber-900">
                Kunde inte kopiera automatiskt. Länken är markerad; kopiera med
                Cmd/Ctrl+C.
              </p>
            ) : null}
          </dialog>
        </>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
