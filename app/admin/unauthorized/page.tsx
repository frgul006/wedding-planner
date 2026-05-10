import type { Metadata } from "next";

import { logoutAction } from "../login/actions";

export const metadata: Metadata = {
  title: "Unauthorized | Wedding Planner",
};

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 py-12">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Wedding Planner
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
          Admin access required
        </h1>
        <p className="mt-4 text-zinc-600">
          You are signed in with Supabase Auth, but this account does not have an active admin profile for this wedding.
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Ask an existing admin to add your account before trying again.
        </p>

        <form action={logoutAction} className="mt-8">
          <button
            className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
