import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border)] font-mono text-[11px] text-[var(--accent)]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-[var(--txt-main)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      parts.push(
        <em key={key++} className="italic text-[var(--txt-muted)]">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        const href = m[2];
        const safeHref = /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
        parts.push(
          <a
            key={key++}
            href={safeHref}
            target={safeHref?.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            title={href}
            className="text-[var(--accent)] underline decoration-[var(--accent)]/40 hover:decoration-[var(--accent)]"
          >
            {m[1]}
          </a>,
        );
      } else {
        parts.push(<Fragment key={key++}>{token}</Fragment>);
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }
  return parts;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 rounded-lg border border-[var(--border)] bg-[#06090e] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--surface-raised)] border-b border-[var(--border)] text-[10px] font-mono text-[var(--txt-dim)]">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 hover:text-[var(--txt-main)] cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed text-[var(--txt-main)] select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function MarkdownView({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = /^```(.*)$/.exec(line.trim());
    if (fenceMatch) {
      const lang = fenceMatch[1].trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(<CodeBlock key={key++} lang={lang} code={buf.join("\n")} />);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="my-4 border-[var(--border)]" />);
      i++;
      continue;
    }

    // Heading
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = renderInline(hMatch[2]);
      const cls =
        level === 1
          ? "text-lg font-bold text-[var(--txt-main)] mt-4 mb-2 pb-1.5 border-b border-[var(--border)]"
          : level === 2
            ? "text-base font-semibold text-[var(--txt-main)] mt-4 mb-1.5"
            : level === 3
              ? "text-sm font-semibold text-[var(--accent)] mt-3 mb-1"
              : "text-xs font-semibold uppercase tracking-wide text-[var(--txt-muted)] mt-2.5 mb-1";
      blocks.push(
        <div key={key++} className={cls}>
          {text}
        </div>,
      );
      i++;
      continue;
    }

    // GFM Table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-[var(--surface-raised)] text-[var(--txt-main)]">
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx} className="px-3 py-1.5 text-left font-semibold border-b border-[var(--border)]">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-[var(--border)]/60 last:border-b-0">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3 py-1.5 text-[var(--txt-muted)]">
                      {renderInline(row[cIdx] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith(">")) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        qLines.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2.5 pl-3 border-l-2 border-[var(--accent)]/60 text-xs text-[var(--txt-muted)] space-y-1"
        >
          {qLines.map((ql, idx) => (
            <p key={idx}>{renderInline(ql)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 pl-5 list-disc space-y-1 text-xs text-[var(--txt-main)]/90">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-2 pl-5 list-decimal space-y-1 text-xs text-[var(--txt-main)]/90">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph
    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith(">")
    ) {
      pLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 text-xs leading-relaxed text-[var(--txt-main)]/90">
        {renderInline(pLines.join(" "))}
      </p>,
    );
  }

  return <div className="select-text">{blocks}</div>;
}
