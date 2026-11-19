import React, { useEffect, useState } from 'react';
import { Code2, Loader2, Play, Save } from 'lucide-react';
import { MarkdownView } from './MarkdownView';

import type { ProviderId } from '../types/studio';

interface CodeStudioViewProps {
  initialCode?: string;
  initialLanguage?: string;
  selectedProvider: ProviderId;
  selectedModel: string;
  fallbackEnabled: boolean;
  onSaveAsProject: (title: string, content: string, language: string) => void;
}

export const CodeStudioView: React.FC<CodeStudioViewProps> = ({
  initialCode = '',
  initialLanguage = 'typescript',
  selectedProvider,
  selectedModel,
  fallbackEnabled,
  onSaveAsProject,
}) => {
  const [action, setAction] = useState<'generate' | 'explain' | 'debug' | 'refactor'>('generate');
  const [language, setLanguage] = useState(initialLanguage);
  const [task, setTask] = useState('');
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState('');
  const [meta, setMeta] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialCode) setCode(initialCode);
    if (initialLanguage) setLanguage(initialLanguage);
  }, [initialCode, initialLanguage]);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() && !code.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          language,
          task,
          code,
          provider: selectedProvider,
          model: selectedModel,
          fallbackEnabled,
        }),
      });
      const data = (await resp.json()) as {
        text?: string;
        usedProvider?: string;
        usedModel?: string;
        latencyMs?: number;
        fallbackNote?: string;
        error?: string;
      };
      if (!resp.ok || data.error) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setResult(data.text || '');
      const fallbackSuffix = data.fallbackNote ? ` · ${data.fallbackNote}` : '';
      setMeta(
        `${data.usedProvider?.toUpperCase()} · ${data.usedModel} · ${data.latencyMs}ms${fallbackSuffix}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code assistant failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">
            AI Code Studio
          </h2>
          <p className="text-xs text-slate-400">
            Generate, explain, debug, and refactor code across languages.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0D1119] border border-white/10 rounded-lg">
          {(['generate', 'explain', 'debug', 'refactor'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAction(mode)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                action === mode
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleRun} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-blue-400" />
              Source & Instructions
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="sql">SQL</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
              <option value="html">HTML / CSS</option>
            </select>
          </div>

          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={`Describe what to ${action} (e.g., "Write a rate-limited Express middleware" or "Fix async race condition")...`}
            className="w-full bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
          />

          <textarea
            rows={14}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder="Paste existing code here (optional for Generate, recommended for Explain / Debug / Refactor)..."
            className="w-full bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-lg p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLoading || (!task.trim() && !code.trim())}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Run {action}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 flex flex-col min-h-[380px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/[0.08]">
            <span className="text-xs font-medium text-slate-300">
              Assistant Output {meta ? `· ${meta}` : ''}
            </span>
            {result && (
              <button
                type="button"
                onClick={() =>
                  onSaveAsProject(
                    task || `Code Snippet (${language})`,
                    result,
                    language
                  )
                }
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <Save className="w-3.5 h-3.5" />
                Save Project
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 mb-3">
              {error}
            </div>
          )}

          {result ? (
            <div className="flex-1 overflow-y-auto">
              <MarkdownView content={result} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 text-center px-4">
              Select an action and run the assistant to view generated code, debugging analysis, or refactoring suggestions.
            </div>
          )}
        </div>
      </form>
    </div>
  );
};
