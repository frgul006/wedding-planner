import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  loadAdminGuestRoster,
  normalizeAdminGuestRosterFilters,
} from "@/lib/admin-guest-roster";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GuestRosterEditor } from "./guest-roster-editor";

export const metadata: Metadata = {
  title: "Gäster | Wedding Planner",
};

type GuestsPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
    status?: string | string[];
  }>;
};

export default async function GuestsPage({ searchParams }: GuestsPageProps) {
  await connection();
  const params = await searchParams;
  const initialFilters = normalizeAdminGuestRosterFilters(params);
  const adminProfile = await requireActiveAdminProfile();
  const supabase = await createSupabaseServerClient();
  const roster = await loadAdminGuestRoster({
    filters: { query: "", sort: "name", status: "" },
    supabase,
    weddingId: adminProfile.wedding_id,
  });

  return (
    <main className="grid gap-6">
      <section className="rounded-[2.25rem] border border-[#d8c7a3] bg-[#2a2118] p-6 text-[#f8f1e3] shadow-[0_24px_80px_rgba(42,33,24,0.18)] lg:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.32em] text-[#d8b476]">Admin · Gäster</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
          <div>
            <h1 className="font-serif text-4xl leading-tight lg:text-5xl">Hantera Gäster</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#e7d9c2]">
              Redigera kontaktuppgifter, SMS-samtycke, +1 och admin-noteringar över flera Gäster. Spara ändringar samlat när du är klar.
            </p>
          </div>
          <div className="rounded-3xl border border-[#b9955f] bg-[#3a2d20] px-5 py-4 text-sm">
            <p className="font-bold">{roster.rows.length} aktiva Gäster</p>
            <p className="text-[#d8c7a3]">Skrivskyddade Plus-one Gäster ingår i vyn.</p>
          </div>
        </div>
      </section>

      {roster.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-800" role="alert">
          Kunde inte läsa Gästlistan. Försök igen.
        </div>
      ) : null}

      <GuestRosterEditor initialFilters={initialFilters} initialRows={roster.rows} />
    </main>
  );
}
