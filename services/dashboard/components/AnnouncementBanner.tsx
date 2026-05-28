/**
 * Temporary site-wide announcement strip. Edit MESSAGE to change it, or set
 * SHOW = false (or remove from layout) to take it down.
 */
const SHOW = true;
const MESSAGE = "A new official Pokeperp X account is coming soon — stay tuned.";

export default function AnnouncementBanner() {
  if (!SHOW) return null;
  return (
    <div
      role="status"
      className="w-full border-b border-[rgb(var(--psychic-from))]/40 bg-gradient-to-r from-[rgb(var(--psychic-from))]/10 via-[rgb(var(--psychic-from))]/20 to-[rgb(var(--psychic-from))]/10 text-[rgb(var(--psychic-from))]"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-[11px] sm:text-xs">
        <span className="font-medium tracking-wide">{MESSAGE}</span>
      </div>
    </div>
  );
}
