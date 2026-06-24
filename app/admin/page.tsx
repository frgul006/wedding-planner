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
      className="rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] p-6 shadow-[0_18px_60px_rgba(77,53,31,0.08)] transition hover:-translate-y-0.5 hover:bg-white"
      href={href}
    >
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8f5d2f]">{label}</p>
      <p className="mt-5 font-serif text-5xl text-[#1f1a14]">{count}</p>
      <p className="mt-3 text-sm leading-6 text-[#6f604d]">{description}</p>
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

  const wedding = Array.isArray(adminProfile.weddings)
    ? adminProfile.weddings[0]
    : adminProfile.weddings;

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
    <main className="grid gap-6">
      <section className="rounded-[2.25rem] border border-[#d8c7a3] bg-[#2a2118] p-6 text-[#f8f1e3] shadow-[0_24px_80px_rgba(42,33,24,0.18)] lg:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-[#d8b476]">Admin · Brevet Console</p>
            <h1 className="mt-4 font-serif text-4xl leading-tight lg:text-6xl">
              {wedding?.name ?? "Wedding Planner"}
            </h1>
            <h2 className="sr-only">Admin dashboard</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#e7d9c2]">
              Inloggad som {adminProfile.display_name || user.email || "admin"}. Översikten visar bara verklig data från bröllopet.
            </p>
            <p className="sr-only">Signed in as {adminProfile.display_name || user.email || "admin"}.</p>
          </div>
          <form action={logoutAction}>
            <AdminSubmitButton
              className="rounded-full border border-[#b9955f] px-5 py-3 text-sm font-bold text-[#f8f1e3] transition hover:bg-[#3a2d20] disabled:cursor-not-allowed disabled:opacity-60"
              pendingLabel="Loggar ut…"
            >
              Logga ut
            </AdminSubmitButton>
          </form>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          ariaLabel="Manage guests"
          count={formatCount(guestCount)}
          description="Aktiva Invited Guests och Plus-one Guests i roster."
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
          description="Skapade Wedding SMS och Invite SMS-blasts."
          href="/admin/messages"
          label="SMS"
        />
        <OverviewCard
          ariaLabel="Manage updates"
          count={formatCount(updateCount)}
          description="Publicerade eller utkastade bröllopsuppdateringar."
          href="/admin/updates"
          label="Uppdateringar"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Link aria-label="Manage QR code" className="rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] p-6 text-sm font-bold text-[#4d351f] transition hover:bg-white" href="/admin/qr-code">
          QR-kod till Wedding hub
        </Link>
        <Link aria-label="Manage settings" className="rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] p-6 text-sm font-bold text-[#4d351f] transition hover:bg-white" href="/admin/settings">
          Bröllopsinställningar
        </Link>
        <Link className="rounded-[2rem] border border-[#d8c7a3] bg-[#fffaf1] p-6 text-sm font-bold text-[#4d351f] transition hover:bg-white" href="/admin/messages?invite_preview=1">
          Förhandsgranska Invite SMS
        </Link>
      </section>
    </main>
  );
}
