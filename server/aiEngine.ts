import { GoogleGenAI, type FunctionDeclaration, Type } from '@google/genai';
import type {
  ConcreteProviderId,
  ModelOption,
  ProviderId,
  ProviderStatus,
} from '../src/types/studio.ts';
import { getProviderKey, maskSecret } from './vault.ts';

export const PROVIDER_ENV_VARS: Record<ConcreteProviderId, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

export const PROVIDER_DISPLAY_NAMES: Record<ConcreteProviderId, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq LPU Inference',
  nvidia: 'NVIDIA NIM',
};

export const PROVIDER_MODELS: Record<ConcreteProviderId, ModelOption[]> = {
  gemini: [
    {
      id: 'gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash Lite',
      provider: 'gemini',
      capabilities: ['Low Latency', 'Tool Control', 'Search Grounding', 'Quick Replies'],
      tier: 'fast',
    },
    {
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      provider: 'gemini',
      capabilities: ['Reasoning', 'Tool Control', 'Search Grounding', 'Multimodal'],
      tier: 'standard',
    },
    {
      id: 'gemini-4-argon',
      label: 'Gemini 4 Argon',
      provider: 'gemini',
      capabilities: ['Complex Coding', 'STEM', 'Architecture'],
      tier: 'reasoning',
    },
    {
      id: 'gemini-4-carbon',
      label: 'Gemini 4 Carbon',
      provider: 'gemini',
      capabilities: ['Deep Debugging', 'Security Audits', 'Long-Horizon'],
      tier: 'reasoning',
    },
  ],
  groq: [
    {
      id: 'openai/gpt-oss-120b',
      label: 'GPT OSS 120B (Groq)',
      provider: 'groq',
      capabilities: ['Flagship Reasoning', 'Coding', 'High Throughput'],
      tier: 'reasoning',
    },
    {
      id: 'openai/gpt-oss-20b',
      label: 'GPT OSS 20B (Groq)',
      provider: 'groq',
      capabilities: ['Sub-second Latency', 'Quick Chat', 'Coding'],
      tier: 'fast',
    },
    {
      id: 'qwen/qwen3.8-27b',
      label: 'Qwen 3.8 27B (Groq)',
      provider: 'groq',
      capabilities: ['Fast Reasoning', 'Multilingual', 'Code'],
      tier: 'standard',
    },
  ],
  nvidia: [
    {
      id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      label: 'Nemotron 3.5 Lightning 30B',
      provider: 'nvidia',
      capabilities: ['Fast Inference', 'Instruction Following'],
      tier: 'fast',
    },
    {
      id: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      label: 'Nemotron 3.5 Super 120B',
      provider: 'nvidia',
      capabilities: ['Flagship Reasoning', 'Enterprise Inference'],
      tier: 'reasoning',
    },
    {
      id: 'nvidia/nemotron-3-ultra-550b-a55b',
      label: 'Nemotron 3 Ultra 550B',
      provider: 'nvidia',
      capabilities: ['Deep Architecture', 'Complex STEM'],
      tier: 'reasoning',
    },
    {
      id: 'nvidia/nemotron-3.5-bolt-e4b',
      label: 'Nemotron 3.5 Bolt E4B',
      provider: 'nvidia',
      capabilities: ['Ultra-Low Latency', 'Quick Tasks'],
      tier: 'fast',
    },
  ],
};

const providerMetrics: Record<
  ConcreteProviderId,
  { usageCount: number; lastLatencyMs?: number; lastError?: string }
> = {
  gemini: { usageCount: 0 },
  groq: { usageCount: 0 },
  nvidia: { usageCount: 0 },
};

export function recordProviderUsage(
  provider: ConcreteProviderId,
  latencyMs: number,
  error?: string
): void {
  providerMetrics[provider].usageCount += 1;
  providerMetrics[provider].lastLatencyMs = latencyMs;
  providerMetrics[provider].lastError = error;
}

