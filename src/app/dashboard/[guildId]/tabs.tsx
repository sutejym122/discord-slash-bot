"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function Tabs({ guildId }: { guildId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/${guildId}`;
  const tabs = [
    { href: base, label: "Activity" },
    { href: `${base}/rules`, label: "Rules" },
    { href: `${base}/settings`, label: "Settings" },
  ];
  return (
    <nav className="-mb-px flex gap-6" aria-label="Server sections">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "border-b-2 pb-3 text-sm font-medium transition-colors",
              active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
