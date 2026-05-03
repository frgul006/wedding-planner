import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("email, display_name, role, wedding_id, weddings(name)")
    .eq("id", user?.id ?? "")
    .eq("is_active", true)
    .maybeSingle();

  if (!user || !adminProfile) {
    redirect("/admin/unauthorized");
  }

  const wedding = Array.isArray(adminProfile.weddings)
    ? adminProfile.weddings[0]
    : adminProfile.weddings;

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
              Signed in as {adminProfile.display_name || user.email || "admin"}.
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
          <h2 className="text-xl font-semibold text-zinc-950">Access</h2>
          <dl className="mt-4 grid gap-4 text-sm text-zinc-700 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-zinc-950">Wedding</dt>
              <dd>{wedding?.name ?? "Unknown wedding"}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-950">Role</dt>
              <dd>{adminProfile.role}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-950">Email</dt>
              <dd>{adminProfile.email}</dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
            <h2 className="text-xl font-semibold text-zinc-950">Guest management</h2>
            <p className="mt-2 text-zinc-600">
              Add, edit, search, and archive invitees.
            </p>
            <a
              className="mt-6 inline-flex rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800"
              href="/admin/guests"
            >
              Manage guests
            </a>
          </div>

          <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
            <h2 className="text-xl font-semibold text-zinc-950">Wedding settings</h2>
            <p className="mt-2 text-zinc-600">
              Update event details, venue information, timeline, and guest-facing notes.
            </p>
            <a
              className="mt-6 inline-flex rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800"
              href="/admin/settings"
            >
              Manage settings
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