export class ProviderApiError extends Error {
  readonly provider: ConcreteProviderId;
  readonly statusCode: number;
  readonly errorType:
    | 'missing_key'
    | 'auth_error'
    | 'rate_limit'
    | 'model_unavailable'
    | 'network_error'
    | 'provider_error';

  constructor(
    provider: ConcreteProviderId,
    statusCode: number,
    errorType: ProviderApiError['errorType'],
    message: string
  ) {
    super(message);
    this.name = 'ProviderApiError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}

export function classifyProviderError(
  provider: ConcreteProviderId,
  err: unknown,
  model?: string
): ProviderApiError {
  if (err instanceof ProviderApiError) return err;

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const display = PROVIDER_DISPLAY_NAMES[provider];
  const envName = PROVIDER_ENV_VARS[provider];

  if (
    lower.includes('not configured') ||
    lower.includes('api key is missing') ||
    lower.includes('no api key')
  ) {
    return new ProviderApiError(
      provider,
      400,
      'missing_key',
      `${display} is not configured. Add ${envName} to the server environment${provider === 'gemini' ? '' : ' or configure it in Settings'}.`
    );
  }

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('invalid_api_key')
  ) {
    return new ProviderApiError(
      provider,
      401,
      'auth_error',
      `${display} authentication failed (HTTP 401/403). Verify that ${envName} is valid and has API access.`
    );
  }

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests') ||
    lower.includes('quota')
  ) {
    return new ProviderApiError(
      provider,
      429,
      'rate_limit',
      `${display} rate limit or quota exceeded (HTTP 429). Wait briefly or enable automatic fallback.`
    );
  }

  if (
    lower.includes('404') ||
    lower.includes('410') ||
    lower.includes('end of life') ||
    lower.includes('no longer available') ||
    lower.includes('model_not_found') ||
    lower.includes('model_decommissioned') ||
    lower.includes('not_found') ||
    lower.includes('does not exist') ||
    lower.includes('decommissioned') ||
    lower.includes('unsupported model')
  ) {
    return new ProviderApiError(
      provider,
      404,
      'model_unavailable',
      `Model ${model ? `"${model}" ` : ''}is unavailable or unsupported on ${display}. Select another model or enable fallback.`
    );
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return new ProviderApiError(
      provider,
      504,
      'network_error',
      `Network timeout or connection error while contacting ${display}. Check connectivity or use another provider.`
    );
  }

  return new ProviderApiError(
    provider,
    502,
    'provider_error',
    `${display} request failed: ${raw.slice(0, 260)}`
  );
}

export function getGeminiClient(): GoogleGenAI | null {
  const { key } = getProviderKey('gemini');
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      timeout: 30000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isValidModelForProvider(
  provider: ConcreteProviderId,
  modelId?: string
): boolean {
  if (!modelId) return false;
  return PROVIDER_MODELS[provider].some((m) => m.id === modelId.trim());
}

export function getProvidersStatus(): ProviderStatus[] {
  const configs: Array<{
    id: ConcreteProviderId;
    name: string;
    description: string;
    managedExternally?: boolean;
  }> = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      description:
        'Primary reasoning, multimodal understanding, web search grounding, and audio/image workflows.',
      managedExternally: true,
    },
    {
      id: 'groq',
      name: 'Groq LPU Inference',
      description:
        'Ultra-low-latency text and code inference powered by Groq hardware.',
    },
    {
      id: 'nvidia',
      name: 'NVIDIA NIM',
      description:
        'Enterprise-grade foundation models and Nemotron / Qwen Coder endpoints.',
    },
  ];

  return configs.map((cfg) => {
    const info = getProviderKey(cfg.id);
    const connected = Boolean(info.key);
    return {
      id: cfg.id,
      name: cfg.name,
      description: cfg.description,
      connected,
      source: info.source,
      maskedKey: cfg.id === 'gemini' ? undefined : info.key ? maskSecret(info.key) : undefined,
      models: PROVIDER_MODELS[cfg.id],
      usageCount: providerMetrics[cfg.id].usageCount,
      lastLatencyMs: providerMetrics[cfg.id].lastLatencyMs,
      lastError: providerMetrics[cfg.id].lastError,
      managedExternally: cfg.managedExternally,
    };
  });
}

