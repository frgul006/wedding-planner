import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  loadAdminGuestRoster,
  normalizeAdminGuestRosterFilters,
  type AdminGuestRosterSearchParams,
} from "@/lib/admin-guest-roster";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GuestRosterEditor } from "./guest-roster-editor";

export const metadata: Metadata = { title: "Gäster | Wedding Planner" };

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<AdminGuestRosterSearchParams>;
}) {
  await connection();
  const initialFilters = normalizeAdminGuestRosterFilters(await searchParams);
  const admin = await requireActiveAdminProfile();
  const roster = await loadAdminGuestRoster({
    // Keep all rows in the editor so clearing a URL filter restores the whole list.
    filters: { query: "", status: "", sort: "name" },
    supabase: await createSupabaseServerClient(),
    weddingId: admin.wedding_id,
  });
  return (
    <main className="grid min-w-0 gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#8f5d2f]">
            Admin · Gäster
          </p>
          <h1 className="mt-1 font-serif text-4xl">Hantera Gäster</h1>
          <p className="mt-2 text-sm text-[#6f604d]">
            OSA, kontaktuppgifter och matönskemål på ett ställe.
          </p>
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Link
              className="bulk-button bg-[#211910] !text-[#fffaf1]"
              href="/admin/guests/catering"
            >
              Cateringunderlag
            </Link>
            <a className="bulk-button" href="/admin/guests/export?format=csv">
              Exportera CSV
            </a>
            <a className="bulk-button" href="/admin/guests/export?format=json">
              Exportera JSON
            </a>
          </div>
          <p className="max-w-md text-xs text-[#6f604d]">
            Råexport: alla sparade, aktiva gäster inklusive kontakter och
            privata noteringar. Använd cateringunderlaget för leverantören.
          </p>
        </div>
      </header>
      {roster.error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
        >
          Kunde inte hämta hela gästlistan. Ladda om sidan. Ingen ofullständig
          lista visas.
        </p>
      ) : (
        <GuestRosterEditor
          initialRows={roster.rows}
          initialFilters={initialFilters}
        />
      )}
    </main>
  );
}
