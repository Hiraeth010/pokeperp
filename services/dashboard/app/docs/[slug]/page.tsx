import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import Markdown from "@/components/Markdown";
import { DOCS, docTitle, isDocSlug } from "@/lib/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const title = docTitle(slug);
  return { title: title ? `${title} · Pokeperp docs` : "Pokeperp docs" };
}

/** Read a doc's markdown at build/request time (server-only). */
function readDoc(slug: string): string | null {
  if (!isDocSlug(slug)) return null;
  try {
    return fs.readFileSync(
      path.join(process.cwd(), "content", "docs", `${slug}.md`),
      "utf8",
    );
  } catch {
    return null;
  }
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const content = readDoc(slug);
  if (!content) notFound();
  return <Markdown content={content} />;
}