export function resolveProviderRoute(
  requestedProvider: ProviderId | string,
  requestedModel: string | undefined,
  taskHint: 'chat' | 'app' | 'research' | 'code' | 'writer' | 'fast',
  fallbackEnabled: boolean
): {
  chain: Array<{ provider: ConcreteProviderId; model: string }>;
  skippedReason?: string;
  missingConfigError?: string;
} {
  const statuses = getProvidersStatus();
  const isConnected = (p: ConcreteProviderId) =>
    statuses.find((s) => s.id === p)?.connected ?? false;

  const defaultModelFor = (p: ConcreteProviderId): string => {
    if (p === 'gemini') {
      if (taskHint === 'code' || taskHint === 'app') return 'gemini-4-hydrogen';
      return 'gemini-3.1-flash-lite';
    }
    if (p === 'groq') {
      if (taskHint === 'fast' || taskHint === 'chat') return 'openai/gpt-oss-20b';
      return 'openai/gpt-oss-120b';
    }
    if (taskHint === 'code' || taskHint === 'app') {
      return 'nvidia/nemotron-3.5-super-vl-120b-a12b';
    }
    return 'nvidia/nemotron-3.5-lightning-30b-a3b';
  };

  const normalizedProvider: ProviderId =
    requestedProvider === 'gemini' ||
    requestedProvider === 'groq' ||
    requestedProvider === 'nvidia'
      ? requestedProvider
      : 'auto';

  if (normalizedProvider === 'auto') {
    const order: ConcreteProviderId[] =
      taskHint === 'fast'
        ? ['groq', 'gemini', 'nvidia']
        : taskHint === 'code' || taskHint === 'app'
          ? ['gemini', 'nvidia', 'groq']
          : ['gemini', 'groq', 'nvidia'];

    const connectedChain = order
      .filter((p) => isConnected(p))
      .map((p) => ({ provider: p, model: defaultModelFor(p) }));

    if (connectedChain.length === 0) {
      return {
        chain: [],
        missingConfigError:
          'No AI providers are configured. Set GEMINI_API_KEY, GROQ_API_KEY, or NVIDIA_API_KEY in the server environment or configure Groq/NVIDIA in Settings.',
      };
    }

    return { chain: connectedChain };
  }

  const trimmedModel = requestedModel?.trim();
  const primaryModel = isValidModelForProvider(normalizedProvider, trimmedModel)
    ? trimmedModel!
    : defaultModelFor(normalizedProvider);

  const chain: Array<{ provider: ConcreteProviderId; model: string }> = [];
  let skippedReason: string | undefined;

  if (isConnected(normalizedProvider)) {
    chain.push({ provider: normalizedProvider, model: primaryModel });
  } else {
    const missingEnv = PROVIDER_ENV_VARS[normalizedProvider];
    const display = PROVIDER_DISPLAY_NAMES[normalizedProvider];
    if (!fallbackEnabled) {
      return {
        chain: [],
        missingConfigError: `${display} is not configured (${missingEnv} missing). Configure it in Settings or server environment, or enable automatic fallback.`,
      };
    }
    skippedReason = `${display} is not configured (${missingEnv} missing)`;
  }

  if (fallbackEnabled) {
    const fallbackOrder: ConcreteProviderId[] = (['gemini', 'groq', 'nvidia'] as ConcreteProviderId[]).filter(
      (p) => p !== normalizedProvider && isConnected(p)
    );
    for (const p of fallbackOrder) {
      chain.push({ provider: p, model: defaultModelFor(p) });
    }
  }

  if (chain.length === 0) {
    return {
      chain: [],
      missingConfigError: `${PROVIDER_DISPLAY_NAMES[normalizedProvider]} is not configured (${PROVIDER_ENV_VARS[normalizedProvider]} missing), and no other configured fallback providers are available.`,
    };
  }

  return { chain, skippedReason };
}

