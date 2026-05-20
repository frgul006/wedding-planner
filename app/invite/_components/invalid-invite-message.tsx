import type { InviteSupportContact } from "@/lib/invite-support-contact";
import { getInviteSupportFooterMark } from "@/lib/wedding-settings-display";

import { BrevkortPage } from "./brevkort-primitives";

type InvalidInviteMessageProps = {
  supportContact?: InviteSupportContact | null;
};

function getSupportDisplayName(supportContact: InviteSupportContact) {
  return supportContact.displayName ?? "värdparet";
}

export function InvalidInviteMessage({ supportContact = null }: InvalidInviteMessageProps) {
  const supportDisplayName = supportContact
    ? getSupportDisplayName(supportContact)
    : null;
  const supportFooterMark = getInviteSupportFooterMark(supportContact?.displayName ?? null);

  return (
    <BrevkortPage className="flex flex-col items-center px-7 py-[60px] sm:px-7 sm:py-[60px]">
      <section
        aria-labelledby="invalid-invite-heading"
        className="brevkort-paper-light flex min-h-[438px] w-full max-w-[334px] flex-col items-center border border-invite-border-soft bg-invite-paper-light px-6 py-10 text-center shadow-[0_16px_42px_rgb(118_84_60_/_8%)]"
      >
        <h1
          className="brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-rust"
          id="invalid-invite-heading"
        >
          Inbjudan saknas
        </h1>

        <p
          aria-hidden="true"
          className="brevkort-ornament mt-6 text-4xl leading-none text-invite-walnut"
        >
          ❦
        </p>

        <p className="brevkort-display mt-6 text-[2.35rem] font-semibold leading-[1.05] tracking-tight text-invite-ink">
          <span className="block">Den här länken</span>
          <span className="block italic text-invite-walnut">fungerade inte.</span>
        </p>

        <p className="mt-7 max-w-[260px] text-sm leading-6 text-invite-body">
          Inbjudningslänken är ogiltig eller har gått ut. {supportDisplayName ? (
            <>
              Hör av dig till {supportDisplayName} så skickar de en ny.
            </>
          ) : (
            "Be värdparet om en ny länk."
          )}
        </p>

        {supportContact ? (
          <div className="mt-8 w-full border-t border-invite-border-soft pt-6">
            <p className="brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut">
              Kontakt
            </p>
            {supportContact.displayName ? (
              <p className="brevkort-display mt-3 text-2xl italic leading-none text-invite-ink">
                {supportContact.displayName}
              </p>
            ) : null}
            <a
              className="mt-3 inline-block break-all font-mono text-xs font-semibold tracking-[0.12em] text-invite-ink underline-offset-4 hover:underline"
              href={`mailto:${supportContact.email}`}
            >
              {supportContact.email}
            </a>
          </div>
        ) : null}
      </section>

      {supportFooterMark ? (
        <p className="brevkort-metadata mt-6 text-[0.62rem] font-semibold text-invite-walnut/80">
          {supportFooterMark}
        </p>
      ) : null}
    </BrevkortPage>
  );
}
