/** Ordered, user-facing docs surfaced at /docs. Internal ops docs (secrets,
 *  mainnet runbook) intentionally live only in the repo, never here.
 *
 *  Client-safe: this module holds only the manifest (imported by the sidebar).
 *  The filesystem read lives in the server page (app/docs/[slug]/page.tsx). */
export const DOCS = [
  { slug: "overview", title: "What is Pokeperp?" },
  { slug: "index-methodology", title: "The PMT50 Index" },
  { slug: "perpetuals", title: "Trading the perp" },
  { slug: "oracle", title: "The oracle" },
] as const;

export type DocSlug = (typeof DOCS)[number]["slug"];

export function docTitle(slug: string): string | null {
  return DOCS.find((d) => d.slug === slug)?.title ?? null;
}

export function isDocSlug(slug: string): boolean {
  return DOCS.some((d) => d.slug === slug);
}
