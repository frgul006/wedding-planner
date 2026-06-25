import Link from "next/link";

const adminNav = [
  { href: "/admin", label: "Översikt" },
  { href: "/admin/guests", label: "Gäster" },
  { href: "/admin/messages", label: "SMS" },
  { href: "/admin/photos", label: "Bilder" },
  { href: "/admin/qr-code", label: "QR" },
  { href: "/admin/updates", label: "Uppdateringar" },
  { href: "/admin/settings", label: "Inställningar" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#efe3cf] text-[#1f1a14]">
      <div className="mx-auto grid min-h-dvh max-w-[1600px] lg:grid-cols-[12rem_1fr] xl:grid-cols-[13rem_1fr]">
        <aside className="border-b border-[#d8c7a3] bg-[#211910] p-3 text-[#f8f1e3] lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r lg:p-4">
          <Link
            aria-label="Admin – Wedding Planner startsida"
            className="block rounded-[1.25rem] border border-[#6f5436] bg-[#2d2116] p-4"
            href="/admin"
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8b476]">Admin</p>
            <p className="mt-2 font-serif text-xl leading-tight">Wedding Planner</p>
          </Link>

          <nav aria-label="Admin" className="mt-4 flex flex-wrap gap-2 lg:grid lg:gap-1.5">
            {adminNav.map((item) => (
              <Link
                className="rounded-xl px-3 py-2 text-sm font-bold text-[#eadcc3] transition hover:bg-[#3a2d20] hover:text-white"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="p-4 lg:p-6 xl:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
