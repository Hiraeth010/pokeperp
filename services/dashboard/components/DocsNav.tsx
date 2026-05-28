"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS } from "@/lib/docs";

export default function DocsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      <p className="label-caps mb-2 px-3">Docs</p>
      {DOCS.map((d) => {
        const href = `/docs/${d.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={d.slug}
            href={href}
            className={`px-3 py-2 rounded-md text-sm transition-colors ${
              active
                ? "bg-[rgb(var(--background-elevated))] text-white font-medium"
                : "text-[rgb(var(--muted))] hover:text-white hover:bg-[rgb(var(--background-elevated))]/60"
            }`}
          >
            {d.title}
          </Link>
        );
      })}
    </nav>
  );
}
