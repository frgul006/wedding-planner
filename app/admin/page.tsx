import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AdminSubmitButton } from "./_components/submit-button";
import { logoutAction } from "./login/actions";

export const metadata: Metadata = {
  title: "Admin | Wedding Planner",
};

type CountResult = { count: number | null; error: object | null };

function formatCount(result: CountResult) {
  if (result.error) {
    return "—";
  }

  return String(result.count ?? 0);
}

function OverviewCard({
  ariaLabel,
  count,
  description,
  href,
  label,
}: {
  ariaLabel?: string;
  count: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <Link
      aria-label={ariaLabel}
      className="rounded-[1.5rem] border border-[#d8c7a3] bg-[#fffaf1] p-5 shadow-[0_14px_44px_rgba(77,53,31,0.08)] transition hover:-translate-y-0.5 hover:bg-white"
      href={href}
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8f5d2f]">{label}</p>
      <p className="mt-3 font-serif text-4xl text-[#1f1a14]">{count}</p>
      <p className="mt-2 text-sm leading-6 text-[#6f604d]">{description}</p>
    </Link>
  );
}

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

  const wedding = Array.isArray(adminProfile.weddings) ? adminProfile.weddings[0] : adminProfile.weddings;

  const [guestCount, pendingPhotoCount, messageCount, updateCount] = await Promise.all([
    supabase
      .from("guests")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", adminProfile.wedding_id)
      .is("deleted_at", null),
    supabase
      .from("photo_uploads")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", adminProfile.wedding_id)
      .eq("verification_status", "verified")
      .eq("moderation_status", "pending")
      .is("deleted_at", null),
    supabase
      .from("message_blasts")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", adminProfile.wedding_id),
    supabase
      .from("wedding_updates")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", adminProfile.wedding_id),
  ]);

  return (
    <main className="grid gap-5">
      <section className="rounded-[1.75rem] border border-[#d8c7a3] bg-[#2a2118] p-4 text-[#f8f1e3] shadow-[0_18px_56px_rgba(42,33,24,0.16)] lg:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8b476]">Admin – Wedding Planner</p>
            <h1 className="mt-2 font-serif text-3xl leading-tight lg:text-4xl">{wedding?.name ?? "Wedding Planner"}</h1>
            <h2 className="sr-only">Admin dashboard</h2>
          </div>
          <form action={logoutAction}>
            <AdminSubmitButton
              className="rounded-full border border-[#b9955f] px-4 py-2.5 text-sm font-bold text-[#f8f1e3] transition hover:bg-[#3a2d20] disabled:cursor-not-allowed disabled:opacity-60"
              pendingLabel="Loggar ut…"
            >
              Logga ut
            </AdminSubmitButton>
          </form>
        </div>
      </section>

      <section
        aria-label="Administratörskontext"
        className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] px-4 py-3 text-sm text-[#6f604d]"
      >
        Inloggad som {adminProfile.display_name || user.email || "admin"}. Visar aktuell bröllopsdata.
        <span className="sr-only">Signed in as {adminProfile.display_name || user.email || "admin"}.</span>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          ariaLabel="Manage guests"
          count={formatCount(guestCount)}
          description="Aktiva gäster, inklusive plus-one-gäster."
          href="/admin/guests"
          label="Gäster"
        />
        <OverviewCard
          ariaLabel="Manage photos"
          count={formatCount(pendingPhotoCount)}
          description="Verifierade bilder som väntar på moderering."
          href="/admin/photos"
          label="Bilder"
        />
        <OverviewCard
          ariaLabel="Send messages"
          count={formatCount(messageCount)}
          description="Skickade SMS och inbjudningsutskick."
          href="/admin/messages"
          label="SMS"
        />
        <OverviewCard
          ariaLabel="Manage updates"
          count={formatCount(updateCount)}
          description="Publicerade och sparade bröllopsuppdateringar."
          href="/admin/updates"
          label="Uppdateringar"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Link
          aria-label="Manage QR code"
          className="rounded-[1.5rem] border border-[#d8c7a3] bg-[#fffaf1] p-5 text-sm font-bold text-[#4d351f] transition hover:bg-white"
          href="/admin/qr-code"
        >
          QR-kod till bröllopshubben
        </Link>
        <Link
          aria-label="Manage settings"
          className="rounded-[1.5rem] border border-[#d8c7a3] bg-[#fffaf1] p-5 text-sm font-bold text-[#4d351f] transition hover:bg-white"
          href="/admin/settings"
        >
          Bröllopsinställningar
        </Link>
        <Link
          className="rounded-[1.5rem] border border-[#d8c7a3] bg-[#fffaf1] p-5 text-sm font-bold text-[#4d351f] transition hover:bg-white"
          href="/admin/messages?invite_preview=1"
        >
          Förhandsgranska inbjudnings-SMS
        </Link>
      </section>
    </main>
  );
}
