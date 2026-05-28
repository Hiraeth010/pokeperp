"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Themed markdown renderer for the /docs pages. */
export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => (
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mb-5 mt-2" {...p} />
        ),
        h2: (p) => (
          <h2 className="font-display text-xl sm:text-2xl tracking-tight mt-10 mb-3 pb-2 border-b border-[rgb(var(--border-subtle))]/50" {...p} />
        ),
        h3: (p) => (
          <h3 className="text-base font-semibold mt-6 mb-2 text-[rgb(var(--foreground))]" {...p} />
        ),
        p: (p) => (
          <p className="text-sm leading-7 text-[rgb(var(--foreground))]/85 my-4" {...p} />
        ),
        ul: (p) => <ul className="list-disc pl-5 my-4 space-y-1.5 text-sm leading-7 text-[rgb(var(--foreground))]/85 marker:text-[rgb(var(--muted))]" {...p} />,
        ol: (p) => <ol className="list-decimal pl-5 my-4 space-y-1.5 text-sm leading-7 text-[rgb(var(--foreground))]/85 marker:text-[rgb(var(--muted))]" {...p} />,
        li: (p) => <li className="pl-1" {...p} />,
        a: (p) => (
          <a className="text-[rgb(var(--psychic-from))] hover:underline" target="_blank" rel="noopener noreferrer" {...p} />
        ),
        strong: (p) => <strong className="font-semibold text-[rgb(var(--foreground))]" {...p} />,
        blockquote: (p) => (
          <blockquote className="border-l-2 border-[rgb(var(--electric-to))]/60 bg-[rgb(var(--background-elevated))]/40 pl-4 py-2 my-5 text-sm text-[rgb(var(--muted))] rounded-r" {...p} />
        ),
        hr: () => <hr className="my-8 border-[rgb(var(--border-subtle))]/40" />,
        code: (p) => (
          <code className="px-1.5 py-0.5 rounded bg-[rgb(var(--background-elevated))] text-[rgb(var(--electric-to))] text-[12.5px] font-mono" {...p} />
        ),
        pre: (p) => (
          <pre className="my-4 p-4 rounded-lg bg-[rgb(var(--background-elevated))] overflow-x-auto text-[12.5px] leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[rgb(var(--foreground))]/90" {...p} />
        ),
        table: (p) => (
          <div className="my-5 overflow-x-auto">
            <table className="w-full text-sm border-collapse" {...p} />
          </div>
        ),
        th: (p) => (
          <th className="text-left font-semibold text-[rgb(var(--muted))] uppercase text-[11px] tracking-wider border-b border-[rgb(var(--border-subtle))]/60 px-3 py-2" {...p} />
        ),
        td: (p) => (
          <td className="border-b border-[rgb(var(--border-subtle))]/30 px-3 py-2 text-[rgb(var(--foreground))]/85 align-top" {...p} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