export async function callOpenAICompatible(params: {
  provider: Exclude<ConcreteProviderId, 'gemini'>;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  jsonMode?: boolean;
}): Promise<{ text: string; latencyMs: number }> {
  const info = getProviderKey(params.provider);
  if (!info.key) {
    throw new ProviderApiError(
      params.provider,
      400,
      'missing_key',
      `${PROVIDER_DISPLAY_NAMES[params.provider]} API key (${PROVIDER_ENV_VARS[params.provider]}) is not configured on the server.`
    );
  }

  const endpoint =
    params.provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://integrate.api.nvidia.com/v1/chat/completions';

  const executeRequest = async (useJsonFormat: boolean) => {
    const startedAt = Date.now();
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages,
      ],
      temperature: 0.4,
      max_tokens: 4096,
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }

    let res: globalThis.Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${info.key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch (networkErr) {
      const latencyMs = Date.now() - startedAt;
      const classified = classifyProviderError(params.provider, networkErr, params.model);
      recordProviderUsage(params.provider, latencyMs, classified.message);
      throw classified;
    }

    const latencyMs = Date.now() - startedAt;
    const rawText = await res.text();
    return { res, rawText, latencyMs };
  };

  let attempt = await executeRequest(Boolean(params.jsonMode));

  // Some NVIDIA/Groq models reject response_format: json_object with HTTP 400; retry cleanly without it
  if (
    !attempt.res.ok &&
    params.jsonMode &&
    attempt.res.status === 400 &&
    attempt.rawText.toLowerCase().includes('response_format')
  ) {
    attempt = await executeRequest(false);
  }

  const { res, rawText, latencyMs } = attempt;

  if (!res.ok) {
    let providerMessage = rawText.slice(0, 260);
    try {
      const errJson = JSON.parse(rawText) as { error?: { message?: string; code?: string }; message?: string };
      providerMessage = errJson.error?.message || errJson.message || providerMessage;
    } catch {
      // Keep raw text snippet
    }
    const classified = classifyProviderError(
      params.provider,
      `HTTP ${res.status} ${providerMessage}`,
      params.model
    );
    recordProviderUsage(params.provider, latencyMs, classified.message);
    throw classified;
  }

  let parsed: {
    choices?: Array<{ message?: { content?: string } }>;
  };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const err = new ProviderApiError(
      params.provider,
      502,
      'provider_error',
      `${PROVIDER_DISPLAY_NAMES[params.provider]} returned malformed JSON.`
    );
    recordProviderUsage(params.provider, latencyMs, err.message);
    throw err;
  }

  const content = parsed.choices?.[0]?.message?.content ?? '';
  recordProviderUsage(params.provider, latencyMs);
  return { text: content, latencyMs };
}

