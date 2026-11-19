import React, { useState } from 'react';
import JSZip from 'jszip';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ProjectEnvVar,
  SandboxVerificationResult,
  StudioFile,
  StudioProject,
} from '../../types/studio';

interface DeployExportModalProps {
  open: boolean;
  project: StudioProject;
  verification: SandboxVerificationResult | null;
  envVars: ProjectEnvVar[];
  onChangeEnvVars: (vars: ProjectEnvVar[]) => void;
  onRunVerify: () => Promise<SandboxVerificationResult | null>;
  onClose: () => void;
}

export const DeployExportModal: React.FC<DeployExportModalProps> = ({
  open,
  project,
  verification,
  envVars,
  onChangeEnvVars,
  onRunVerify,
  onClose,
}) => {
  const [tab, setTab] = useState<'verify' | 'github' | 'vercel' | 'env'>('verify');
  const [busy, setBusy] = useState(false);

  // GitHub form state (PAT is kept only in component state, never saved to localStorage/Firestore)
  const [ghToken, setGhToken] = useState('');
  const [ghRepo, setGhRepo] = useState(
    project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scopex-app'
  );
  const [ghPrivate, setGhPrivate] = useState(false);
  const [ghCommitMsg, setGhCommitMsg] = useState('Initial commit from SCOPE-X App Builder');
  const [ghResult, setGhResult] = useState<{ repoUrl: string; pushedFiles: number } | null>(null);
  const [ghError, setGhError] = useState('');

  // Vercel form state
  const [vercelToken, setVercelToken] = useState('');
  const [vercelName, setVercelName] = useState(
    project.title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'scopex-app'
  );
  const [vercelResult, setVercelResult] = useState<{ deploymentUrl: string } | null>(null);
  const [vercelError, setVercelError] = useState('');

  // Env Var draft
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [newEnvPublic, setNewEnvPublic] = useState(true);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const buildStandardBundleFiles = (): StudioFile[] => {
    const out = [...project.files];
    const hasPath = (p: string) => out.some((f) => f.path.replace(/^\.?\//, '') === p);
    const now = Date.now();
    const safeSlug =
      project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scopex-app';

    if (!hasPath('package.json')) {
      out.push({
        id: `exp_pkg_${now}`,
        path: 'package.json',
        language: 'json',
        content: JSON.stringify(
          {
            name: safeSlug,
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
            dependencies: {
              react: '^19.0.0',
              'react-dom': '^19.0.0',
              'lucide-react': '^0.546.0',
            },
            devDependencies: {
              '@vitejs/plugin-react': '^4.3.4',
              typescript: '^5.7.2',
              vite: '^6.0.0',
            },
          },
          null,
          2
        ),
        updatedAt: now,
      });
    }
    if (!hasPath('.env.example') && envVars.length > 0) {
      out.push({
        id: `exp_env_${now}`,
        path: '.env.example',
        language: 'text',
        content: envVars.map((e) => `${e.key}=`).join('\n') + '\n',
        updatedAt: now,
      });
    }
    return out;
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const exportFiles = buildStandardBundleFiles();
    for (const f of exportFiles) {
      zip.file(f.path, f.content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'scopex-app'}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGitHubPush = async (e: React.FormEvent) => {
    e.preventDefault();
    setGhError('');
    setGhResult(null);
    setBusy(true);
    try {
      const resp = await fetch('/api/builder/github-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: ghToken,
          repoName: ghRepo,
          description: project.description,
          isPrivate: ghPrivate,
          commitMessage: ghCommitMsg,
          files: buildStandardBundleFiles(),
        }),
      });
      const data = (await resp.json()) as {
        repoUrl?: string;
        pushedFiles?: number;
        error?: string;
      };
      if (!resp.ok || data.error || !data.repoUrl) {
        throw new Error(data.error || 'GitHub export failed.');
      }
      setGhResult({ repoUrl: data.repoUrl, pushedFiles: data.pushedFiles || 0 });
    } catch (err) {
      setGhError(err instanceof Error ? err.message : 'GitHub push failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleVercelDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setVercelError('');
    setVercelResult(null);
    setBusy(true);
    try {
      const envMap: Record<string, string> = {};
      for (const ev of envVars) {
        if (ev.key.trim()) envMap[ev.key.trim()] = ev.value;
      }
      const resp = await fetch('/api/builder/vercel-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: vercelToken,
          projectName: vercelName,
          files: buildStandardBundleFiles(),
          envVars: envMap,
        }),
      });
      const data = (await resp.json()) as { deploymentUrl?: string; error?: string };
      if (!resp.ok || data.error || !data.deploymentUrl) {
        throw new Error(data.error || 'Vercel deployment failed.');
      }
      setVercelResult({ deploymentUrl: data.deploymentUrl });
    } catch (err) {
      setVercelError(err instanceof Error ? err.message : 'Vercel deployment failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddEnv = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedKey = newEnvKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!cleanedKey) return;
    onChangeEnvVars([
      ...envVars.filter((x) => x.key !== cleanedKey),
      {
        id: `env_${Date.now()}`,
        key: cleanedKey,
        value: newEnvVal,
        isPublic: newEnvPublic,
      },
    ]);
    setNewEnvKey('');
    setNewEnvVal('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0A0E15] border border-white/15 rounded-xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">
              Export, Environment & Deployment
            </h3>
            <p className="text-xs text-slate-400">
              {project.title} · {project.files.length} files
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 py-2 border-b border-white/[0.08] bg-[#07090E] flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'verify', label: 'Build & ZIP', icon: ShieldCheck },
            { id: 'github', label: 'GitHub Push', icon: Github },
            { id: 'vercel', label: 'Vercel Deploy', icon: CloudUpload },
            { id: 'env', label: `Project .env (${envVars.length})`, icon: KeyRound },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as typeof tab)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  tab === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {tab === 'verify' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#07090E] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Production Build Validation
                    </div>
                    <div className="text-xs text-slate-400">
                      Runs isolated esbuild bundling and static security scanning before export.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await onRunVerify();
                      setBusy(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white shrink-0"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Run Build Check
                  </button>
                </div>

                {verification && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <div
                      className={`flex items-center gap-2 text-xs font-medium ${
                        verification.passed ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {verification.passed ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      <span>
                        {verification.passed
                          ? `Verified cleanly — ${verification.compiledFiles} modules, ${(verification.bundleBytes / 1024).toFixed(1)} KB in ${verification.durationMs}ms`
                          : `${verification.errors.length} build error(s) found`}
                      </span>
                    </div>
                    {verification.errors.map((err, idx) => (
                      <div key={idx} className="text-xs font-mono text-rose-300 bg-rose-950/30 p-2 rounded">
                        {err.file || 'project'}:{err.line || 0} — {err.message}
                      </div>
                    ))}
                    {verification.securityWarnings.map((w, idx) => (
                      <div key={idx} className="text-xs font-mono text-amber-300 bg-amber-950/30 p-2 rounded">
                        {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-[#07090E] border border-white/[0.08] flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-white">Download Complete Project ZIP</div>
                  <div className="text-xs text-slate-400">
                    Includes all source files, package.json, and .env.example template (secrets excluded).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownloadZip()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download ZIP
                </button>
              </div>
            </div>
          )}

          {tab === 'github' && (
            <form onSubmit={handleGitHubPush} className="space-y-3">
              <p className="text-xs text-slate-400">
                Push this project directly to a GitHub repository using a Personal Access Token (repo scope). Your token is used only for this request and never stored.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Repository Name</label>
                  <input
                    type="text"
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    required
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">GitHub Personal Access Token</label>
                  <input
                    type="password"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="ghp_..."
                    required
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Commit Message</label>
                <input
                  type="text"
                  value={ghCommitMsg}
                  onChange={(e) => setGhCommitMsg(e.target.value)}
                  className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={ghPrivate}
                  onChange={(e) => setGhPrivate(e.target.checked)}
                  className="rounded border-white/20"
                />
                Create as private repository
              </label>

              {ghError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
                  {ghError}
                </div>
              )}
              {ghResult && (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-2">
                  <span>Pushed {ghResult.pushedFiles} files to GitHub cleanly.</span>
                  <a
                    href={ghResult.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline font-medium"
                  >
                    Open Repo <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Github className="w-3.5 h-3.5" />}
                  Push to GitHub
                </button>
              </div>
            </form>
          )}

          {tab === 'vercel' && (
            <form onSubmit={handleVercelDeploy} className="space-y-3">
              <p className="text-xs text-slate-400">
                Deploy directly to Vercel using your Vercel API Token. Configured Project .env variables are forwarded to the deployment securely without persisting credentials.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vercel Project Name</label>
                  <input
                    type="text"
                    value={vercelName}
                    onChange={(e) => setVercelName(e.target.value)}
                    required
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vercel API Token</label>
                  <input
                    type="password"
                    value={vercelToken}
                    onChange={(e) => setVercelToken(e.target.value)}
                    placeholder="Vercel token..."
                    required
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {vercelError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
                  {vercelError}
                </div>
              )}
              {vercelResult && (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-2">
                  <span>Deployment created on Vercel.</span>
                  <a
                    href={vercelResult.deploymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline font-medium"
                  >
                    Visit Deployment <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="w-3.5 h-3.5" />
                  )}
                  Deploy to Vercel
                </button>
              </div>
            </form>
          )}

          {tab === 'env' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Manage project-scoped environment variables for your generated app. Keys marked Public (`VITE_*`) are available inside the live preview sandbox; private server keys remain isolated to Node sandbox & deployment targets.
              </p>

              <form onSubmit={handleAddEnv} className="grid sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-4">
                  <label className="block text-[11px] text-slate-400 mb-1">Key</label>
                  <input
                    type="text"
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                    placeholder="VITE_API_URL"
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-[11px] text-slate-400 mb-1">Value</label>
                  <input
                    type="password"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                    placeholder="Value..."
                    className="w-full bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-3 flex items-center gap-2">
                  <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={newEnvPublic}
                      onChange={(e) => setNewEnvPublic(e.target.checked)}
                    />
                    Public
                  </label>
                  <button
                    type="submit"
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </form>

              <div className="space-y-1.5">
                {envVars.length === 0 ? (
                  <div className="text-xs text-slate-500 py-3 text-center border border-dashed border-white/10 rounded-lg">
                    No project environment variables configured yet.
                  </div>
                ) : (
                  envVars.map((ev) => {
                    const shown = Boolean(revealedIds[ev.id]);
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#07090E] border border-white/[0.08] text-xs font-mono"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-blue-300 truncate">{ev.key}</span>
                          <span className="text-slate-500">=</span>
                          <span className="text-slate-300 truncate">
                            {shown ? ev.value || '(empty)' : '••••••••'}
                          </span>
                          {ev.isPublic && (
                            <span className="text-[10px] text-emerald-400">public</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedIds((p) => ({ ...p, [ev.id]: !p[ev.id] }))
                            }
                            className="p-1 text-slate-400 hover:text-white"
                          >
                            {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeEnvVars(envVars.filter((x) => x.id !== ev.id))}
                            className="p-1 text-slate-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
