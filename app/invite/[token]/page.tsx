import type { Metadata } from "next";
import { connection } from "next/server";

import { validateInviteToken } from "@/lib/invite-tokens";

export const metadata: Metadata = {
  title: "Invite | Wedding Planner",
};

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  await connection();

  const { token } = await params;
  const result = await validateInviteToken(token);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 py-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Wedding Planner
        </p>
        {result.isValid ? (
          <>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
              Invite found for {result.guest.full_name}
            </h1>
            <p className="mt-3 text-zinc-600">
              This invite link is valid. RSVP details will be added soon.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
              Invite link not found
            </h1>
            <p className="mt-3 text-zinc-600">
              This invite link is invalid or no longer active.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