export const STUDIO_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'navigate_module',
    description:
      'Navigate the SCOPE-X studio interface to a specific module (assistant, builder, research, writer, images, video, code, documents, media, maps, studio3d, game, projects, settings).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: {
          type: Type.STRING,
          description:
            'Target module ID: assistant, builder, research, writer, images, video, code, documents, media, maps, studio3d, game, projects, or settings.',
        },
        reason: {
          type: Type.STRING,
          description: 'Brief explanation of why this module is being opened.',
        },
      },
      required: ['module'],
    },
  },
  {
    name: 'create_or_update_app',
    description:
      'Open the SCOPE-X App Builder and generate a new application OR modify/fix the currently open project based on natural language instructions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Complete user requirement or modification instruction for the App Builder.',
        },
        projectTitle: {
          type: Type.STRING,
          description: 'Short title for the application if creating a new one.',
        },
        mode: {
          type: Type.STRING,
          description: 'Either "create" for a new project or "edit" to modify the active project.',
        },
      },
      required: ['prompt', 'mode'],
    },
  },
  {
    name: 'run_research',
    description:
      'Open AI Research Studio and execute real internet-grounded research with sources and structured analysis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Research question or topic to investigate.',
        },
        includeComparison: {
          type: Type.BOOLEAN,
          description: 'Whether to include a structured comparison table.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_writing',
    description:
      'Open AI Writer Studio and generate an article, story, email, report, or script.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description: 'Topic and specific instructions for the written piece.',
        },
        format: {
          type: Type.STRING,
          description: 'Format such as article, story, email, report, or script.',
        },
      },
      required: ['topic', 'format'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Open AI Image Studio and generate an image from a descriptive prompt.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Detailed visual prompt for image generation.',
        },
        aspectRatio: {
          type: Type.STRING,
          description: 'Aspect ratio: 1:1, 16:9, 4:3, 3:4, or 9:16.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Open SCOPE-X Video Studio and generate a video from a text prompt.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Detailed motion and scene description for video generation.',
        },
        aspectRatio: {
          type: Type.STRING,
          description: 'Aspect ratio: "16:9" or "9:16".',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_music',
    description:
      'Open SCOPE-X Music & Media Studio and compose original AI music from a genre, mood, instrument, or lyric prompt using Lyria.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Musical style, mood, tempo, instruments, or lyrics prompt.',
        },
        tier: {
          type: Type.STRING,
          description: 'Either "clip" (up to 30s) or "pro" (full track).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'maps_grounding',
    description:
      'Open Google Maps Studio and search for real-world places, directions, restaurants, cafes, or neighborhood recommendations using Google Maps Grounding.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Geographic or place search query.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_3d_studio',
    description:
      'Open the interactive Three.js 3D Studio workshop with a specific 3D scene preset.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: {
          type: Type.STRING,
          description: 'Preset scene: "observatory", "sentinel", "resonator", or "terrarium".',
        },
      },
    },
  },
  {
    name: 'launch_game',
    description:
      'Launch the interactive 3D Aegis Intercept game inside SCOPE-X.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        difficulty: {
          type: Type.STRING,
          description: 'Difficulty mode: "standard" or "hyperdrive".',
        },
      },
    },
  },
  {
    name: 'generate_document',
    description:
      'Open AI Document Studio and generate a presentation deck or downloadable structured PDF/document.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description: 'Subject and requirements for the document or presentation.',
        },
        kind: {
          type: Type.STRING,
          description: 'Either "presentation" for slides or "document" for a structured PDF/report.',
        },
      },
      required: ['topic', 'kind'],
    },
  },
  {
    name: 'play_media',
    description:
      'Search accessible music previews and open the SCOPE-X Media Player to play the requested song or artist.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Song title and/or artist name to search and play.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_studio_theme',
    description:
      'Update the actual SCOPE-X studio visual theme (background darkness or accent color).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        canvas: {
          type: Type.STRING,
          description: 'Canvas darkness: "charcoal" (default), "obsidian" (darker), or "midnight" (deep blue-black).',
        },
        accent: {
          type: Type.STRING,
          description: 'Accent color: "blue", "violet", or "cyan".',
        },
      },
    },
  },
  {
    name: 'manage_project',
    description:
      'Create, rename, or request confirmation before deleting a project.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of "create", "rename", or "request_delete".',
        },
        title: {
          type: Type.STRING,
          description: 'New project title.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'toggle_voice_mode',
    description:
      'Start or stop continuous voice conversation mode in SCOPE-X.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        active: {
          type: Type.BOOLEAN,
          description: 'True to activate voice conversation, false to mute/stop.',
        },
      },
      required: ['active'],
    },
  },
];
