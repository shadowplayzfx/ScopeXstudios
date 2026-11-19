import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  Eye,
  History,
  Layers,
  Loader2,
  Maximize2,
  MessageSquareCode,
  Minimize2,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Share2,
  Smartphone,
  Sparkles,
  Tablet,
  Undo2,
  Wrench,
} from 'lucide-react';
import type {
  AgentActivityStep,
  BuilderAgentMessage,
  ProjectEnvVar,
  SandboxVerificationResult,
  StudioFile,
  StudioProject,
  TerminalEntry,
} from '../types/studio';
import { buildLivePreviewDocument } from '../utils/previewRuntime';
import { FileTree } from './builder/FileTree';
import { TerminalConsole } from './builder/TerminalConsole';
import { DeployExportModal } from './builder/DeployExportModal';

interface RuntimeConsoleEntry {
  id: string;
  level: 'log' | 'warn' | 'error';
  text: string;
  time: string;
}

interface AppBuilderViewProps {
  project: StudioProject | null;
  isBuilding: boolean;
  architectureNotes: string;
  schemaNotes: string;
  buildLogs: string[];
  agentMessages: BuilderAgentMessage[];
  liveAgentSteps: AgentActivityStep[];
  verification: SandboxVerificationResult | null;
  envVars: ProjectEnvVar[];
  onChangeEnvVars: (vars: ProjectEnvVar[]) => void;
  onBuildOrEdit: (
    prompt: string,
    errorLog?: string,
    forceMode?: 'create' | 'edit'
  ) => Promise<void>;
  onUpdateFile: (fileId: string, content: string) => void;
  onReplaceFiles: (files: StudioFile[], summary?: string) => void;
  onAddFile: (path: string) => void;
  onAddFolder: (folderPath: string) => void;
  onRenameFile: (fileId: string, newPath: string) => void;
  onRenameFolder: (oldPrefix: string, newPrefix: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderPrefix: string) => void;
  onRestoreVersion: (versionNumber: number) => void;
  onUpdateProjectMeta: (title: string, description: string) => void;
  onUpdateVerification: (v: SandboxVerificationResult | null) => void;
}

const STARTER_PROMPTS = [
  {
    title: 'E-Commerce Store + Admin',
    prompt:
      'Build an online store with product search, category filters, interactive shopping cart drawer, checkout validation, and an admin inventory dashboard.',
  },
  {
    title: 'Playable Chess Studio',
    prompt:
      'Create a fully functional interactive chess game with legal move highlighting, captured pieces tracker, move history notation, turn timer, and game reset.',
  },
  {
    title: 'Ocean Conservation Hub',
    prompt:
      'Build a modern editorial website about ocean conservation with interactive marine sanctuary map cards, pledge tracker, donation calculator, and impact metrics.',
  },
  {
    title: 'SaaS Task & Auth Workspace',
    prompt:
      'Build a full-stack productivity workspace with sign-in/profile state, kanban & list views, priority filters, persistent storage, and a clean Node API + database schema.',
  },
];

const DESIGN_DIRECTIVES = [
  'Redesign with an Apple-inspired minimalist editorial layout & crisp contrast',
  'Upgrade to a dark futuristic telemetry theme without changing functionality',
  'Add persistent user authentication, profile settings, and data schema',
  'Improve mobile responsiveness and add smooth micro-interactions',
];

