import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Box,
  Code2,
  FileText,
  Film,
  FolderKanban,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  Layers,
  LogIn,
  LogOut,
  MapPin,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  Minimize2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import type {
  AgentActivityStep,
  BuilderAgentMessage,
  ChatAttachment,
  ChatMessage,
  ConversationThread,
  GeneratedDocument,
  GeneratedImageItem,
  GeneratedMusicItem,
  GeneratedVideoItem,
  ImageEngineProvider,
  MediaTrack,
  ProjectEnvVar,
  ProjectType,
  ProviderId,
  ProviderStatus,
  SandboxVerificationResult,
  SourceLink,
  StudioFile,
  StudioModule,
  StudioProject,
  StudioTheme,
  SystemActivityItem,
  ToolAction,
} from './types/studio';
import {
  appendMessageToFirestore,
  auth,
  deletePlaylistTrackFromFirestore,
  deleteProjectFromFirestore,
  loadConversationMessagesFromFirestore,
  loadProjectDetailsFromFirestore,
  saveConversationMetaToFirestore,
  savePlaylistTrackToFirestore,
  saveProjectToFirestore,
  signInWithGoogle,
  signOutUser,
  subscribeUserCollections,
  upsertUserProfile,
} from './services/firebase';
import {
  CURATED_VOICES,
  getAvailableVoices,
  isSpeechRecognitionSupported,
  startLiveSpeechRecognition,
  voiceController,
  type SpeechRecognizerHandle,
  type VoiceOption,
} from './utils/voiceEngine';
import {
  GeminiLiveAudioClient,
  type LiveConnectionState,
} from './utils/liveAudioClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AssistantView } from './components/AssistantView';
import { AppBuilderView } from './components/AppBuilderView';
import { ResearchView } from './components/ResearchView';
import { WriterView } from './components/WriterView';
import { ImageStudioView } from './components/ImageStudioView';
import { VideoStudioView, type PrefilledVideoSource } from './components/VideoStudioView';
import { CodeStudioView } from './components/CodeStudioView';
import { DocumentStudioView } from './components/DocumentStudioView';
import { MediaPlayerView } from './components/MediaPlayerView';
import { MapsView } from './components/MapsView';
import { Studio3DView } from './components/Studio3DView';
import { Game3DView } from './components/Game3DView';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';

const NAV_ITEMS: Array<{
  id: StudioModule;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'assistant', label: 'AI Assistant', icon: MessageSquare },
  { id: 'builder', label: 'App Builder', icon: Layers },
  { id: 'research', label: 'Research', icon: Globe },
  { id: 'writer', label: 'Writer', icon: PenTool },
  { id: 'images', label: 'Image Studio', icon: ImageIcon },
  { id: 'video', label: 'Video Studio', icon: Film },
  { id: 'code', label: 'Code Studio', icon: Code2 },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'media', label: 'Music & Audio', icon: Music },
  { id: 'maps', label: 'Maps Explorer', icon: MapPin },
  { id: 'studio3d', label: '3D Studio', icon: Box },
  { id: 'game', label: '3D Arcade', icon: Gamepad2 },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferLanguage(filePath: string): string {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.ts')) return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (filePath.endsWith('.js')) return 'js';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.html')) return 'html';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown';
  return 'text';
}

