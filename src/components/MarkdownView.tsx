import React, { useState } from 'react';
import { Check, Copy, Code2 } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  onSendCodeToStudio?: (code: string, language: string) => void;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  onSendCodeToStudio,
}) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const blocks = parseBlocks(content);

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-200">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div
              key={idx}
              className="rounded-lg border border-white/10 bg-[#070A10] overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.07] bg-white/[0.02] text-xs text-slate-400">
                <span className="font-mono">{block.lang || 'code'}</span>
                <div className="flex items-center gap-2">
                  {onSendCodeToStudio && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendCodeToStudio(block.text, block.lang || 'typescript')
                      }
                      className="inline-flex items-center gap-1 hover:text-blue-400 transition-colors"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      Open in Code Studio
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(block.text, idx)}
                    className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors"
                  >
                    {copiedIdx === idx ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
              <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-200 leading-5">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="overflow-x-auto rounded-lg border border-white/10"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-white/[0.04] border-b border-white/10">
                    {block.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 font-semibold text-slate-200">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="border-b border-white/[0.06] last:border-none hover:bg-white/[0.02]"
                    >
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-slate-300">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <div key={idx} className="space-y-1.5">
            {block.lines.map((line, lIdx) => {
              if (line.startsWith('### ')) {
                return (
                  <h4
                    key={lIdx}
                    className="font-display text-base font-semibold text-white pt-2"
                  >
                    {renderInline(line.slice(4))}
                  </h4>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h3
                    key={lIdx}
                    className="font-display text-lg font-semibold text-white pt-2"
                  >
                    {renderInline(line.slice(3))}
                  </h3>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2
                    key={lIdx}
                    className="font-display text-xl font-bold text-white pt-2"
                  >
                    {renderInline(line.slice(2))}
                  </h2>
                );
              }
              if (/^\s*[-*]\s+/.test(line)) {
                return (
                  <div key={lIdx} className="flex gap-2 pl-2">
                    <span className="text-blue-400 select-none">•</span>
                    <span>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</span>
                  </div>
                );
              }
              if (/^\s*\d+\.\s+/.test(line)) {
                const match = line.match(/^\s*(\d+\.)\s+(.*)$/);
                return (
                  <div key={lIdx} className="flex gap-2 pl-2">
                    <span className="font-mono text-xs text-blue-400 pt-0.5 tabular-nums">
                      {match?.[1]}
                    </span>
                    <span>{renderInline(match?.[2] || line)}</span>
                  </div>
                );
              }
              if (!line.trim()) return <div key={lIdx} className="h-1" />;
              return <p key={lIdx}>{renderInline(line)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
};

type ParsedBlock =
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'prose'; lines: string[] };

function parseBlocks(src: string): ParsedBlock[] {
  const lines = src.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|/.test(lines[i + 1])
    ) {
      const splitRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const proseLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i].trim().startsWith('```') &&
      !(
        lines[i].includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:-]+\|/.test(lines[i + 1])
      )
    ) {
      proseLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'prose', lines: proseLines });
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-white/[0.08] font-mono text-xs text-blue-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}
