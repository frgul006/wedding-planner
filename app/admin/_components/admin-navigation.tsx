"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Översikt" },
  { href: "/admin/guests", label: "Gäster" },
  { href: "/admin/messages", label: "SMS" },
  { href: "/admin/photos", label: "Bilder" },
  { href: "/admin/qr-code", label: "QR" },
  { href: "/admin/updates", label: "Uppdateringar" },
  { href: "/admin/settings", label: "Inställningar" },
];

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin"
      className="mt-4 flex flex-wrap gap-2 lg:grid lg:gap-1.5"
    >
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-[#d8b476] ${active ? "bg-[#f3dfb9] text-[#211910]" : "text-[#eadcc3] hover:bg-[#3a2d20] hover:text-white"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
