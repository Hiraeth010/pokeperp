import type { Metadata } from "next";
import Markdown from "@/components/Markdown";
import { UPDATES } from "@/lib/updates";

export const metadata: Metadata = {
  title: "Updates · Pokeperp",
  description: "Official Pokeperp announcements, releases, and news.",
};

const HANDLE = "pokeperpsss";

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function UpdatesPage() {
  const posts = [...UPDATES].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight">Updates</h1>
        <p className="text-sm text-[rgb(var(--muted))]">
          Official Pokeperp announcements — also on{" "}
          <a
            href={`https://x.com/${HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[rgb(var(--psychic-from))] hover:underline"
          >
            X @{HANDLE}
          </a>
          .
        </p>
      </header>

      <a
        href="https://github.com/Hiraeth010/pokeperp"
        target="_blank"
        rel="noopener noreferrer"
        className="block tcg-card transition hover:border-[rgb(var(--electric-from))]/50"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
          <span aria-hidden>📌</span> Pinned
        </div>
        <p className="text-sm leading-7 text-[rgb(var(--foreground))]/90">
          Pokeperp is a fully open-sourced perp DEX trading against the PSA 10 Modern Top 25 Pokémon Card Index.
        </p>
        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[rgb(var(--electric-from))]">
          View the source on GitHub ↗
        </span>
      </a>

      <div className="space-y-4">
        {posts.map((u) => (
          <article key={u.id} className="tcg-card">
            <div className="mb-3 flex items-center gap-3">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[rgb(var(--electric-from))] to-[rgb(var(--psychic-from))] text-sm font-bold text-white"
                aria-hidden
              >
                P
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">Pokeperp</span>
                  <span className="text-[rgb(var(--electric-to))]" aria-hidden>
                    ✓
                  </span>
                </div>
                <div className="text-xs text-[rgb(var(--muted))]">
                  @{HANDLE} · {fmtDate(u.date)}
                </div>
              </div>
              {u.tag && (
                <span className="ml-auto shrink-0 rounded-full border border-[rgb(var(--border-subtle))] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  {u.tag}
                </span>
              )}
            </div>
            <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <Markdown content={u.body} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
