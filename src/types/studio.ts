export type StudioModule =
  | 'assistant'
  | 'builder'
  | 'research'
  | 'writer'
  | 'images'
  | 'video'
  | 'code'
  | 'documents'
  | 'media'
  | 'maps'
  | 'studio3d'
  | 'game'
  | 'projects'
  | 'settings';

export type ProviderId = 'auto' | 'gemini' | 'groq' | 'nvidia';

export type ConcreteProviderId = 'gemini' | 'groq' | 'nvidia';

export interface ModelOption {
  id: string;
  label: string;
  provider: ConcreteProviderId;
  capabilities: string[];
  tier: 'standard' | 'fast' | 'reasoning' | 'image' | 'audio' | 'video';
}

export interface ProviderStatus {
  id: ConcreteProviderId;
  name: string;
  description: string;
  connected: boolean;
  source: 'env' | 'vault' | 'none';
  maskedKey?: string;
  models: ModelOption[];
  usageCount: number;
  lastLatencyMs?: number;
  lastError?: string;
  managedExternally?: boolean;
}

export interface StudioFile {
  id: string;
  path: string;
  language: string;
  content: string;
  updatedAt: number;
}

export interface ProjectVersion {
  id: string;
  versionNumber: number;
  summary: string;
  files: StudioFile[];
  createdAt: number;
}

export type ProjectType = 'app' | 'research' | 'writer' | 'document' | 'image' | 'code';

export interface StudioProject {
  id: string;
  title: string;
  description: string;
  type: ProjectType;
  files: StudioFile[];
  versions: ProjectVersion[];
  activeVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolAction {
  id: string;
  tool: string;
  status: 'running' | 'completed' | 'failed' | 'awaiting_confirmation';
  summary: string;
  payload?: Record<string, unknown>;
}

export interface SourceLink {
  title: string;
  uri: string;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  size: number;
  textPreview?: string;
  base64Data?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  model?: string;
  fallbackNote?: string;
  toolActions?: ToolAction[];
  sources?: SourceLink[];
  attachments?: ChatAttachment[];
  createdAt: number;
}

export interface ConversationThread {
  id: string;
  title: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface MediaTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  previewUrl: string;
  externalUrl: string;
  durationSec: number;
  sourceLabel: string;
}

export interface ResearchReport {
  id: string;
  query: string;
  summary: string;
  sections: Array<{ heading: string; content: string }>;
  comparisonTable?: {
    headers: string[];
    rows: string[][];
  };
  sources: SourceLink[];
  createdAt: number;
}

export interface PresentationSlide {
  title: string;
  bullets: string[];
  speakerNotes?: string;
}

export interface GeneratedDocument {
  id: string;
  kind: 'document' | 'presentation';
  title: string;
  subtitle: string;
  content: string;
  slides: PresentationSlide[];
  createdAt: number;
}

export type ImageEngineProvider = 'auto' | 'pollinations' | 'gemini';

export interface ImageModelDescriptor {
  id: string;
  label: string;
  provider: 'pollinations' | 'gemini';
  badge: string;
  supportsEdit: boolean;
  description: string;
}

export interface GeneratedImageItem {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  imageUrl: string;
  model: string;
  provider?: 'pollinations' | 'gemini';
  fallbackNote?: string;
  aspectRatio: string;
  latencyMs?: number;
  createdAt: number;
}

export interface GeneratedVideoItem {
  id: string;
  prompt: string;
  videoUrl: string;
  aspectRatio: '16:9' | '9:16';
  model: string;
  sourceImageUsed?: boolean;
  createdAt: number;
}

export interface GeneratedMusicItem {
  id: string;
  prompt: string;
  title: string;
  audioDataUrl: string;
  lyrics: string;
  model: string;
  tier: 'clip' | 'pro';
  createdAt: number;
}

export interface MapsGroundedPlace {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets?: string[];
}

export interface MapsGroundingResponse {
  query: string;
  markdown: string;
  places: MapsGroundedPlace[];
  widgetToken?: string;
  latencyMs: number;
}

export interface StudioTheme {
  canvas: 'charcoal' | 'obsidian' | 'midnight';
  accent: 'blue' | 'violet' | 'cyan';
  distractionFree: boolean;
}

export interface SystemActivityItem {
  id: string;
  label: string;
  detail: string;
  status: 'running' | 'completed' | 'error';
  timestamp: number;
}

export interface AgentActivityStep {
  id: string;
  phase: 'inspect' | 'plan' | 'generate' | 'install' | 'verify' | 'fix' | 'done' | 'error';
  label: string;
  detail?: string;
  status: 'running' | 'completed' | 'failed';
  timestamp: number;
}

export interface BuilderAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  model?: string;
  steps?: AgentActivityStep[];
  changedFiles?: string[];
  buildPassed?: boolean;
  createdAt: number;
}

export interface SandboxDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface SandboxVerificationResult {
  passed: boolean;
  engine: 'esbuild-sandbox';
  projectType: 'react' | 'html' | 'node';
  compiledFiles: number;
  bundleBytes: number;
  durationMs: number;
  errors: SandboxDiagnostic[];
  warnings: SandboxDiagnostic[];
  securityWarnings: string[];
  detectedPackages: string[];
  checkedAt: number;
}

export interface TerminalEntry {
  id: string;
  kind: 'command' | 'stdout' | 'stderr' | 'info' | 'build' | 'warn';
  text: string;
  time: string;
}

export interface ProjectEnvVar {
  id: string;
  key: string;
  value: string;
  isPublic?: boolean;
}

