import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Package,
  Play,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import type {
  SandboxVerificationResult,
  StudioFile,
  TerminalEntry,
} from '../../types/studio';

interface TerminalConsoleProps {
  projectId: string;
  projectTitle: string;
  files: StudioFile[];
  buildLogs: string[];
  compileErrors: string[];
  runtimeLogs: Array<{ id: string; level: 'log' | 'warn' | 'error'; text: string; time: string }>;
  terminalEntries: TerminalEntry[];
  verification: SandboxVerificationResult | null;
  runningCommand: boolean;
  onRunCommand: (cmd: string) => Promise<void>;
  onInstallPackage: (pkg: string) => Promise<void>;
  onRunVerify: () => Promise<void>;
  onClearLogs: () => void;
  onAutoFixErrors?: (errorText: string) => void;
}

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  files,
  buildLogs,
  compileErrors,
  runtimeLogs,
  terminalEntries,
  verification,
  runningCommand,
  onRunCommand,
  onInstallPackage,
  onRunVerify,
  onClearLogs,
  onAutoFixErrors,
}) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'build' | 'console' | 'packages'>('terminal');
  const [commandInput, setCommandInput] = useState('');
  const [packageInput, setPackageInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const declaredPackages = useMemo(() => {
    const pkgFile = files.find((f) => f.path.replace(/^\.?\//, '') === 'package.json');
    if (!pkgFile) return [] as Array<{ name: string; version: string }>;
    try {
      const parsed = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, string>;
      };
      return Object.entries(parsed.dependencies || {}).map(([name, version]) => ({
        name,
        version,
      }));
    } catch {
      return [];
    }
  }, [files]);

  const totalErrorCount =
    compileErrors.length +
    runtimeLogs.filter((r) => r.level === 'error').length +
    (verification?.errors.length || 0);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = commandInput.trim();
    if (!cmd || runningCommand) return;
    setCmdHistory((prev) => [cmd, ...prev.slice(0, 30)]);
    setHistoryIdx(-1);
    setCommandInput('');
    await onRunCommand(cmd);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 30);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && cmdHistory.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(cmdHistory.length - 1, historyIdx + 1);
      setHistoryIdx(nextIdx);
      setCommandInput(cmdHistory[nextIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCommandInput('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommandInput(cmdHistory[nextIdx] || '');
      }
    }
  };

  const handlePkgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packageInput.trim() || runningCommand) return;
    const pkg = packageInput.trim();
    setPackageInput('');
    await onInstallPackage(pkg);
  };

  return (
    <div className="h-52 border-t border-white/[0.08] bg-[#06080D] flex flex-col shrink-0">
      {/* Console Header Bar */}
      <div className="px-3 py-1.5 border-b border-white/[0.07] bg-[#090C13] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: 'terminal', label: 'Terminal' },
              { id: 'build', label: 'Build & Verify' },
              { id: 'console', label: `Console (${runtimeLogs.length})` },
              { id: 'packages', label: `Packages (${declaredPackages.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {verification && (
            <span
              className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-mono tabular-nums ${
                verification.passed ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {verification.passed ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {verification.passed
                ? `esbuild OK (${(verification.bundleBytes / 1024).toFixed(1)} KB)`
                : `${verification.errors.length} build error(s)`}
            </span>
          )}

          {totalErrorCount > 0 && onAutoFixErrors && (
            <button
              type="button"
              onClick={() => {
                const errs = [
                  ...compileErrors,
                  ...(verification?.errors.map((e) => `${e.file || ''}:${e.line || 0} ${e.message}`) || []),
                  ...runtimeLogs.filter((r) => r.level === 'error').map((r) => r.text),
                ].join('\n');
                onAutoFixErrors(errs);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-[11px]"
            >
              <Wrench className="w-3 h-3" />
              Fix
            </button>
          )}

          <button
            type="button"
            onClick={() => void onRunVerify()}
            disabled={runningCommand}
            title="Run isolated esbuild check"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-slate-200 disabled:opacity-40"
          >
            {runningCommand ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3 text-emerald-400" />
            )}
            Verify
          </button>

          <button
            type="button"
            onClick={onClearLogs}
            className="text-[11px] text-slate-400 hover:text-slate-200 px-1.5"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'terminal' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1"
          >
            {terminalEntries.length === 0 ? (
              <div className="text-slate-500">
                Isolated SCOPE-X sandbox shell ready. Type{' '}
                <span className="text-slate-300">help</span>,{' '}
                <span className="text-slate-300">npm run build</span>, or{' '}
                <span className="text-slate-300">npm install &lt;package&gt;</span>.
              </div>
            ) : (
              terminalEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={
                    entry.kind === 'command'
                      ? 'text-cyan-300 font-semibold'
                      : entry.kind === 'stderr'
                        ? 'text-rose-400 whitespace-pre-wrap'
                        : entry.kind === 'warn'
                          ? 'text-amber-300 whitespace-pre-wrap'
                          : entry.kind === 'build'
                            ? 'text-blue-300 whitespace-pre-wrap'
                            : 'text-slate-300 whitespace-pre-wrap'
                  }
                >
                  {entry.text}
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={handleCommandSubmit}
            className="px-3 py-1.5 border-t border-white/[0.06] bg-[#080B12] flex items-center gap-2 shrink-0"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-mono text-xs text-emerald-400 select-none">$</span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="npm run build | npm install canvas-confetti | ls | cat src/App.tsx | help"
              className="flex-1 bg-transparent font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
            <div className="hidden md:flex items-center gap-1 shrink-0">
              {['npm run build', 'ls', 'help'].map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={runningCommand}
                  onClick={() => void onRunCommand(q)}
                  className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] font-mono text-[10px] text-slate-300"
                >
                  {q}
                </button>
              ))}
            </div>
          </form>
        </div>
      )}

      {activeTab === 'build' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1.5">
          {buildLogs.map((b, i) => (
            <div key={`b_${i}`} className="text-blue-300">
              [agent] {b}
            </div>
          ))}
          {verification?.errors.map((err, i) => (
            <div key={`ve_${i}`} className="text-rose-400">
              [esbuild error] {err.file || 'project'}
              {err.line ? `:${err.line}:${err.column || 0}` : ''} — {err.message}
            </div>
          ))}
          {verification?.securityWarnings.map((w, i) => (
            <div key={`sw_${i}`} className="text-amber-300 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
          {compileErrors.map((ce, i) => (
            <div key={`ce_${i}`} className="text-rose-400">
              [preview compile] {ce}
            </div>
          ))}
          {buildLogs.length === 0 &&
            compileErrors.length === 0 &&
            (!verification || verification.errors.length === 0) && (
              <div className="text-slate-500">
                Click &ldquo;Verify&rdquo; to execute full esbuild & security inspection.
              </div>
            )}
        </div>
      )}

      {activeTab === 'console' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1">
          {runtimeLogs.length === 0 ? (
            <div className="text-slate-500">No runtime console output from preview yet.</div>
          ) : (
            runtimeLogs.map((entry) => (
              <div
                key={entry.id}
                className={
                  entry.level === 'error'
                    ? 'text-rose-400'
                    : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }
              >
                [{entry.time}] {entry.text}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'packages' && (
        <div className="flex-1 flex flex-col min-h-0">
          <form
            onSubmit={handlePkgSubmit}
            className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0"
          >
            <Package className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <input
              type="text"
              value={packageInput}
              onChange={(e) => setPackageInput(e.target.value)}
              placeholder="Install npm package (e.g. recharts, chess.js, canvas-confetti, date-fns)..."
              className="flex-1 bg-[#0A0E17] border border-white/10 focus:border-blue-500 rounded px-2.5 py-1 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={runningCommand || !packageInput.trim()}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white whitespace-nowrap"
            >
              {runningCommand ? 'Installing...' : 'Install'}
            </button>
          </form>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {declaredPackages.length === 0 ? (
              <div className="text-xs text-slate-500 font-mono">
                Built-in runtime provides react, react-dom, and lucide-react. Install any npm package above to add it to package.json and ESM preview.
              </div>
            ) : (
              declaredPackages.map((dep) => (
                <div
                  key={dep.name}
                  className="flex items-center justify-between px-2.5 py-1 rounded bg-white/[0.03] border border-white/[0.05] text-xs font-mono"
                >
                  <span className="text-slate-200">{dep.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 tabular-nums">{dep.version}</span>
                    {dep.name !== 'react' && dep.name !== 'react-dom' && (
                      <button
                        type="button"
                        onClick={() => void onRunCommand(`npm uninstall ${dep.name}`)}
                        title={`Remove ${dep.name}`}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
