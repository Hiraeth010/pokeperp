import DocsNav from "@/components/DocsNav";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
      <aside className="md:sticky md:top-24 md:self-start">
        <DocsNav />
      </aside>
      <article className="tcg-card min-w-0">{children}</article>
    </div>
  );
}
