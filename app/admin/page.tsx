import type { Metadata } from "next";
import { connection } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { logoutAction } from "./login/actions";

export const metadata: Metadata = {
  title: "Admin | Wedding Planner",
};

export default async function AdminPage() {
  await connection();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Admin dashboard
            </h1>
            <p className="mt-2 text-zinc-600">
              Signed in as {user?.email ?? "unknown admin"}.
            </p>
          </div>

          <form action={logoutAction}>
            <button
              className="rounded-full border border-zinc-300 px-5 py-3 font-medium text-zinc-900 transition hover:bg-zinc-100"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-950">Next up</h2>
          <p className="mt-2 text-zinc-600">
            Admin feature pages will be added here as we implement the PRD build order.
          </p>
        </div>
      </section>
    </main>
  );
}