export default function App() {
  // Auth & Sync
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Studio Navigation & Layout
  const [activeModule, setActiveModule] = useState<StudioModule>('assistant');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [theme, setTheme] = useState<StudioTheme>({
    canvas: 'charcoal',
    accent: 'blue',
    distractionFree: false,
  });

  // Providers & Model Routing
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.1-flash-lite');
  const [autoRoute, setAutoRoute] = useState(true);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);

  // Projects & Conversations
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    makeId('conv')
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');
  const [pendingConfirmDelete, setPendingConfirmDelete] = useState<{
    projectId: string;
    title: string;
  } | null>(null);

  // App Builder State
  const [isBuildingApp, setIsBuildingApp] = useState(false);
  const [architectureNotes, setArchitectureNotes] = useState('');
  const [schemaNotes, setSchemaNotes] = useState('');
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [agentMessages, setAgentMessages] = useState<BuilderAgentMessage[]>([]);
  const [liveAgentSteps, setLiveAgentSteps] = useState<AgentActivityStep[]>([]);
  const [builderVerification, setBuilderVerification] =
    useState<SandboxVerificationResult | null>(null);
  const [projectEnvVars, setProjectEnvVars] = useState<ProjectEnvVar[]>([]);

  // Research State
  const [researchQuery, setResearchQuery] = useState('');
  const [researchMarkdown, setResearchMarkdown] = useState('');
  const [researchSources, setResearchSources] = useState<SourceLink[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState('');

  // Writer State
  const [writerTopic, setWriterTopic] = useState('');
  const [writerContent, setWriterContent] = useState('');
  const [writerLoading, setWriterLoading] = useState(false);
  const [writerError, setWriterError] = useState('');

  // Image Studio State
  const [imageGallery, setImageGallery] = useState<GeneratedImageItem[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');

  // Video Studio State
  const [videoGallery, setVideoGallery] = useState<GeneratedVideoItem[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [prefilledVideoSource, setPrefilledVideoSource] =
    useState<PrefilledVideoSource | null>(null);

  // Code Studio State
  const [codeSnippet, setCodeSnippet] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('typescript');

  // Document Studio State
  const [activeDoc, setActiveDoc] = useState<GeneratedDocument | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState('');

  // Media Player & Lyria AI Music State
  const [mediaQueue, setMediaQueue] = useState<MediaTrack[]>([]);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [savedPlaylist, setSavedPlaylist] = useState<MediaTrack[]>([]);
  const [mediaSearching, setMediaSearching] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [lyriaTracks, setLyriaTracks] = useState<GeneratedMusicItem[]>([]);
  const [lyriaGenerating, setLyriaGenerating] = useState(false);
  const [lyriaError, setLyriaError] = useState('');

  // Maps, 3D Studio & Game State
  const [mapsQuery, setMapsQuery] = useState('');
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [studio3dPreset, setStudio3dPreset] = useState('observatory');
  const [gameDifficulty, setGameDifficulty] = useState('standard');

  // Voice & Gemini Live Audio State
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [continuousVoice, setContinuousVoice] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>(CURATED_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('studio-butler');
  const recognizerRef = useRef<SpeechRecognizerHandle | null>(null);
  const [liveState, setLiveState] = useState<LiveConnectionState>('disconnected');
  const [liveInputTranscript, setLiveInputTranscript] = useState('');
  const [liveOutputTranscript, setLiveOutputTranscript] = useState('');
  const liveClientRef = useRef<GeminiLiveAudioClient | null>(null);

  // Running Tasks & System Activity
  const [runningTasks, setRunningTasks] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<SystemActivityItem[]>([]);

  const logActivity = useCallback(
    (label: string, detail: string, status: SystemActivityItem['status'] = 'completed') => {
      setActivityLog((prev) => [
        {
          id: makeId('act'),
          label,
          detail,
          status,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 29),
      ]);
    },
    []
  );

  const pushTask = useCallback((name: string) => {
    setRunningTasks((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }, []);

  const popTask = useCallback((name: string) => {
    setRunningTasks((prev) => prev.filter((t) => t !== name));
  }, []);

  // Active Project reference
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  // Refresh Providers
  const refreshProviders = useCallback(async () => {
    try {
      const resp = await fetch('/api/providers');
      if (resp.ok) {
        const data = (await resp.json()) as { providers: ProviderStatus[] };
        setProviders(data.providers || []);
      }
    } catch {
      // Network retry handled on demand
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    if (providers.length === 0 || selectedProvider === 'auto') return;
    const matched = providers.find((p) => p.id === selectedProvider);
    if (!matched) {
      setSelectedProvider('auto');
      setSelectedModel('gemini-3.1-flash-lite');
      return;
    }
    if (!matched.models.some((m) => m.id === selectedModel) && matched.models[0]) {
      setSelectedModel(matched.models[0].id);
    }
  }, [providers, selectedModel, selectedProvider]);

  // Voices & Maps Quota Listener initialization
  useEffect(() => {
    const syncVoices = () => setVoices(getAvailableVoices());
    syncVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = syncVoices;
    }
    const unsubSpeak = voiceController.onSpeakingChange((val) => {
      setSpeaking(val);
    });
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);

    return () => {
      unsubSpeak();
      recognizerRef.current?.stop();
      liveClientRef.current?.disconnect();
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
    };
  }, []);

  // Firebase Auth & Real-Time Subscriptions
  useEffect(() => {
    let unsubDb: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (unsubDb) {
        unsubDb();
        unsubDb = null;
      }
      if (nextUser) {
        try {
          await upsertUserProfile(nextUser, {
            preferredVoice: selectedVoiceId,
            defaultProvider: selectedProvider,
            defaultModel: selectedModel,
          });
          unsubDb = subscribeUserCollections(nextUser.uid, {
            onProjects: (cloudProjects) => {
              setProjects((prev) => {
                const map = new Map(prev.map((p) => [p.id, p]));
                return cloudProjects.map((cp) => {
                  const existing = map.get(cp.id);
                  return existing && existing.files.length > 0
                    ? { ...cp, files: existing.files, versions: existing.versions }
                    : cp;
                });
              });
            },
            onConversations: (cloudConvs) => {
              setConversations(cloudConvs);
            },
            onPlaylists: (cloudTracks) => {
              setSavedPlaylist(cloudTracks);
            },
          });
          logActivity('Account Synced', nextUser.email || 'Signed in with Google');
        } catch (err) {
          logActivity(
            'Sync Notice',
            err instanceof Error ? err.message : 'Unable to sync workspace',
            'error'
          );
        }
      }
    });

    return () => {
      unsubAuth();
      if (unsubDb) unsubDb();
    };
  }, [logActivity, selectedModel, selectedProvider, selectedVoiceId]);

  const persistProject = useCallback(
    (proj: StudioProject) => {
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === proj.id);
        return exists
          ? prev.map((p) => (p.id === proj.id ? proj : p))
          : [proj, ...prev];
      });
      setActiveProjectId(proj.id);
      if (user) {
        void saveProjectToFirestore(user.uid, proj).catch((err) => {
          logActivity(
            'Cloud Save Error',
            err instanceof Error ? err.message : 'Save failed',
            'error'
          );
        });
      }
    },
    [logActivity, user]
  );

  // Autonomous App Builder Agent handler (SSE: Inspect -> Plan -> Generate -> Install -> Verify -> Auto-Fix)
  const handleBuildOrEditApp = useCallback(
    async (
      prompt: string,
      errorLog?: string,
      forceMode?: 'create' | 'edit',
      preferredTitle?: string
    ) => {
      const taskLabel = 'Building Application';
      pushTask(taskLabel);
      setIsBuildingApp(true);
      setActiveModule('builder');
      setLiveAgentSteps([]);

      const currentTarget =
        forceMode === 'create'
          ? null
          : activeProject?.type === 'app'
            ? activeProject
            : null;

      const userAgentMsg: BuilderAgentMessage = {
        id: makeId('ag_u'),
        role: 'user',
        content: prompt,
        createdAt: Date.now(),
      };
      setAgentMessages((prev) => [...prev.slice(-24), userAgentMsg]);

      const collectedSteps: AgentActivityStep[] = [];

      try {
        const resp = await fetch('/api/builder/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            projectId: currentTarget?.id || makeId('proj_sbx'),
            projectTitle: preferredTitle || currentTarget?.title,
            existingFiles: currentTarget?.files || [],
            errorLog,
            provider: selectedProvider,
            model: selectedModel,
            fallbackEnabled,
          }),
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`App Builder Agent HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        interface AgentDonePayload {
          title?: string;
          description?: string;
          summary?: string;
          architecture?: string;
          databaseSchema?: string;
          buildLogs?: string[];
          files?: StudioFile[];
          changedFiles?: string[];
          verification?: SandboxVerificationResult;
          usedProvider?: string;
          usedModel?: string;
          latencyMs?: number;
          fallbackNote?: string;
        }

        const streamResult: {
          donePayload: AgentDonePayload | null;
          streamError: string;
        } = {
          donePayload: null,
          streamError: '',
        };

        const handleBlock = (block: string) => {
          const lines = block.split('\n');
          let eventName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) return;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataStr) as Record<string, unknown>;
          } catch {
            return;
          }

          if (eventName === 'step') {
            const phase = String(payload.phase || 'plan') as AgentActivityStep['phase'];
            const status = String(payload.status || 'running') as AgentActivityStep['status'];
            const label = String(payload.label || 'Working...');
            const detail = typeof payload.detail === 'string' ? payload.detail : undefined;

            const existingIdx = collectedSteps.findIndex(
              (s) => s.phase === phase && s.status === 'running'
            );
            if (existingIdx >= 0 && status !== 'running') {
              collectedSteps[existingIdx] = {
                ...collectedSteps[existingIdx],
                status,
                label,
                detail,
                timestamp: Date.now(),
              };
            } else {
              collectedSteps.push({
                id: makeId('step'),
                phase,
                status,
                label,
                detail,
                timestamp: Date.now(),
              });
            }
            setLiveAgentSteps([...collectedSteps]);
          } else if (eventName === 'done') {
            streamResult.donePayload = payload as AgentDonePayload;
          } else if (eventName === 'error') {
            streamResult.streamError = String(payload.error || 'App Builder Agent failed.');
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (part.trim()) handleBlock(part);
          }
        }
        if (buffer.trim()) handleBlock(buffer);

        const donePayload = streamResult.donePayload;
        if (streamResult.streamError || !donePayload || !Array.isArray(donePayload.files)) {
          throw new Error(
            streamResult.streamError || 'App Builder agent did not produce project files.'
          );
        }

        const now = Date.now();
        const nextFiles: StudioFile[] = donePayload.files.map((f) => ({
          id: f.id || makeId('file'),
          path: f.path.replace(/^\.?\//, ''),
          language: f.language || inferLanguage(f.path),
          content: f.content,
          updatedAt: now,
        }));

        const nextVersionNum = (currentTarget?.activeVersion || 0) + 1;
        const nextVersion = {
          id: makeId('ver'),
          versionNumber: nextVersionNum,
          summary: donePayload.summary || prompt.slice(0, 80),
          files: nextFiles.map((f) => ({ ...f })),
          createdAt: now,
        };

        const updatedProject: StudioProject = currentTarget
          ? {
              ...currentTarget,
              description: donePayload.description || currentTarget.description,
              files: nextFiles,
              versions: [...currentTarget.versions, nextVersion],
              activeVersion: nextVersionNum,
              updatedAt: now,
            }
          : {
              id: makeId('proj'),
              title: donePayload.title || preferredTitle || 'SCOPE-X App',
              description: donePayload.description || prompt.slice(0, 140),
              type: 'app',
              files: nextFiles,
              versions: [nextVersion],
              activeVersion: 1,
              createdAt: now,
              updatedAt: now,
            };

        persistProject(updatedProject);
        setArchitectureNotes(donePayload.architecture || '');
        setSchemaNotes(donePayload.databaseSchema || '');
        setBuildLogs(donePayload.buildLogs || ['Compiled and verified sandbox bundle']);
        setBuilderVerification(donePayload.verification || null);

        setAgentMessages((prev) => [
          ...prev.slice(-24),
          {
            id: makeId('ag_a'),
            role: 'assistant',
            content:
              donePayload.verification?.passed
                ? `${donePayload.summary || 'Application updated'} — verified cleanly (${donePayload.verification.compiledFiles} modules).`
                : `${donePayload.summary || 'Files updated'} (${donePayload.verification?.errors.length || 0} build notice(s)).`,
            provider: donePayload.usedProvider,
            model: donePayload.usedModel,
            steps: [...collectedSteps],
            changedFiles: donePayload.changedFiles,
            buildPassed: donePayload.verification?.passed,
            createdAt: Date.now(),
          },
        ]);

        logActivity(
          currentTarget ? 'App Updated' : 'App Built',
          `${updatedProject.title} (v${updatedProject.activeVersion}) via ${donePayload.usedProvider}`
        );
        void refreshProviders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'App Builder error.';
        setBuildLogs((prev) => [...prev, `Error: ${msg}`]);
        setAgentMessages((prev) => [
          ...prev.slice(-24),
          {
            id: makeId('ag_err'),
            role: 'assistant',
            content: `Agent encountered an error: ${msg}`,
            steps: [...collectedSteps],
            buildPassed: false,
            createdAt: Date.now(),
          },
        ]);
        logActivity('App Build Failed', msg, 'error');
      } finally {
        setIsBuildingApp(false);
        popTask(taskLabel);
      }
    },
    [
      activeProject,
      fallbackEnabled,
      logActivity,
      persistProject,
      popTask,
      pushTask,
      refreshProviders,
      selectedModel,
      selectedProvider,
    ]
  );

  // Research handler
  const handleRunResearch = useCallback(
    async (query: string, includeComparison: boolean) => {
      pushTask('Running Web Research');
      setResearchQuery(query);
      setResearchLoading(true);
      setResearchError('');
      setActiveModule('research');
      try {
        const resp = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, includeComparison }),
        });
        const data = (await resp.json()) as {
          markdown?: string;
          sources?: SourceLink[];
          error?: string;
        };
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Research request failed.');
        }
        setResearchMarkdown(data.markdown || '');
        setResearchSources(data.sources || []);
        logActivity('Research Complete', `${query} (${data.sources?.length || 0} sources)`);
        void refreshProviders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Research failed.';
        setResearchError(msg);
        logActivity('Research Failed', msg, 'error');
      } finally {
        setResearchLoading(false);
        popTask('Running Web Research');
      }
    },
    [logActivity, popTask, pushTask, refreshProviders]
  );

  // Writer handler
  const handleGenerateWriting = useCallback(
    async (params: { topic: string; format: string; tone: string; length: string }) => {
      pushTask('Generating Draft');
      setWriterTopic(params.topic);
      setWriterLoading(true);
      setWriterError('');
      setActiveModule('writer');
      try {
        const resp = await fetch('/api/writer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            provider: selectedProvider,
            model: selectedModel,
            fallbackEnabled,
          }),
        });
        const data = (await resp.json()) as { text?: string; error?: string };
        if (!resp.ok || data.error) throw new Error(data.error || 'Writer failed.');
        setWriterContent(data.text || '');
        logActivity('Draft Generated', `${params.format}: ${params.topic.slice(0, 48)}`);
        void refreshProviders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Writer failed.';
        setWriterError(msg);
      } finally {
        setWriterLoading(false);
        popTask('Generating Draft');
      }
    },
    [
      fallbackEnabled,
      logActivity,
      popTask,
      pushTask,
      refreshProviders,
      selectedModel,
      selectedProvider,
    ]
  );

  // Image Studio handler
  const handleGenerateImage = useCallback(
    async (params: {
      prompt: string;
      aspectRatio: string;
      imageSize?: '1K' | '2K' | '4K';
      provider?: ImageEngineProvider;
      model?: string;
      enableSearch?: boolean;
      enhancePrompt?: boolean;
      sourceImageBase64?: string;
      sourceMimeType?: string;
    }) => {
      pushTask('Generating Image');
      setImageLoading(true);
      setImageError('');
      setActiveModule('images');
      try {
        const resp = await fetch('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            fallbackEnabled,
          }),
        });
        const data = (await resp.json()) as {
          imageUrl?: string;
          model?: string;
          provider?: 'pollinations' | 'gemini';
          enhancedPrompt?: string;
          fallbackNote?: string;
          latencyMs?: number;
          error?: string;
        };
        if (!resp.ok || data.error || !data.imageUrl) {
          throw new Error(data.error || 'Image generation failed.');
        }
        setImageGallery((prev) => [
          {
            id: makeId('img'),
            prompt: params.prompt,
            enhancedPrompt: data.enhancedPrompt,
            imageUrl: data.imageUrl!,
            model: data.model || params.model || 'black-forest-labs/flux.1.1-pro',
            provider: data.provider,
            fallbackNote: data.fallbackNote,
            aspectRatio: params.aspectRatio,
            latencyMs: data.latencyMs,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        logActivity(
          'Image Created',
          `${data.model || 'image'} · ${params.prompt.slice(0, 40)}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Image generation failed.';
        setImageError(msg);
        logActivity('Image Generation Notice', msg, 'error');
      } finally {
        setImageLoading(false);
        popTask('Generating Image');
      }
    },
    [fallbackEnabled, logActivity, popTask, pushTask]
  );

  // Video Studio handler (Text-to-Video & Image-to-Video)
  const handleGenerateVideo = useCallback(
    async (params: {
      prompt: string;
      aspectRatio: '16:9' | '9:16';
      duration: number;
      sourceImageBase64?: string;
      sourceMimeType?: string;
    }) => {
      pushTask('Rendering Video');
      setVideoLoading(true);
      setVideoError('');
      setActiveModule('video');
      try {
        const resp = await fetch('/api/video/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = (await resp.json()) as {
          videoUrl?: string;
          aspectRatio?: '16:9' | '9:16';
          model?: string;
          sourceImageUsed?: boolean;
          error?: string;
        };
        if (!resp.ok || data.error || !data.videoUrl) {
          throw new Error(data.error || 'Video generation failed.');
        }
        setVideoGallery((prev) => [
          {
            id: makeId('vid'),
            prompt: params.prompt,
            videoUrl: data.videoUrl!,
            aspectRatio: data.aspectRatio || params.aspectRatio,
            model: data.model || 'gemini-omni-1.2-flash',
            sourceImageUsed: data.sourceImageUsed,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        logActivity('Video Generated', params.prompt.slice(0, 50));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Video generation failed.';
        setVideoError(msg);
        logActivity('Video Generation Notice', msg, 'error');
      } finally {
        setVideoLoading(false);
        popTask('Rendering Video');
      }
    },
    [logActivity, popTask, pushTask]
  );

  // Lyria Music Studio handler
  const handleGenerateMusic = useCallback(
    async (params: {
      prompt: string;
      title?: string;
      tier: 'clip' | 'pro';
      referenceImageBase64?: string;
      referenceMimeType?: string;
    }) => {
      pushTask('Composing Music');
      setLyriaGenerating(true);
      setLyriaError('');
      setActiveModule('media');
      try {
        const resp = await fetch('/api/music/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = (await resp.json()) as {
          audioDataUrl?: string;
          lyrics?: string;
          model?: string;
          tier?: 'clip' | 'pro';
          title?: string;
          error?: string;
        };
        if (!resp.ok || data.error || !data.audioDataUrl) {
          throw new Error(data.error || 'Music composition failed.');
        }
        setLyriaTracks((prev) => [
          {
            id: makeId('lyria'),
            prompt: params.prompt,
            title: data.title || params.title || params.prompt.slice(0, 48),
            audioDataUrl: data.audioDataUrl!,
            lyrics: data.lyrics || '',
            model:
              data.model ||
              (params.tier === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview'),
            tier: data.tier || params.tier,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        logActivity('Music Composed', params.prompt.slice(0, 50));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Music composition failed.';
        setLyriaError(msg);
        logActivity('Lyria Music Notice', msg, 'error');
      } finally {
        setLyriaGenerating(false);
        popTask('Composing Music');
      }
    },
    [logActivity, popTask, pushTask]
  );

  // Document Studio handler
  const handleGenerateDocument = useCallback(
    async (params: {
      topic: string;
      kind: 'presentation' | 'document';
      slideCount: number;
    }) => {
      pushTask('Building Document');
      setDocLoading(true);
      setDocError('');
      setActiveModule('documents');
      try {
        const resp = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            provider: selectedProvider,
            model: selectedModel,
            fallbackEnabled,
          }),
        });
        const data = (await resp.json()) as {
          kind?: 'presentation' | 'document';
          title?: string;
          subtitle?: string;
          content?: string;
          slides?: GeneratedDocument['slides'];
          error?: string;
        };
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Document generation failed.');
        }
        const docItem: GeneratedDocument = {
          id: makeId('doc'),
          kind: data.kind || params.kind,
          title: data.title || params.topic,
          subtitle: data.subtitle || 'SCOPE-X Document Studio',
          content: data.content || '',
          slides: data.slides || [],
          createdAt: Date.now(),
        };
        setActiveDoc(docItem);
        logActivity('Document Built', docItem.title);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Document generation failed.';
        setDocError(msg);
      } finally {
        setDocLoading(false);
        popTask('Building Document');
      }
    },
    [fallbackEnabled, logActivity, popTask, pushTask, selectedModel, selectedProvider]
  );

  // Media Search handler
  const handleSearchMedia = useCallback(
    async (query: string) => {
      pushTask('Searching Music');
      setMediaSearching(true);
      setMediaError('');
      setActiveModule('media');
      try {
        const resp = await fetch(`/api/media/search?q=${encodeURIComponent(query)}`);
        const data = (await resp.json()) as { tracks?: MediaTrack[]; error?: string };
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Music search failed.');
        }
        const tracks = data.tracks || [];
        if (tracks.length === 0) {
          setMediaError(`No tracks found for "${query}". Try another song or artist.`);
        } else {
          setMediaQueue(tracks);
          setMediaIndex(0);
          setAutoPlaySignal((s) => s + 1);
          logActivity('Media Loaded', `${tracks[0].title} — ${tracks[0].artist}`);
        }
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : 'Music search failed.');
      } finally {
        setMediaSearching(false);
        popTask('Searching Music');
      }
    },
    [logActivity, popTask, pushTask]
  );

  // Speak response helper
  const speakText = useCallback(
    async (text: string, overrideVoiceId?: string) => {
      if (muted) return;
      const vid = overrideVoiceId || selectedVoiceId;
      const voice = voices.find((v) => v.id === vid) || CURATED_VOICES[0];
      await voiceController.speak(text, voice);
    },
    [muted, selectedVoiceId, voices]
  );

  // Toggle Voice Listening
  const toggleListening = useCallback(() => {
    if (listening) {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      setInterimTranscript('');
      return;
    }

    if (!isSpeechRecognitionSupported()) {
      logActivity(
        'Voice Unavailable',
        'Web Speech Recognition is not supported in this browser.',
        'error'
      );
      return;
    }

    // Voice interruption: stop assistant speaking immediately when user engages mic
    voiceController.stopSpeaking();
    setVoiceOpen(true);
    setListening(true);

    const handle = startLiveSpeechRecognition({
      onInterim: (txt) => {
        voiceController.stopSpeaking();
        setInterimTranscript(txt);
      },
      onFinal: (finalText) => {
        setInterimTranscript('');
        if (!continuousVoice) {
          handle?.stop();
          recognizerRef.current = null;
          setListening(false);
        }
        void sendAssistantMessageRef.current(finalText, [], true);
      },
      onError: (err) => {
        setListening(false);
        setInterimTranscript('');
        logActivity('Voice Input Notice', err, 'error');
      },
      onEnd: () => {
        setListening(false);
        setInterimTranscript('');
      },
    });

    recognizerRef.current = handle;
  }, [continuousVoice, listening, logActivity]);

  // Toggle Gemini 3.8 Live Bidirectional Voice
  const handleToggleLiveSession = useCallback(async () => {
    if (liveState === 'connected' || liveState === 'connecting') {
      liveClientRef.current?.disconnect();
      setLiveState('disconnected');
      setLiveInputTranscript('');
      setLiveOutputTranscript('');
      return;
    }

    recognizerRef.current?.stop();
    setListening(false);
    voiceController.stopSpeaking();
    setVoiceOpen(true);

    if (!liveClientRef.current) {
      liveClientRef.current = new GeminiLiveAudioClient();
    }

    const client = liveClientRef.current;
    client.setMuted(muted);
    client.updateCallbacks({
      onStateChange: (st) => setLiveState(st),
      onInputTranscript: (txt) =>
        setLiveInputTranscript((prev) => (prev ? `${prev} ${txt}` : txt)),
      onOutputTranscript: (txt) =>
        setLiveOutputTranscript((prev) => `${prev}${txt}`),
      onTurnComplete: () => {
        setTimeout(() => {
          setLiveInputTranscript('');
          setLiveOutputTranscript('');
        }, 2500);
      },
      onInterrupted: () => {
        setLiveOutputTranscript('');
      },
      onSpeakingChange: (sp) => setSpeaking(sp),
      onError: (err) => {
        logActivity('Live Voice Notice', err, 'error');
      },
    });

    const chosen = voices.find((v) => v.id === selectedVoiceId) || CURATED_VOICES[0];
    await client.connect(chosen.geminiVoiceName || 'Charon');
    logActivity('Live Voice', 'Connected to gemini-3.8-live');
  }, [liveState, logActivity, muted, selectedVoiceId, voices]);

  // Central AI Assistant SSE stream
  const sendAssistantMessage = useCallback(
    async (
      text: string,
      attachments: ChatAttachment[] = [],
      fromVoice = false
    ) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;

      const userMsg: ChatMessage = {
        id: makeId('msg'),
        role: 'user',
        content: trimmed,
        attachments,
        createdAt: Date.now(),
      };

      const assistantMsgId = makeId('msg');
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolActions: [],
        createdAt: Date.now(),
      };

      const nextMessages = [...messages, userMsg, assistantPlaceholder];
      setMessages(nextMessages);
      setIsStreaming(true);
      setAssistantStatus('Analyzing request...');
      pushTask('AI Assistant');

      const currentConvId = activeConversationId;
      const convTitle =
        messages.length === 0 ? trimmed.slice(0, 60) || 'New Session' : undefined;
      if (user) {
        void saveConversationMetaToFirestore(user.uid, {
          id: currentConvId,
          title: convTitle || 'SCOPE-X Session',
          projectId: activeProject?.id || '',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        void appendMessageToFirestore(user.uid, currentConvId, userMsg);
      }

      let finalAssistantText = '';
      let finalProvider = '';
      let finalModel = '';
      const collectedActions: ToolAction[] = [];

      try {
        const resp = await fetch('/api/assistant/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history: messages.slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            provider: selectedProvider,
            model: selectedModel,
            fallbackEnabled,
            activeModule,
            activeProject: activeProject
              ? {
                  title: activeProject.title,
                  type: activeProject.type,
                  filePaths: activeProject.files.map((f) => f.path),
                }
              : null,
            attachments: attachments.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              textPreview: a.textPreview,
              base64Data: a.base64Data,
            })),
          }),
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`Assistant HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processEventBlock = (block: string) => {
          const lines = block.split('\n');
          let eventName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) return;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataStr) as Record<string, unknown>;
          } catch {
            return;
          }

          if (eventName === 'status') {
            setAssistantStatus(String(payload.step || 'Working...'));
          } else if (eventName === 'tool') {
            const toolName = String(payload.name || '');
            const args = (payload.args || {}) as Record<string, unknown>;
            const result = (payload.result || {}) as Record<string, unknown>;
            const actionId = String(payload.id || makeId('tool'));
            let summary = `Executed ${toolName}`;
            let targetModule: StudioModule | undefined;

            // Real Studio Control Execution
            if (toolName === 'navigate_module' && typeof args.module === 'string') {
              targetModule = args.module as StudioModule;
              setActiveModule(targetModule);
              summary = `Opened ${targetModule} studio`;
            } else if (toolName === 'create_or_update_app') {
              targetModule = 'builder';
              const mode = args.mode === 'edit' ? 'edit' : 'create';
              summary =
                mode === 'edit'
                  ? 'Updating active app in App Builder'
                  : `Building "${String(args.projectTitle || 'App')}" in App Builder`;
              void handleBuildOrEditApp(
                String(args.prompt || trimmed),
                undefined,
                mode,
                typeof args.projectTitle === 'string' ? args.projectTitle : undefined
              );
            } else if (toolName === 'run_research') {
              targetModule = 'research';
              summary = `Researching: ${String(args.query || trimmed)}`;
              void handleRunResearch(
                String(args.query || trimmed),
                args.includeComparison !== false
              );
            } else if (toolName === 'generate_writing') {
              targetModule = 'writer';
              summary = `Drafting ${String(args.format || 'article')}`;
              void handleGenerateWriting({
                topic: String(args.topic || trimmed),
                format: String(args.format || 'article'),
                tone: 'editorial',
                length: 'medium',
              });
            } else if (toolName === 'generate_image') {
              targetModule = 'images';
              summary = 'Generating image in Image Studio';
              void handleGenerateImage({
                prompt: String(args.prompt || trimmed),
                aspectRatio: String(args.aspectRatio || '1:1'),
              });
            } else if (toolName === 'generate_document') {
              targetModule = 'documents';
              const kind = args.kind === 'document' ? 'document' : 'presentation';
              summary = `Creating ${kind} in Document Studio`;
              void handleGenerateDocument({
                topic: String(args.topic || trimmed),
                kind,
                slideCount: 7,
              });
            } else if (toolName === 'play_media') {
              targetModule = 'media';
              const tracks = (result.tracks as MediaTrack[]) || [];
              if (tracks.length > 0) {
                setMediaQueue(tracks);
                setMediaIndex(0);
                setAutoPlaySignal((s) => s + 1);
                setActiveModule('media');
                summary = `Playing "${tracks[0].title}" by ${tracks[0].artist}`;
              } else {
                setActiveModule('media');
                summary = `Searched media for "${String(args.query || '')}"`;
              }
            } else if (toolName === 'update_studio_theme') {
              setTheme((prev) => ({
                ...prev,
                ...(args.canvas === 'charcoal' ||
                args.canvas === 'obsidian' ||
                args.canvas === 'midnight'
                  ? { canvas: args.canvas }
                  : {}),
                ...(args.accent === 'blue' ||
                args.accent === 'violet' ||
                args.accent === 'cyan'
                  ? { accent: args.accent }
                  : {}),
              }));
              summary = 'Updated SCOPE-X studio theme';
            } else if (toolName === 'manage_project') {
              const act = String(args.action || '');
              if (act === 'create') {
                const newProj: StudioProject = {
                  id: makeId('proj'),
                  title: String(args.title || 'New Studio Project'),
                  description: 'Created via AI Assistant',
                  type: 'app',
                  files: [],
                  versions: [],
                  activeVersion: 1,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                persistProject(newProj);
                summary = `Created project "${newProj.title}"`;
              } else if (act === 'rename' && activeProject && args.title) {
                persistProject({
                  ...activeProject,
                  title: String(args.title),
                  updatedAt: Date.now(),
                });
                summary = `Renamed project to "${String(args.title)}"`;
              } else if (act === 'request_delete' && activeProject) {
                setPendingConfirmDelete({
                  projectId: activeProject.id,
                  title: activeProject.title,
                });
                summary = `Confirmation requested to delete "${activeProject.title}"`;
              }
            } else if (toolName === 'toggle_voice_mode') {
              const active = Boolean(args.active);
              setVoiceOpen(active);
              if (active && !listening) toggleListening();
              if (!active && listening) toggleListening();
              summary = active ? 'Activated voice interaction' : 'Stopped voice interaction';
            } else if (toolName === 'generate_video') {
              targetModule = 'video';
              summary = 'Synthesizing video in Video Studio';
              void handleGenerateVideo({
                prompt: String(args.prompt || trimmed),
                aspectRatio: args.aspectRatio === '9:16' ? '9:16' : '16:9',
                duration: 5,
              });
            } else if (toolName === 'generate_music') {
              targetModule = 'media';
              summary = 'Composing original audio track with Lyria';
              void handleGenerateMusic({
                prompt: String(args.prompt || trimmed),
                tier: args.tier === 'pro' ? 'pro' : 'clip',
              });
            } else if (toolName === 'maps_grounding') {
              targetModule = 'maps';
              const q = String(args.query || trimmed);
              setMapsQuery(q);
              setActiveModule('maps');
              summary = `Exploring Maps for "${q}"`;
            } else if (toolName === 'open_3d_studio') {
              targetModule = 'studio3d';
              const preset =
                typeof args.preset === 'string' ? args.preset : 'observatory';
              setStudio3dPreset(preset);
              setActiveModule('studio3d');
              summary = `Opened 3D Studio (${preset})`;
            } else if (toolName === 'launch_game') {
              targetModule = 'game';
              const diff = args.difficulty === 'hyperdrive' ? 'hyperdrive' : 'standard';
              setGameDifficulty(diff);
              setActiveModule('game');
              summary = `Launched AEGIS INTERCEPT (${diff})`;
            }

            const actionItem: ToolAction = {
              id: actionId,
              tool: toolName,
              status: 'completed',
              summary,
              payload: targetModule ? { module: targetModule } : undefined,
            };
            collectedActions.push(actionItem);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, toolActions: [...collectedActions] }
                  : m
              )
            );
            logActivity('Assistant Tool', summary);
          } else if (eventName === 'chunk') {
            const delta = String(payload.text || '');
            finalAssistantText += delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: finalAssistantText } : m
              )
            );
          } else if (eventName === 'done') {
            finalProvider = String(payload.provider || '');
            finalModel = String(payload.model || '');
            const fallbackNote =
              typeof payload.fallbackNote === 'string' && payload.fallbackNote
                ? payload.fallbackNote
                : undefined;
            if (fallbackNote) {
              logActivity('Fallback Routed', fallbackNote);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      provider: finalProvider,
                      model: finalModel,
                      fallbackNote,
                    }
                  : m
              )
            );
          } else if (eventName === 'error') {
            const errMsg = String(payload.error || 'Provider error.');
            finalAssistantText = `I encountered an issue: ${errMsg}`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: finalAssistantText } : m
              )
            );
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (part.trim()) processEventBlock(part);
          }
        }
        if (buffer.trim()) processEventBlock(buffer);

        if (user && finalAssistantText) {
          void appendMessageToFirestore(user.uid, currentConvId, {
            id: assistantMsgId,
            role: 'assistant',
            content: finalAssistantText,
            provider: finalProvider,
            model: finalModel,
            toolActions: collectedActions,
            createdAt: Date.now(),
          });
        }

        if (fromVoice && finalAssistantText && !muted) {
          await speakText(finalAssistantText);
        }
        void refreshProviders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Assistant request failed.';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Unable to complete request: ${msg}` }
              : m
          )
        );
        logActivity('Assistant Error', msg, 'error');
      } finally {
        setIsStreaming(false);
        setAssistantStatus('');
        popTask('AI Assistant');
      }
    },
    [
      activeConversationId,
      activeModule,
      activeProject,
      fallbackEnabled,
      handleBuildOrEditApp,
      handleGenerateDocument,
      handleGenerateImage,
      handleGenerateMusic,
      handleGenerateVideo,
      handleGenerateWriting,
      handleRunResearch,
      listening,
      logActivity,
      messages,
      muted,
      persistProject,
      popTask,
      pushTask,
      refreshProviders,
      selectedModel,
      selectedProvider,
      speakText,
      toggleListening,
      user,
    ]
  );

  const sendAssistantMessageRef = useRef(sendAssistantMessage);
  useEffect(() => {
    sendAssistantMessageRef.current = sendAssistantMessage;
  }, [sendAssistantMessage]);

  // Project Management Helpers
  const handleCreateProject = (title: string, type: ProjectType) => {
    const now = Date.now();
    const initialFiles: StudioFile[] =
      type === 'app'
        ? [
            {
              id: makeId('file'),
              path: 'src/App.tsx',
              language: 'tsx',
              content: `import React, { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">\n      <div className="text-center space-y-4">\n        <h1 className="text-3xl font-bold">${title}</h1>\n        <p className="text-slate-400">Ready for AI-assisted editing in SCOPE-X.</p>\n        <button onClick={() => setCount(c => c + 1)} className="px-4 py-2 bg-blue-600 rounded-lg">\n          Interactions: {count}\n        </button>\n      </div>\n    </div>\n  );\n}\n`,
              updatedAt: now,
            },
          ]
        : [];
    const proj: StudioProject = {
      id: makeId('proj'),
      title,
      description: `${type} workspace created in SCOPE-X`,
      type,
      files: initialFiles,
      versions:
        initialFiles.length > 0
          ? [
              {
                id: makeId('ver'),
                versionNumber: 1,
                summary: 'Initial template',
                files: initialFiles,
                createdAt: now,
              },
            ]
          : [],
      activeVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    persistProject(proj);
    setActiveModule(type === 'app' ? 'builder' : 'projects');
    logActivity('Project Created', title);
  };

  const handleOpenProject = async (proj: StudioProject) => {
    setActiveProjectId(proj.id);
    if (user && proj.files.length === 0) {
      try {
        const details = await loadProjectDetailsFromFirestore(proj.id);
        setProjects((prev) =>
          prev.map((p) =>
            p.id === proj.id
              ? { ...p, files: details.files, versions: details.versions }
              : p
          )
        );
      } catch (err) {
        logActivity(
          'Load Error',
          err instanceof Error ? err.message : 'Unable to load project files',
          'error'
        );
      }
    }
    if (proj.type === 'app') setActiveModule('builder');
    else if (proj.type === 'code') {
      setCodeSnippet(proj.files[0]?.content || '');
      setCodeLanguage(proj.files[0]?.language || 'typescript');
      setActiveModule('code');
    } else if (proj.type === 'writer') {
      setWriterContent(proj.files[0]?.content || '');
      setActiveModule('writer');
    } else if (proj.type === 'research') {
      setResearchMarkdown(proj.files[0]?.content || '');
      setActiveModule('research');
    } else {
      setActiveModule('builder');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) setActiveProjectId(null);
    if (user) {
      await deleteProjectFromFirestore(projectId);
    }
    logActivity('Project Deleted', projectId);
  };

  const handleOpenConversation = async (conv: ConversationThread) => {
    setActiveConversationId(conv.id);
    setActiveModule('assistant');
    if (user) {
      try {
        const loaded = await loadConversationMessagesFromFirestore(conv.id);
        setMessages(loaded);
      } catch (err) {
        logActivity(
          'Load Error',
          err instanceof Error ? err.message : 'Unable to load messages',
          'error'
        );
      }
    }
  };

  const handleNewConversation = () => {
    setActiveConversationId(makeId('conv'));
    setMessages([]);
    setActiveModule('assistant');
  };

  // Theme classes
  const canvasBgClass =
    theme.canvas === 'obsidian'
      ? 'bg-[#030406]'
      : theme.canvas === 'midnight'
        ? 'bg-[#060914]'
        : 'bg-[#07090E]';

  const activeNavClass =
    theme.accent === 'violet'
      ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
      : theme.accent === 'cyan'
        ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'
        : 'bg-blue-600/20 text-blue-300 border border-blue-500/30';

  return (
    <ErrorBoundary>
      <div className={`h-screen w-full flex flex-col overflow-hidden text-slate-100 ${canvasBgClass}`}>
        {mapsQuotaExceeded && (
          <div className="bg-amber-600 text-slate-950 px-4 py-2 text-xs font-medium flex items-center justify-between gap-3 shrink-0 z-50">
            <span>
              Demo Google Maps quota exceeded. Replace the temporary key with your own Google Maps Platform API key to keep using the app.
            </span>
            <button
              type="button"
              onClick={() => setMapsQuotaExceeded(false)}
              className="px-2 py-0.5 rounded bg-black/15 hover:bg-black/25 text-xs font-semibold shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Mobile Nav Backdrop */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        {!theme.distractionFree && (
          <aside
            className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.08] bg-[#0A0D14] transition-transform duration-200 ${
              sidebarCollapsed ? 'w-[68px]' : 'w-64'
            } ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
          >
            {/* Brand Header */}
            <div className="h-14 px-3.5 flex items-center justify-between border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/src/assets/images/scopex_emblem_1795015235754.jpg"
                  alt="SCOPE-X"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0"
                />
                {!sidebarCollapsed && (
                  <span className="font-display font-bold text-base tracking-tight text-white whitespace-nowrap">
                    SCOPE-X
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* New Conversation Button */}
            <div className="p-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleNewConversation();
                  setMobileNavOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span>New Conversation</span>}
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto px-2.5 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileNavOpen(false);
                    }}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? activeNavClass
                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </button>
                );
              })}

              {!sidebarCollapsed && conversations.length > 0 && (
                <div className="pt-4 pb-2">
                  <div className="px-3 pb-1.5 text-[11px] font-medium text-slate-500">
                    Recent Sessions
                  </div>
                  <div className="space-y-0.5">
                    {conversations.slice(0, 6).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          void handleOpenConversation(c);
                          setMobileNavOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-xs truncate transition-colors ${
                          c.id === activeConversationId
                            ? 'bg-white/[0.07] text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                        }`}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </nav>

            {/* User Account Footer */}
            <div className="p-3 border-t border-white/[0.08] shrink-0">
              {!authReady ? null : user ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={
                        user.photoURL ||
                        '/src/assets/images/studio_user_avatar_1795015236354.jpg'
                      }
                      alt={user.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover border border-white/15 shrink-0"
                    />
                    {!sidebarCollapsed && (
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {user.displayName || 'Studio User'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {user.email}
                        </div>
                      </div>
                    )}
                  </div>
                  {!sidebarCollapsed && (
                    <button
                      type="button"
                      onClick={() => void signOutUser()}
                      title="Sign out"
                      className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.06]"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-100 transition-colors whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  {!sidebarCollapsed && <span>Sign In with Google</span>}
                </button>
              )}
            </div>
          </aside>
        )}

        {/* Center Workspace */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top Bar */}
          <header className="h-14 px-4 border-b border-white/[0.08] bg-[#0A0D14]/85 backdrop-blur-md flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {!theme.distractionFree && (
                <>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(true)}
                    className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:bg-white/[0.06]"
                    aria-label="Open navigation"
                  >
                    <Menu className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed((c) => !c)}
                    className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
                    title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  >
                    {sidebarCollapsed ? (
                      <PanelLeftOpen className="w-4 h-4" />
                    ) : (
                      <PanelLeftClose className="w-4 h-4" />
                    )}
                  </button>
                </>
              )}
              <span className="font-display font-semibold text-sm text-white whitespace-nowrap shrink-0">
                {NAV_ITEMS.find((n) => n.id === activeModule)?.label}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <select
                aria-label="Active AI model"
                value={selectedProvider === 'auto' ? 'auto' : `${selectedProvider}:${selectedModel}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'auto') {
                    setSelectedProvider('auto');
                    setAutoRoute(true);
                  } else {
                    const [prov, ...rest] = val.split(':');
                    setSelectedProvider(prov as ProviderId);
                    setSelectedModel(rest.join(':'));
                    setAutoRoute(false);
                  }
                }}
                className="bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 max-w-[210px] focus:outline-none focus:border-blue-500"
              >
                <option value="auto">Auto (Smart Router)</option>
                {providers.map((p) => (
                  <optgroup
                    key={p.id}
                    label={`${p.name} (${p.connected ? 'Connected' : 'Not Configured'})`}
                  >
                    {p.models.map((m) => (
                      <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                        {m.label}{p.connected ? '' : ' — needs key'}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setActiveModule('assistant');
                  toggleListening();
                }}
                title="Voice Command"
                className={`p-2 rounded-lg transition-colors shrink-0 ${
                  listening
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.1]'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setTheme((prev) => ({
                    ...prev,
                    distractionFree: !prev.distractionFree,
                  }))
                }
                title={
                  theme.distractionFree
                    ? 'Exit distraction-free mode'
                    : 'Distraction-free conversation mode'
                }
                className="p-2 rounded-lg bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors shrink-0"
              >
                {theme.distractionFree ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

              {!theme.distractionFree && (
                <button
                  type="button"
                  onClick={() => setRightPanelOpen((o) => !o)}
                  className="hidden xl:inline-flex p-2 rounded-lg bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors shrink-0"
                  title="Toggle context panel"
                >
                  {rightPanelOpen ? (
                    <PanelRightClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelRightOpen className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </header>

          {/* Active Studio Module */}
          <main className="flex-1 min-h-0 overflow-hidden">
            {activeModule === 'assistant' && (
              <AssistantView
                messages={messages}
                isStreaming={isStreaming}
                statusText={assistantStatus}
                pendingConfirmDelete={pendingConfirmDelete}
                onConfirmDelete={() => {
                  if (pendingConfirmDelete) {
                    void handleDeleteProject(pendingConfirmDelete.projectId);
                    setPendingConfirmDelete(null);
                  }
                }}
                onCancelDelete={() => setPendingConfirmDelete(null)}
                onSendMessage={(txt, atts) => void sendAssistantMessage(txt, atts, false)}
                onSpeakMessage={(txt) => void speakText(txt)}
                onNavigateModule={setActiveModule}
                onSendCodeToStudio={(code, lang) => {
                  setCodeSnippet(code);
                  setCodeLanguage(lang);
                  setActiveModule('code');
                }}
                voiceOpen={voiceOpen}
                onToggleVoicePanel={() => setVoiceOpen((v) => !v)}
                listening={listening}
                speaking={speaking}
                muted={muted}
                continuous={continuousVoice}
                interimTranscript={interimTranscript}
                voices={voices}
                selectedVoiceId={selectedVoiceId}
                onToggleListening={toggleListening}
                onInterruptVoice={() => {
                  voiceController.stopSpeaking();
                  liveClientRef.current?.stopPlaybackQueue();
                }}
                onToggleMute={() => {
                  const nextMuted = !muted;
                  if (nextMuted) voiceController.stopSpeaking();
                  liveClientRef.current?.setMuted(nextMuted);
                  setMuted(nextMuted);
                }}
                onToggleContinuous={() => setContinuousVoice((c) => !c)}
                onSelectVoice={setSelectedVoiceId}
                liveState={liveState}
                liveInputTranscript={liveInputTranscript}
                liveOutputTranscript={liveOutputTranscript}
                onToggleLiveSession={() => void handleToggleLiveSession()}
              />
            )}

            {activeModule === 'builder' && (
              <AppBuilderView
                project={activeProject?.type === 'app' ? activeProject : null}
                isBuilding={isBuildingApp}
                architectureNotes={architectureNotes}
                schemaNotes={schemaNotes}
                buildLogs={buildLogs}
                agentMessages={agentMessages}
                liveAgentSteps={liveAgentSteps}
                verification={builderVerification}
                envVars={projectEnvVars}
                onChangeEnvVars={setProjectEnvVars}
                onBuildOrEdit={(p, errLog, forceMode) =>
                  handleBuildOrEditApp(p, errLog, forceMode)
                }
                onUpdateFile={(fileId, content) => {
                  if (!activeProject) return;
                  persistProject({
                    ...activeProject,
                    files: activeProject.files.map((f) =>
                      f.id === fileId ? { ...f, content, updatedAt: Date.now() } : f
                    ),
                    updatedAt: Date.now(),
                  });
                }}
                onReplaceFiles={(nextFiles, summary) => {
                  if (!activeProject) return;
                  const now = Date.now();
                  const nextVer = activeProject.activeVersion + 1;
                  persistProject({
                    ...activeProject,
                    files: nextFiles,
                    versions: [
                      ...activeProject.versions,
                      {
                        id: makeId('ver'),
                        versionNumber: nextVer,
                        summary: summary || 'Sandbox file update',
                        files: nextFiles.map((f) => ({ ...f })),
                        createdAt: now,
                      },
                    ],
                    activeVersion: nextVer,
                    updatedAt: now,
                  });
                }}
                onAddFile={(filePath) => {
                  if (!activeProject) return;
                  const cleanPath = filePath.replace(/^\/+/, '');
                  if (activeProject.files.some((f) => f.path === cleanPath)) return;
                  const newFile: StudioFile = {
                    id: makeId('file'),
                    path: cleanPath,
                    language: inferLanguage(cleanPath),
                    content: `// ${cleanPath}\n`,
                    updatedAt: Date.now(),
                  };
                  persistProject({
                    ...activeProject,
                    files: [...activeProject.files, newFile],
                    updatedAt: Date.now(),
                  });
                }}
                onAddFolder={(folderPath) => {
                  if (!activeProject) return;
                  const cleanFolder = folderPath.replace(/^\/+|\/+$/g, '');
                  if (!cleanFolder) return;
                  const keepPath = `${cleanFolder}/.keep`;
                  if (activeProject.files.some((f) => f.path.startsWith(`${cleanFolder}/`))) return;
                  const keepFile: StudioFile = {
                    id: makeId('file'),
                    path: keepPath,
                    language: 'text',
                    content: '',
                    updatedAt: Date.now(),
                  };
                  persistProject({
                    ...activeProject,
                    files: [...activeProject.files, keepFile],
                    updatedAt: Date.now(),
                  });
                }}
                onRenameFile={(fileId, newPath) => {
                  if (!activeProject) return;
                  const cleanNew = newPath.replace(/^\/+/, '');
                  if (!cleanNew) return;
                  persistProject({
                    ...activeProject,
                    files: activeProject.files.map((f) =>
                      f.id === fileId
                        ? {
                            ...f,
                            path: cleanNew,
                            language: inferLanguage(cleanNew),
                            updatedAt: Date.now(),
                          }
                        : f
                    ),
                    updatedAt: Date.now(),
                  });
                }}
                onRenameFolder={(oldPrefix, newPrefix) => {
                  if (!activeProject) return;
                  const cleanOld = oldPrefix.replace(/^\/+|\/+$/g, '');
                  const cleanNew = newPrefix.replace(/^\/+|\/+$/g, '');
                  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return;
                  persistProject({
                    ...activeProject,
                    files: activeProject.files.map((f) =>
                      f.path.startsWith(`${cleanOld}/`)
                        ? {
                            ...f,
                            path: `${cleanNew}/${f.path.slice(cleanOld.length + 1)}`,
                            updatedAt: Date.now(),
                          }
                        : f
                    ),
                    updatedAt: Date.now(),
                  });
                }}
                onDeleteFile={(fileId) => {
                  if (!activeProject) return;
                  persistProject({
                    ...activeProject,
                    files: activeProject.files.filter((f) => f.id !== fileId),
                    updatedAt: Date.now(),
                  });
                }}
                onDeleteFolder={(folderPrefix) => {
                  if (!activeProject) return;
                  const cleanPrefix = folderPrefix.replace(/^\/+|\/+$/g, '');
                  const remaining = activeProject.files.filter(
                    (f) => !f.path.startsWith(`${cleanPrefix}/`)
                  );
                  if (remaining.length === 0) return;
                  persistProject({
                    ...activeProject,
                    files: remaining,
                    updatedAt: Date.now(),
                  });
                }}
                onRestoreVersion={(versionNumber) => {
                  if (!activeProject) return;
                  const ver = activeProject.versions.find(
                    (v) => v.versionNumber === versionNumber
                  );
                  if (!ver) return;
                  persistProject({
                    ...activeProject,
                    files: ver.files.map((f) => ({ ...f })),
                    activeVersion: ver.versionNumber,
                    updatedAt: Date.now(),
                  });
                  logActivity('Version Restored', `Restored v${ver.versionNumber}`);
                }}
                onUpdateProjectMeta={(title, description) => {
                  if (!activeProject) return;
                  persistProject({
                    ...activeProject,
                    title,
                    description,
                    updatedAt: Date.now(),
                  });
                }}
                onUpdateVerification={setBuilderVerification}
              />
            )}

            {activeModule === 'research' && (
              <ResearchView
                query={researchQuery}
                markdown={researchMarkdown}
                sources={researchSources}
                isLoading={researchLoading}
                error={researchError}
                onRunResearch={handleRunResearch}
                onSaveAsProject={(title, content) => {
                  const now = Date.now();
                  persistProject({
                    id: makeId('proj'),
                    title: title.slice(0, 140),
                    description: 'Saved research report',
                    type: 'research',
                    files: [
                      {
                        id: makeId('file'),
                        path: 'report.md',
                        language: 'markdown',
                        content,
                        updatedAt: now,
                      },
                    ],
                    versions: [],
                    activeVersion: 1,
                    createdAt: now,
                    updatedAt: now,
                  });
                  logActivity('Saved Research', title);
                }}
              />
            )}

            {activeModule === 'writer' && (
              <WriterView
                topic={writerTopic}
                content={writerContent}
                isLoading={writerLoading}
                error={writerError}
                onGenerateWriting={handleGenerateWriting}
                onSaveAsProject={(title, content) => {
                  const now = Date.now();
                  persistProject({
                    id: makeId('proj'),
                    title: title.slice(0, 140),
                    description: 'Saved AI Writer draft',
                    type: 'writer',
                    files: [
                      {
                        id: makeId('file'),
                        path: 'draft.md',
                        language: 'markdown',
                        content,
                        updatedAt: now,
                      },
                    ],
                    versions: [],
                    activeVersion: 1,
                    createdAt: now,
                    updatedAt: now,
                  });
                  logActivity('Saved Draft', title);
                }}
              />
            )}

            {activeModule === 'images' && (
              <ImageStudioView
                gallery={imageGallery}
                isGenerating={imageLoading}
                error={imageError}
                onGenerateImage={handleGenerateImage}
                onAnimateToVideo={(src) => {
                  setPrefilledVideoSource(src);
                  setActiveModule('video');
                }}
              />
            )}

            {activeModule === 'video' && (
              <VideoStudioView
                gallery={videoGallery}
                isGenerating={videoLoading}
                error={videoError}
                prefilledSource={prefilledVideoSource}
                onClearPrefilledSource={() => setPrefilledVideoSource(null)}
                onGenerateVideo={handleGenerateVideo}
              />
            )}

            {activeModule === 'code' && (
              <CodeStudioView
                initialCode={codeSnippet}
                initialLanguage={codeLanguage}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                fallbackEnabled={fallbackEnabled}
                onSaveAsProject={(title, content, lang) => {
                  const now = Date.now();
                  persistProject({
                    id: makeId('proj'),
                    title: title.slice(0, 140),
                    description: 'Saved Code Studio output',
                    type: 'code',
                    files: [
                      {
                        id: makeId('file'),
                        path: `snippet.${lang === 'python' ? 'py' : 'ts'}`,
                        language: lang,
                        content,
                        updatedAt: now,
                      },
                    ],
                    versions: [],
                    activeVersion: 1,
                    createdAt: now,
                    updatedAt: now,
                  });
                  logActivity('Saved Code Project', title);
                }}
              />
            )}

            {activeModule === 'documents' && (
              <DocumentStudioView
                activeDoc={activeDoc}
                isLoading={docLoading}
                error={docError}
                onGenerateDocument={handleGenerateDocument}
                onSaveAsProject={(docItem) => {
                  const now = Date.now();
                  persistProject({
                    id: makeId('proj'),
                    title: docItem.title.slice(0, 140),
                    description: docItem.subtitle,
                    type: 'document',
                    files: [
                      {
                        id: makeId('file'),
                        path: 'document.json',
                        language: 'json',
                        content: JSON.stringify(docItem, null, 2),
                        updatedAt: now,
                      },
                    ],
                    versions: [],
                    activeVersion: 1,
                    createdAt: now,
                    updatedAt: now,
                  });
                  logActivity('Saved Document', docItem.title);
                }}
              />
            )}

            {activeModule === 'media' && (
              <MediaPlayerView
                queue={mediaQueue}
                currentIndex={mediaIndex}
                savedPlaylist={savedPlaylist}
                isSearching={mediaSearching}
                searchError={mediaError}
                onSearchTracks={handleSearchMedia}
                onSelectTrackIndex={(idx) => {
                  setMediaIndex(idx);
                  setAutoPlaySignal((s) => s + 1);
                }}
                onPlayFromPlaylist={(track) => {
                  setMediaQueue((prev) => {
                    const existingIdx = prev.findIndex((t) => t.id === track.id);
                    if (existingIdx >= 0) {
                      setMediaIndex(existingIdx);
                      return prev;
                    }
                    setMediaIndex(0);
                    return [track, ...prev];
                  });
                  setAutoPlaySignal((s) => s + 1);
                }}
                onSaveToPlaylist={(track) => {
                  setSavedPlaylist((prev) =>
                    prev.some((t) => t.id === track.id) ? prev : [track, ...prev]
                  );
                  if (user) void savePlaylistTrackToFirestore(user.uid, track);
                  logActivity('Playlist Updated', `Saved ${track.title}`);
                }}
                onRemoveFromPlaylist={(trackId) => {
                  setSavedPlaylist((prev) => prev.filter((t) => t.id !== trackId));
                  if (user) void deletePlaylistTrackFromFirestore(trackId);
                }}
                autoPlaySignal={autoPlaySignal}
                lyriaTracks={lyriaTracks}
                lyriaGenerating={lyriaGenerating}
                lyriaError={lyriaError}
                onGenerateMusic={handleGenerateMusic}
              />
            )}

            {activeModule === 'maps' && (
              <MapsView initialQuery={mapsQuery} onActivityLog={logActivity} />
            )}

            {activeModule === 'studio3d' && (
              <Studio3DView initialPreset={studio3dPreset} />
            )}

            {activeModule === 'game' && (
              <Game3DView initialDifficulty={gameDifficulty} />
            )}

            {activeModule === 'projects' && (
              <ProjectsView
                projects={projects}
                activeProjectId={activeProjectId}
                isSignedIn={Boolean(user)}
                onCreateProject={handleCreateProject}
                onOpenProject={(p) => void handleOpenProject(p)}
                onRenameProject={(id, title) => {
                  const target = projects.find((p) => p.id === id);
                  if (target) {
                    persistProject({ ...target, title, updatedAt: Date.now() });
                    logActivity('Project Renamed', title);
                  }
                }}
                onDeleteProject={(id) => void handleDeleteProject(id)}
              />
            )}

            {activeModule === 'settings' && (
              <SettingsView
                providers={providers}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                autoRoute={autoRoute}
                fallbackEnabled={fallbackEnabled}
                theme={theme}
                voices={voices}
                selectedVoiceId={selectedVoiceId}
                onSelectProvider={setSelectedProvider}
                onSelectModel={setSelectedModel}
                onToggleAutoRoute={setAutoRoute}
                onToggleFallback={setFallbackEnabled}
                onUpdateTheme={(next) => setTheme((prev) => ({ ...prev, ...next }))}
                onSelectVoice={setSelectedVoiceId}
                onPreviewVoice={(vid) =>
                  void speakText(
                    'Good day. SCOPE-X studio systems are calibrated and ready for your instructions.',
                    vid
                  )
                }
                onRefreshProviders={refreshProviders}
              />
            )}
          </main>
        </div>

        {/* Right Context Panel */}
        {!theme.distractionFree && rightPanelOpen && (
          <aside className="hidden xl:flex w-72 flex-col border-l border-white/[0.08] bg-[#0A0D14] p-4 space-y-5 overflow-y-auto shrink-0">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Active Model</div>
              <div className="bg-[#07090E] border border-white/[0.08] rounded-xl p-3 space-y-1">
                <div className="text-xs font-semibold text-white">
                  {selectedProvider === 'auto' ? 'Auto Smart Router' : selectedProvider.toUpperCase()}
                </div>
                <div className="text-[11px] font-mono text-blue-300 truncate">
                  {selectedProvider === 'auto'
                    ? 'Task-adaptive routing'
                    : selectedModel}
                </div>
                <div className="text-[11px] text-slate-400">
                  {providers.filter((p) => p.connected).length} of {providers.length} providers connected
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Current Project</div>
              <div className="bg-[#07090E] border border-white/[0.08] rounded-xl p-3 space-y-2">
                {activeProject ? (
                  <>
                    <div className="text-xs font-semibold text-white truncate">
                      {activeProject.title}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {activeProject.type} · v{activeProject.activeVersion} · {activeProject.files.length} files
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenProject(activeProject)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Open in workspace
                    </button>
                  </>
                ) : (
                  <div className="text-xs text-slate-500">
                    No active project selected.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Running Tasks</div>
              <div className="bg-[#07090E] border border-white/[0.08] rounded-xl p-3">
                {runningTasks.length === 0 ? (
                  <div className="text-xs text-slate-500">Idle — ready for commands</div>
                ) : (
                  <ul className="space-y-1.5">
                    {runningTasks.map((t) => (
                      <li key={t} className="text-xs text-blue-300">
                        • {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
              <div className="text-xs font-medium text-slate-400">System Activity</div>
              <div className="bg-[#07090E] border border-white/[0.08] rounded-xl p-3 flex-1 overflow-y-auto space-y-2.5">
                {activityLog.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    Actions performed in the studio will appear here.
                  </div>
                ) : (
                  activityLog.map((act) => (
                    <div key={act.id} className="space-y-0.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={
                            act.status === 'error'
                              ? 'font-medium text-rose-300'
                              : 'font-medium text-slate-200'
                          }
                        >
                          {act.label}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                          {new Date(act.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-2">
                        {act.detail}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
