import React, { useState } from 'react';
import { Download, ExternalLink, Globe, Loader2, Save, Search } from 'lucide-react';
import type { SourceLink } from '../types/studio';
import { MarkdownView } from './MarkdownView';

interface ResearchViewProps {
  query: string;
  markdown: string;
  sources: SourceLink[];
  isLoading: boolean;
  error: string;
  onRunResearch: (query: string, includeComparison: boolean) => Promise<void>;
  onSaveAsProject: (title: string, content: string) => void;
}

export const ResearchView: React.FC<ResearchViewProps> = ({
  query: initialQuery,
  markdown,
  sources,
  isLoading,
  error,
  onRunResearch,
  onSaveAsProject,
}) => {
  const [queryInput, setQueryInput] = useState(initialQuery || '');
  const [includeComparison, setIncludeComparison] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryInput.trim() || isLoading) return;
    await onRunResearch(queryInput.trim(), includeComparison);
  };

  const handleExportMd = () => {
    const body = `${markdown}\n\n## Sources\n${sources
      .map((s) => `- [${s.title}](${s.uri})`)
      .join('\n')}`;
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scopex-research-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold text-white">
          AI Research Studio
        </h2>
        <p className="text-xs text-slate-400">
          Live web-grounded synthesis, source verification, and structured comparisons.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ask anything or paste URLs to research (e.g., Best laptops under ₹50,000)..."
              className="w-full bg-[#0D1119] border border-white/10 focus:border-blue-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !queryInput.trim()}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Researching
              </span>
            ) : (
              'Run Research'
            )}
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeComparison}
            onChange={(e) => setIncludeComparison(e.target.checked)}
            className="rounded border-white/20 bg-[#0D1119] accent-blue-500"
          />
          Include structured comparison table when applicable
        </label>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
          {error}
        </div>
      )}

      {markdown ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
          <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
              <h3 className="font-display text-sm font-semibold text-white">
                Research Report
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onSaveAsProject(
                      queryInput || initialQuery || 'Research Report',
                      markdown
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Project
                </button>
                <button
                  type="button"
                  onClick={handleExportMd}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export MD
                </button>
              </div>
            </div>
            <MarkdownView content={markdown} />
          </div>

          <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3">
            <h4 className="font-display text-sm font-semibold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              Verified Sources ({sources.length})
            </h4>
            {sources.length === 0 ? (
              <p className="text-xs text-slate-400">
                No external grounding citations returned for this query.
              </p>
            ) : (
              <div className="space-y-2">
                {sources.map((s, idx) => (
                  <a
                    key={idx}
                    href={s.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-2.5 rounded-lg bg-[#07090E] border border-white/[0.06] hover:border-blue-500/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-blue-300 line-clamp-2">
                        {s.title}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-1">
                      {s.uri}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        !isLoading && (
          <div className="bg-[#0D1119] border border-white/10 rounded-xl p-8 text-center space-y-3">
            <p className="text-sm text-slate-300">
              Try a live web research query to generate a cited report and comparison table.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'Best laptops under ₹50,000 in 2026',
                'Compare React 19, Svelte 5, and SolidJS performance',
                'Latest breakthroughs in ocean plastic cleanup technology',
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setQueryInput(sample);
                    void onRunResearch(sample, includeComparison);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#07090E] border border-white/10 hover:border-blue-500/40 text-xs text-slate-200"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
};
