export function InvalidInviteMessage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 py-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Wedding Planner
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
          Invite link not valid
        </h1>
        <p className="mt-3 text-zinc-600">
          This invite link is invalid or no longer active.
        </p>
      </section>
    </main>
  );
}