export const AppBuilderView: React.FC<AppBuilderViewProps> = ({
  project,
  isBuilding,
  architectureNotes,
  schemaNotes,
  buildLogs,
  agentMessages,
  liveAgentSteps,
  verification,
  envVars,
  onChangeEnvVars,
  onBuildOrEdit,
  onUpdateFile,
  onReplaceFiles,
  onAddFile,
  onAddFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onRestoreVersion,
  onUpdateProjectMeta,
  onUpdateVerification,
}) => {
  // Layout State: 3-Panel Resizable & Collapsible
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(520);
  const [mobilePane, setMobilePane] = useState<'agent' | 'preview' | 'workspace'>('preview');
  const [fullscreenPreview, setFullscreenPreview] = useState(false);

  // Panel Sub-tabs & Editor State
  const [leftTab, setLeftTab] = useState<'agent' | 'spec' | 'history'>('agent');
  const [promptInput, setPromptInput] = useState('');
  const [activeFileId, setActiveFileId] = useState<string>('');
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = useState(0);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeConsoleEntry[]>([]);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [runningCommand, setRunningCommand] = useState(false);

  // Settings & Deploy Modal
  const [showSettings, setShowSettings] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(project?.title || '');
  const [editDesc, setEditDesc] = useState(project?.description || '');

  const workspaceContainerRef = useRef<HTMLDivElement | null>(null);
  const editorLineRef = useRef<HTMLDivElement | null>(null);
  const agentScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (project) {
      setEditTitle(project.title);
      setEditDesc(project.description);
      if (!project.files.some((f) => f.id === activeFileId)) {
        const entry =
          project.files.find((f) => f.path === 'src/App.tsx') ||
          project.files.find((f) => f.path.includes('App.tsx')) ||
          project.files.find((f) => f.path === 'index.html') ||
          project.files[0];
        setActiveFileId(entry?.id || '');
      }
    }
  }, [project, activeFileId]);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const data = ev.data as { source?: string; level?: string; text?: string } | null;
      if (data?.source === 'scopex-preview' && data.text) {
        const level: RuntimeConsoleEntry['level'] =
          data.level === 'error'
            ? 'error'
            : data.level === 'warn'
              ? 'warn'
              : 'log';
        setRuntimeLogs((prev) => [
          ...prev.slice(-80),
          {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            level,
            text: data.text || '',
            time: new Date().toLocaleTimeString(),
          },
        ]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    agentScrollRef.current?.scrollTo({
      top: agentScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [agentMessages.length, liveAgentSteps.length]);

  const activeFile: StudioFile | undefined = useMemo(
    () => project?.files.find((f) => f.id === activeFileId) || project?.files[0],
    [project, activeFileId]
  );

  const previewResult = useMemo(() => {
    if (!project || project.files.length === 0) return null;
    return buildLivePreviewDocument(project.files, envVars);
  }, [project, envVars]);

  const latestErrors = useMemo(() => {
    const runtimeErrs = runtimeLogs
      .filter((c) => c.level === 'error')
      .map((c) => c.text);
    const verifyErrs =
      verification && !verification.passed
        ? verification.errors.map(
            (e) => `${e.file || 'project'}:${e.line || 0} - ${e.message}`
          )
        : [];
    return Array.from(
      new Set([...(previewResult?.compileErrors || []), ...verifyErrs, ...runtimeErrs])
    );
  }, [runtimeLogs, previewResult, verification]);

  const lineCount = useMemo(() => {
    const text = activeFile?.content || '';
    return Math.max(1, text.split('\n').length);
  }, [activeFile?.content]);

  // Drag-resize splitters
  const startResizeLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (mv: MouseEvent) => {
        const next = Math.max(250, Math.min(480, startW + (mv.clientX - startX)));
        setLeftWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [leftWidth]
  );

  const startResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (mv: MouseEvent) => {
        const next = Math.max(340, Math.min(760, startW - (mv.clientX - startX)));
        setRightWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [rightWidth]
  );

  const appendTerminalEntry = useCallback(
    (kind: TerminalEntry['kind'], text: string) => {
      if (!text) return;
      setTerminalEntries((prev) => [
        ...prev.slice(-150),
        {
          id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          text,
          time: new Date().toLocaleTimeString(),
        },
      ]);
    },
    []
  );

  const handleRunVerify = useCallback(async (): Promise<SandboxVerificationResult | null> => {
    if (!project || project.files.length === 0) return null;
    setRunningCommand(true);
    try {
      const resp = await fetch('/api/sandbox/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, files: project.files }),
      });
      const data = (await resp.json()) as {
        verification?: SandboxVerificationResult;
        error?: string;
      };
      if (data.verification) {
        onUpdateVerification(data.verification);
        appendTerminalEntry(
          data.verification.passed ? 'build' : 'stderr',
          data.verification.passed
            ? `[verify] Compiled ${data.verification.compiledFiles} module(s) with esbuild in ${data.verification.durationMs}ms (${(data.verification.bundleBytes / 1024).toFixed(1)} KB)`
            : `[verify] Failed (${data.verification.errors.length} error(s)): ${data.verification.errors.map((e) => e.message).join('; ')}`
        );
        return data.verification;
      }
      if (data.error) {
        appendTerminalEntry('stderr', data.error);
      }
      return null;
    } catch (err) {
      appendTerminalEntry(
        'stderr',
        err instanceof Error ? err.message : 'Verification request failed.'
      );
      return null;
    } finally {
      setRunningCommand(false);
    }
  }, [appendTerminalEntry, onUpdateVerification, project]);

  const handleRunSandboxCommand = useCallback(
    async (command: string) => {
      if (!project) return;
      appendTerminalEntry('command', `$ ${command}`);
      setRunningCommand(true);
      try {
        const envMap: Record<string, string> = {};
        for (const ev of envVars) {
          if (ev.key.trim()) envMap[ev.key.trim()] = ev.value;
        }
        const resp = await fetch('/api/sandbox/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: project.id,
            projectTitle: project.title,
            command,
            files: project.files,
            projectEnv: envMap,
          }),
        });
        const data = (await resp.json()) as {
          ok?: boolean;
          output?: string;
          stderr?: string;
          updatedFiles?: StudioFile[];
          verification?: SandboxVerificationResult;
          refreshPreview?: boolean;
          clearConsole?: boolean;
        };
        if (data.clearConsole) {
          setTerminalEntries([]);
          return;
        }
        if (data.output) appendTerminalEntry('stdout', data.output);
        if (data.stderr) appendTerminalEntry('stderr', data.stderr);
        if (data.updatedFiles) {
          onReplaceFiles(data.updatedFiles, `Sandbox command: ${command}`);
        }
        if (data.verification) {
          onUpdateVerification(data.verification);
        }
        if (data.refreshPreview) {
          setPreviewKey((k) => k + 1);
        }
      } catch (err) {
        appendTerminalEntry(
          'stderr',
          err instanceof Error ? err.message : 'Sandbox command error.'
        );
      } finally {
        setRunningCommand(false);
      }
    },
    [appendTerminalEntry, envVars, onReplaceFiles, onUpdateVerification, project]
  );

  const handleInstallPackage = useCallback(
    async (pkgName: string) => {
      if (!project) return;
      appendTerminalEntry('command', `$ npm install ${pkgName}`);
      setRunningCommand(true);
      try {
        const resp = await fetch('/api/sandbox/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: project.id,
            projectTitle: project.title,
            packageName: pkgName,
            files: project.files,
          }),
        });
        const data = (await resp.json()) as {
          ok?: boolean;
          package?: { name: string; version: string; description: string };
          files?: StudioFile[];
          verification?: SandboxVerificationResult;
          error?: string;
        };
        if (!resp.ok || data.error) {
          appendTerminalEntry('stderr', data.error || 'Package installation failed.');
          return;
        }
        if (data.files) {
          onReplaceFiles(data.files, `Installed ${data.package?.name || pkgName}`);
        }
        if (data.verification) {
          onUpdateVerification(data.verification);
        }
        if (data.package) {
          appendTerminalEntry(
            'build',
            `+ ${data.package.name}@${data.package.version} installed & synced to Live Preview ESM map.`
          );
        }
        setPreviewKey((k) => k + 1);
      } catch (err) {
        appendTerminalEntry(
          'stderr',
          err instanceof Error ? err.message : 'Package installation error.'
        );
      } finally {
        setRunningCommand(false);
      }
    },
    [appendTerminalEntry, onReplaceFiles, onUpdateVerification, project]
  );

  const handleBuildSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim() || isBuilding) return;
    const text = promptInput.trim();
    setPromptInput('');
    setRuntimeLogs([]);
    await onBuildOrEdit(text);
    setPreviewKey((k) => k + 1);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && activeFile) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextVal =
        activeFile.content.slice(0, start) + '  ' + activeFile.content.slice(end);
      onUpdateFile(activeFile.id, nextVal);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const handleDownloadActiveFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.path.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const deviceWidthClass =
    device === 'mobile'
      ? 'w-[390px] max-w-full mx-auto border-x border-white/15'
      : device === 'tablet'
        ? 'w-[768px] max-w-full mx-auto border-x border-white/15'
        : 'w-full';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#07090E]">
      {/* Top IDE Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08] bg-[#0A0E15] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setLeftOpen((o) => !o)}
            title={leftOpen ? 'Collapse AI Agent panel' : 'Expand AI Agent panel'}
            className="hidden lg:inline-flex p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] text-slate-300"
          >
            {leftOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
          </button>

          <h2 className="font-display text-sm font-semibold text-white truncate max-w-[200px]">
            {project ? project.title : 'SCOPE-X App Builder'}
          </h2>

          {project && (
            <span className="text-[11px] text-slate-400 font-mono tabular-nums whitespace-nowrap">
              v{project.activeVersion} · {project.files.length} files
            </span>
          )}

          {verification && (
            <span
              className={`hidden md:inline-flex items-center gap-1 text-[11px] font-mono tabular-nums ${
                verification.passed ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {verification.passed ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              {verification.passed ? 'Verified' : `${verification.errors.length} err`}
            </span>
          )}
        </div>

        {/* Mobile / Tablet Pane Switcher */}
        <div className="flex lg:hidden items-center gap-1 p-0.5 bg-[#07090E] border border-white/[0.08] rounded-lg">
          {(
            [
              { id: 'agent', label: 'Agent', icon: MessageSquareCode },
              { id: 'preview', label: 'Preview', icon: Eye },
              { id: 'workspace', label: 'Files', icon: Code2 },
            ] as const
          ).map((pane) => {
            const Icon = pane.icon;
            return (
              <button
                key={pane.id}
                type="button"
                onClick={() => setMobilePane(pane.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                  mobilePane === pane.id ? 'bg-blue-600 text-white' : 'text-slate-400'
                }`}
              >
                <Icon className="w-3 h-3" />
                {pane.label}
              </button>
            );
          })}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {project && project.versions.length > 1 && (
            <button
              type="button"
              onClick={() => onRestoreVersion(Math.max(1, project.activeVersion - 1))}
              title="Undo to previous version"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 transition-colors whitespace-nowrap"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Undo</span>
            </button>
          )}

          {project && (
            <>
              <button
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                title="Project settings"
                className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setDeployModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" />
                Export & Deploy
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setRightOpen((o) => !o)}
            title={rightOpen ? 'Collapse Code & Terminal panel' : 'Expand Code & Terminal panel'}
            className="hidden lg:inline-flex p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] text-slate-300"
          >
            {rightOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Optional Project Settings Bar */}
      {showSettings && project && (
        <div className="px-4 py-2.5 bg-[#0D1119] border-b border-white/10 flex flex-wrap items-end gap-3 shrink-0">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] text-slate-400 mb-1">Project Name</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-[2] min-w-[220px]">
            <label className="block text-[11px] text-slate-400 mb-1">Description</label>
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              onUpdateProjectMeta(editTitle.trim() || project.title, editDesc.trim());
              setShowSettings(false);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
          >
            Save
          </button>
        </div>
      )}

      {/* Three-Panel IDE Workspace */}
      <div
        ref={workspaceContainerRef}
        className="flex-1 flex min-h-0 overflow-hidden relative"
      >
        {/* LEFT PANEL: AI Agent Conversation, Live Steps, Spec & Version History */}
        {(leftOpen || mobilePane === 'agent') && (
          <aside
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${leftWidth}px` : undefined }}
            className={`${
              mobilePane === 'agent' ? 'flex w-full' : 'hidden lg:flex'
            } ${!leftOpen ? 'lg:hidden' : ''} flex-col border-r border-white/[0.08] bg-[#090C13] shrink-0 min-h-0`}
          >
            {/* Left Sub-Tabs */}
            <div className="px-2.5 py-1.5 border-b border-white/[0.08] bg-[#070A10] flex items-center gap-1 shrink-0">
              {(
                [
                  { id: 'agent', label: 'AI Agent', icon: Cpu },
                  { id: 'spec', label: 'Architecture', icon: Layers },
                  { id: 'history', label: `Versions (${project?.versions.length || 0})`, icon: History },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLeftTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      leftTab === tab.id
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Agent Chat + Activity */}
            {leftTab === 'agent' && (
              <div className="flex-1 flex flex-col min-h-0">
                <div ref={agentScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                  {agentMessages.length === 0 && !isBuilding && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-[#0D1119] border border-white/[0.08] text-xs text-slate-300 leading-relaxed">
                        Describe a new application or instruct the coding agent to modify existing files, install packages, add authentication/database schemas, or refine UI design.
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-slate-400">
                          Quick Directives
                        </div>
                        {DESIGN_DIRECTIVES.map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            disabled={isBuilding}
                            onClick={() => {
                              if (project && project.files.length > 0) {
                                void onBuildOrEdit(dir);
                              } else {
                                setPromptInput(dir);
                              }
                            }}
                            className="w-full text-left px-2.5 py-2 rounded-lg bg-[#0D1119] hover:bg-white/[0.05] border border-white/[0.06] text-[11px] text-slate-300 transition-colors"
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {agentMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-lg p-2.5 text-xs space-y-1.5 ${
                        msg.role === 'user'
                          ? 'bg-blue-600/15 border border-blue-500/25 text-slate-100'
                          : 'bg-[#0D1119] border border-white/[0.08] text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>{msg.role === 'user' ? 'You' : 'SCOPE-X Agent'}</span>
                        {msg.model && <span className="truncate max-w-[140px]">{msg.model}</span>}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      {msg.steps && msg.steps.length > 0 && (
                        <div className="pt-1.5 border-t border-white/[0.06] space-y-1">
                          {msg.steps.map((st) => (
                            <div
                              key={st.id}
                              className="flex items-start gap-1.5 text-[11px] text-slate-400"
                            >
                              {st.status === 'completed' ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                              ) : st.status === 'failed' ? (
                                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                              ) : (
                                <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0 mt-0.5" />
                              )}
                              <span>{st.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.changedFiles && msg.changedFiles.length > 0 && (
                        <div className="pt-1 text-[10px] font-mono text-blue-300">
                          Updated: {msg.changedFiles.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Live streaming agent steps */}
                  {isBuilding && (
                    <div className="rounded-lg p-3 bg-[#0D1119] border border-blue-500/30 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-blue-300">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Agent executing workflow...</span>
                      </div>
                      <div className="space-y-1.5">
                        {liveAgentSteps.map((step) => (
                          <div key={step.id} className="space-y-0.5">
                            <div className="flex items-start gap-1.5 text-[11px] text-slate-200">
                              {step.status === 'completed' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              ) : step.status === 'failed' ? (
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                              ) : (
                                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" />
                              )}
                              <span>{step.label}</span>
                            </div>
                            {step.detail && (
                              <div className="pl-5 text-[10px] font-mono text-slate-500 truncate">
                                {step.detail}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Agent Prompt Composer */}
                <form
                  onSubmit={handleBuildSubmit}
                  className="p-2.5 border-t border-white/[0.08] bg-[#070A10] space-y-2 shrink-0"
                >
                  <textarea
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleBuildSubmit(e);
                      }
                    }}
                    rows={3}
                    placeholder={
                      project && project.files.length > 0
                        ? 'Instruct agent (e.g., "Add user login & persistent storage", "Switch to a sleek dark theme")...'
                        : 'Describe the app to build...'
                    }
                    className="w-full bg-[#0D1119] border border-white/10 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    {project && project.files.length > 0 ? (
                      <button
                        type="button"
                        disabled={isBuilding || !promptInput.trim()}
                        onClick={async () => {
                          const txt = promptInput.trim();
                          if (!txt) return;
                          setPromptInput('');
                          await onBuildOrEdit(txt, undefined, 'create');
                        }}
                        className="text-[11px] text-slate-400 hover:text-white disabled:opacity-40"
                      >
                        Build as new project
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500">Enter to build</span>
                    )}
                    <button
                      type="submit"
                      disabled={isBuilding || !promptInput.trim()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white"
                    >
                      {isBuilding ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      {project && project.files.length > 0 ? 'Run Agent' : 'Build App'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Architecture & Database Spec Tab */}
            {leftTab === 'spec' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="p-3 rounded-lg bg-[#0D1119] border border-white/[0.08] space-y-1.5">
                  <div className="text-xs font-semibold text-white">Architecture Plan</div>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {architectureNotes || project?.description || 'Generate or open a project to inspect its architecture.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[#0D1119] border border-white/[0.08] space-y-1.5">
                  <div className="text-xs font-semibold text-white">Database & API Schema</div>
                  <p className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {schemaNotes || 'Client-reactive state store.'}
                  </p>
                </div>
              </div>
            )}

            {/* Version History Tab */}
            {leftTab === 'history' && (
              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
                {!project || project.versions.length === 0 ? (
                  <p className="text-xs text-slate-500 p-2">No snapshots recorded yet.</p>
                ) : (
                  [...project.versions].reverse().map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onRestoreVersion(v.versionNumber)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                        v.versionNumber === project.activeVersion
                          ? 'bg-blue-600/15 text-blue-200 border-blue-500/30'
                          : 'bg-[#0D1119] border-white/[0.06] hover:border-white/15 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span>Version {v.versionNumber}</span>
                        <span className="text-slate-500">
                          {new Date(v.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-slate-400 truncate mt-0.5">{v.summary}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </aside>
        )}

        {/* Left Splitter Handle */}
        {leftOpen && (
          <div
            onMouseDown={startResizeLeft}
            title="Drag to resize Agent panel"
            className="hidden lg:block w-1 cursor-col-resize bg-transparent hover:bg-blue-500/50 transition-colors shrink-0"
          />
        )}

        {/* CENTER PANEL: Live Application Preview */}
        <section
          className={`${
            mobilePane === 'preview' ? 'flex' : 'hidden lg:flex'
          } ${
            fullscreenPreview
              ? 'fixed inset-0 z-50 bg-[#05070B]'
              : 'flex-1 min-w-0'
          } flex-col overflow-hidden bg-[#05070B]`}
        >
          {/* Preview Controls Header */}
          <div className="px-3 py-1.5 border-b border-white/[0.08] bg-[#080B11] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Play className="w-3 h-3 text-emerald-400" />
              <span className="font-medium">Live Preview</span>
              {previewResult && previewResult.externalPackages.length > 0 && (
                <span className="hidden xl:inline text-[11px] font-mono text-slate-400">
                  ({previewResult.externalPackages.join(', ')})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {latestErrors.length > 0 && (
                <button
                  type="button"
                  disabled={isBuilding}
                  onClick={() =>
                    onBuildOrEdit(
                      'Diagnose and fix all compile and runtime errors in the application.',
                      latestErrors.join('\n')
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-[11px] font-medium"
                >
                  <Wrench className="w-3 h-3" />
                  Auto-Fix ({latestErrors.length})
                </button>
              )}

              <div className="hidden sm:flex items-center gap-0.5 p-0.5 bg-[#07090E] border border-white/[0.08] rounded-md">
                <button
                  type="button"
                  onClick={() => setDevice('desktop')}
                  title="Desktop viewport"
                  className={`p-1 rounded ${device === 'desktop' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDevice('tablet')}
                  title="Tablet viewport"
                  className={`p-1 rounded ${device === 'tablet' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Tablet className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDevice('mobile')}
                  title="Mobile viewport"
                  className={`p-1 rounded ${device === 'mobile' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setRuntimeLogs([]);
                  setPreviewKey((k) => k + 1);
                }}
                title="Refresh preview"
                className="p-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-300"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setRuntimeLogs([]);
                  setPreviewKey((k) => k + 1);
                  void handleRunVerify();
                }}
                title="Restart sandbox & verify build"
                className="p-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-300"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setFullscreenPreview((f) => !f)}
                title={fullscreenPreview ? 'Exit full-screen preview' : 'Full-screen preview'}
                className="p-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-300"
              >
                {fullscreenPreview ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Preview Viewport Body */}
          {!project || project.files.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
              <div className="max-w-lg space-y-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-600/15 border border-blue-500/25 text-xs text-blue-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  Isolated esbuild Sandbox + Autonomous Agent
                </div>
                <h3 className="font-display text-2xl font-semibold text-white">
                  Build Full-Stack Web Applications Live
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  SCOPE-X plans your architecture, writes modular React/TypeScript/HTML/Node files, resolves npm packages, verifies builds with esbuild, auto-fixes errors, and renders an interactive live preview.
                </p>
                <div className="grid sm:grid-cols-2 gap-2.5 pt-2 text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      disabled={isBuilding}
                      onClick={() => void onBuildOrEdit(item.prompt)}
                      className="p-3 rounded-xl bg-[#0B0F17] border border-white/10 hover:border-blue-500/40 transition-colors space-y-1"
                    >
                      <div className="text-xs font-semibold text-white">{item.title}</div>
                      <div className="text-[11px] text-slate-400 line-clamp-2">
                        {item.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto bg-[#0B0F17] p-2">
              {previewResult && (
                <iframe
                  key={`${previewKey}_${project.activeVersion}`}
                  title="SCOPE-X Live Application Preview"
                  sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                  srcDoc={previewResult.html}
                  className={`h-full min-h-[420px] bg-white rounded-lg ${deviceWidthClass}`}
                />
              )}
            </div>
          )}
        </section>

        {/* Right Splitter Handle */}
        {rightOpen && project && project.files.length > 0 && (
          <div
            onMouseDown={startResizeRight}
            title="Drag to resize Code & Terminal panel"
            className="hidden lg:block w-1 cursor-col-resize bg-transparent hover:bg-blue-500/50 transition-colors shrink-0"
          />
        )}

        {/* RIGHT PANEL: File Explorer, Code Editor & Interactive Sandbox Terminal */}
        {(rightOpen || mobilePane === 'workspace') && project && project.files.length > 0 && (
          <aside
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${rightWidth}px` : undefined }}
            className={`${
              mobilePane === 'workspace' ? 'flex w-full' : 'hidden lg:flex'
            } ${!rightOpen ? 'lg:hidden' : ''} flex-col border-l border-white/[0.08] bg-[#07090E] shrink-0 min-h-0`}
          >
            {/* Top Split: File Explorer + Line-Numbered Code Editor */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <FileTree
                files={project.files}
                activeFileId={activeFile?.id || ''}
                onSelectFile={setActiveFileId}
                onAddFile={onAddFile}
                onAddFolder={onAddFolder}
                onRenameFile={onRenameFile}
                onRenameFolder={onRenameFolder}
                onDeleteFile={onDeleteFile}
                onDeleteFolder={onDeleteFolder}
              />

              {/* Code Editor */}
              <div className="flex-1 flex flex-col min-w-0 bg-[#07090E]">
                <div className="px-3 py-2 border-b border-white/[0.07] bg-[#090C13] flex items-center justify-between gap-2 text-xs text-slate-400 shrink-0">
                  <span className="font-mono text-[11px] text-slate-200 truncate">
                    {activeFile?.path || 'No file selected'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-slate-500 uppercase">
                      {activeFile?.language}
                    </span>
                    {activeFile && (
                      <button
                        type="button"
                        onClick={handleDownloadActiveFile}
                        title="Download current file"
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                  {/* Line Numbers Gutter */}
                  <div
                    ref={editorLineRef}
                    className="w-10 py-3 pr-2 text-right font-mono text-[11px] leading-5 text-slate-600 bg-[#06080D] border-r border-white/[0.05] select-none overflow-hidden shrink-0"
                  >
                    {Array.from({ length: lineCount }, (_, idx) => (
                      <div key={idx}>{idx + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={activeFile?.content || ''}
                    onChange={(e) => {
                      if (activeFile) onUpdateFile(activeFile.id, e.target.value);
                    }}
                    onScroll={(e) => {
                      if (editorLineRef.current) {
                        editorLineRef.current.scrollTop = e.currentTarget.scrollTop;
                      }
                    }}
                    onKeyDown={handleEditorKeyDown}
                    spellCheck={false}
                    className="flex-1 w-full bg-transparent p-3 font-mono text-xs leading-5 text-slate-200 resize-none focus:outline-none overflow-auto whitespace-pre"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Split: Interactive Sandbox Terminal & Build System */}
            <TerminalConsole
              projectId={project.id}
              projectTitle={project.title}
              files={project.files}
              buildLogs={buildLogs}
              compileErrors={previewResult?.compileErrors || []}
              runtimeLogs={runtimeLogs}
              terminalEntries={terminalEntries}
              verification={verification}
              runningCommand={runningCommand}
              onRunCommand={handleRunSandboxCommand}
              onInstallPackage={handleInstallPackage}
              onRunVerify={async () => {
                await handleRunVerify();
              }}
              onClearLogs={() => {
                setTerminalEntries([]);
                setRuntimeLogs([]);
              }}
              onAutoFixErrors={(errText) => {
                void onBuildOrEdit(
                  'Diagnose and fix all build/runtime errors cleanly.',
                  errText
                );
              }}
            />
          </aside>
        )}
      </div>

      {/* Export, Environment & Deployment Modal */}
      {project && (
        <DeployExportModal
          open={deployModalOpen}
          project={project}
          verification={verification}
          envVars={envVars}
          onChangeEnvVars={onChangeEnvVars}
          onRunVerify={handleRunVerify}
          onClose={() => setDeployModalOpen(false)}
        />
      )}
    </div>
  );
};
