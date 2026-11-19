import { GoogleGenAI } from '@google/genai';
import type { ImageEngineProvider, ImageModelDescriptor } from '../src/types/studio.ts';
import { getImageProviderKey, maskSecret } from './vault.ts';

export const IMAGE_MODELS: ImageModelDescriptor[] = [
  {
    id: 'black-forest-labs/flux.1.1-pro',
    label: 'FLUX 1.1 Pro',
    provider: 'pollinations',
    badge: 'Flagship',
    supportsEdit: false,
    description: 'Studio-grade photorealism, crisp lighting, rich textures & composition.',
  },
  {
    id: 'black-forest-labs/flux.2-flex',
    label: 'FLUX 2 Flex',
    provider: 'pollinations',
    badge: 'Text + Edit',
    supportsEdit: true,
    description: 'High-precision text rendering, stylized illustration & reference editing.',
  },
  {
    id: 'black-forest-labs/flux.1-kontext-pro',
    label: 'FLUX.1 Kontext Pro',
    provider: 'pollinations',
    badge: 'Image Edit',
    supportsEdit: true,
    description: 'Targeted instruction-based editing of uploaded reference images.',
  },
  {
    id: 'black-forest-labs/flux.2-klein-4b',
    label: 'FLUX 2 Klein 4B',
    provider: 'pollinations',
    badge: 'Balanced + Edit',
    supportsEdit: true,
    description: 'Fast, high-efficiency FLUX 2 generation and reference image editing.',
  },
  {
    id: 'microsoft/mai-image-2.7',
    label: 'Microsoft MAI 2.7',
    provider: 'pollinations',
    badge: 'Editorial',
    supportsEdit: true,
    description: 'Clean editorial, product, and concept art visual synthesis.',
  },
  {
    id: 'microsoft/mai-image-2.7-flash',
    label: 'Microsoft MAI 2.7 Flash',
    provider: 'pollinations',
    badge: 'Fast + Edit',
    supportsEdit: true,
    description: 'Rapid Microsoft MAI synthesis with reference image support.',
  },
  {
    id: 'tongyi-mai/z-image-turbo',
    label: 'Z-Image Turbo',
    provider: 'pollinations',
    badge: 'Turbo',
    supportsEdit: false,
    description: 'Rapid sub-10s high-definition visual generation.',
  },
  {
    id: 'community/scriptsnsenses-sys/flux-2-dev-free',
    label: 'FLUX 2 Dev (Community)',
    provider: 'pollinations',
    badge: 'Free Tier',
    supportsEdit: true,
    description: 'Community-hosted FLUX 2 Dev generation & editing fallback.',
  },
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Gemini Nano Banana 2.1',
    provider: 'gemini',
    badge: 'Search + Edit',
    supportsEdit: true,
    description: 'Google multimodal generation with optional web/image search grounding.',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Image',
    provider: 'gemini',
    badge: 'Fast Gemini',
    supportsEdit: true,
    description: 'Low-latency Gemini native image synthesis and conversational editing.',
  },
];

const POLLINATIONS_DEFAULT_T2I = 'black-forest-labs/flux.1.1-pro';
const POLLINATIONS_DEFAULT_EDIT = 'black-forest-labs/flux.1-kontext-pro';
const GEMINI_DEFAULT_IMAGE = 'gemini-nano-banana-2.1';

export function getImageProvidersStatus() {
  const pollinations = getImageProviderKey('pollinations');
  const geminiImage = getImageProviderKey('gemini_image');
  return {
    pollinations: {
      connected: Boolean(pollinations.key),
      source: pollinations.source,
      maskedKey: pollinations.key ? maskSecret(pollinations.key) : undefined,
    },
    gemini: {
      connected: Boolean(geminiImage.key),
      source: geminiImage.source,
      managedExternally: true,
    },
    models: IMAGE_MODELS,
  };
}

function getGeminiImageClient(): GoogleGenAI | null {
  const { key } = getImageProviderKey('gemini_image');
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      timeout: 60000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function mapDimensions(
  aspectRatio: string,
  imageSize: '1K' | '2K' | '4K'
): { width: number; height: number; chosenRatio: string; chosenSize: '1K' | '2K' | '4K' } {
  const allowedRatios = ['1:1', '16:9', '4:3', '3:4', '9:16'];
  const chosenRatio = allowedRatios.includes(aspectRatio) ? aspectRatio : '1:1';
  const chosenSize: '1K' | '2K' | '4K' = ['1K', '2K', '4K'].includes(imageSize) ? imageSize : '1K';
  const hiRes = chosenSize === '2K' || chosenSize === '4K';

  const table: Record<string, { width: number; height: number }> = {
    '1:1': hiRes ? { width: 1408, height: 1408 } : { width: 1024, height: 1024 },
    '16:9': hiRes ? { width: 1536, height: 896 } : { width: 1280, height: 720 },
    '4:3': hiRes ? { width: 1408, height: 1024 } : { width: 1152, height: 864 },
    '3:4': hiRes ? { width: 1024, height: 1408 } : { width: 864, height: 1152 },
    '9:16': hiRes ? { width: 896, height: 1536 } : { width: 768, height: 1344 },
  };

  const dims = table[chosenRatio] || { width: 1024, height: 1024 };
  return { ...dims, chosenRatio, chosenSize };
}

function detectImageMime(buffer: Buffer, fallback = 'image/jpeg'): string {
  if (buffer.length >= 4) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
  }
  return fallback;
}

export async function enhanceImagePromptWithGemini(
  rawPrompt: string,
  isEdit: boolean
): Promise<{ prompt: string; wasEnhanced: boolean }> {
  const trimmed = rawPrompt.trim();
  const ai = getGeminiImageClient();
  if (!ai || !trimmed) {
    return { prompt: trimmed, wasEnhanced: false };
  }

  const wordCount = trimmed.split(/\s+/).length;
  // Already detailed edit prompts should remain exact so edit models follow instructions literally
  if (isEdit && wordCount > 18) {
    return { prompt: trimmed, wasEnhanced: false };
  }

  const candidateModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  for (const modelId of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: isEdit
          ? `Refine this image-editing instruction so an AI image editor preserves the original subject and executes the edit cleanly and realistically. Return ONLY the single refined prompt string (max 45 words, no quotes or markdown):\n\n${trimmed}`
          : `Transform this image prompt into a vivid, art-directed image generation prompt with specific lighting, textures, composition, color harmony, and depth while staying 100% faithful to the user's intent. Avoid cliché buzzwords like "8k, masterpiece, trending on artstation". Return ONLY the refined prompt text (single paragraph, max 75 words, no quotes):\n\n${trimmed}`,
      });
      const out = (response.text || '').trim().replace(/^["']|["']$/g, '');
      if (out && out.length >= trimmed.length * 0.6) {
        return { prompt: out, wasEnhanced: true };
      }
    } catch {
      // Try next Gemini text model or fall back silently to original prompt
    }
  }

  return { prompt: trimmed, wasEnhanced: false };
}

async function callPollinationsImage(params: {
  prompt: string;
  model: string;
  width: number;
  height: number;
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{ imageUrl: string; model: string; latencyMs: number; noteText?: string }> {
  const { key } = getImageProviderKey('pollinations');
  if (!key) {
    throw new Error('POLLINATIONS_API_KEY is not configured on the server.');
  }

  const isEdit = Boolean(params.sourceImageBase64 && params.sourceMimeType);
  const modelInfo = IMAGE_MODELS.find((m) => m.id === params.model && m.provider === 'pollinations');
  let activeModel = modelInfo ? modelInfo.id : POLLINATIONS_DEFAULT_T2I;
  let routeNote: string | undefined;

  if (isEdit && modelInfo && !modelInfo.supportsEdit) {
    activeModel = POLLINATIONS_DEFAULT_EDIT;
    routeNote = `Routed reference image edit to ${activeModel} (${modelInfo.label} is text-to-image only).`;
  } else if (isEdit && !modelInfo) {
    activeModel = POLLINATIONS_DEFAULT_EDIT;
  }

  const started = Date.now();

  if (isEdit && params.sourceImageBase64 && params.sourceMimeType) {
    const ext = params.sourceMimeType.includes('png')
      ? 'png'
      : params.sourceMimeType.includes('webp')
        ? 'webp'
        : 'jpg';
    const rawBuf = Buffer.from(params.sourceImageBase64, 'base64');
    const form = new FormData();
    form.append('model', activeModel);
    form.append('prompt', params.prompt);
    form.append('image', new Blob([rawBuf], { type: params.sourceMimeType }), `reference.${ext}`);
    form.append('size', `${params.width}x${params.height}`);
    form.append('response_format', 'b64_json');

    const resp = await fetch('https://gen.pollinations.ai/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: form,
      signal: AbortSignal.timeout(90000),
    });

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      let errMsg = errText.slice(0, 260);
      try {
        const parsed = JSON.parse(errText) as { error?: { message?: string } | string; message?: string };
        errMsg =
          (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ||
          parsed.message ||
          errMsg;
      } catch {
        // Keep text snippet
      }
      throw new Error(`Pollinations edit failed (${resp.status}): ${errMsg || resp.statusText}`);
    }

    if (contentType.startsWith('image/')) {
      const outBuf = Buffer.from(await resp.arrayBuffer());
      const mime = detectImageMime(outBuf, contentType.split(';')[0] || 'image/jpeg');
      return {
        imageUrl: `data:${mime};base64,${outBuf.toString('base64')}`,
        model: activeModel,
        latencyMs: Date.now() - started,
        noteText: routeNote,
      };
    }

    const data = (await resp.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string } | string;
    };
    const item = data.data?.[0];
    if (item?.b64_json) {
      const outBuf = Buffer.from(item.b64_json, 'base64');
      const mime = detectImageMime(outBuf);
      return {
        imageUrl: `data:${mime};base64,${item.b64_json}`,
        model: activeModel,
        latencyMs: Date.now() - started,
        noteText: routeNote,
      };
    }
    if (item?.url) {
      const imgResp = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
      const outBuf = Buffer.from(await imgResp.arrayBuffer());
      const mime = detectImageMime(outBuf);
      return {
        imageUrl: `data:${mime};base64,${outBuf.toString('base64')}`,
        model: activeModel,
        latencyMs: Date.now() - started,
        noteText: routeNote,
      };
    }

    throw new Error('Pollinations edit returned an empty image payload.');
  }

  // Standard Text-to-Image via /v1/images/generations
  const resp = await fetch('https://gen.pollinations.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: activeModel,
      prompt: params.prompt,
      size: `${params.width}x${params.height}`,
      response_format: 'b64_json',
      n: 1,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let errMsg = errText.slice(0, 260);
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } | string; message?: string };
      errMsg =
        (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ||
        parsed.message ||
        errMsg;
    } catch {
      // keep raw snippet
    }
    throw new Error(`Pollinations error (${resp.status}): ${errMsg || resp.statusText}`);
  }

  const json = (await resp.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = json.data?.[0];
  if (first?.b64_json) {
    const outBuf = Buffer.from(first.b64_json, 'base64');
    const mime = detectImageMime(outBuf);
    return {
      imageUrl: `data:${mime};base64,${first.b64_json}`,
      model: activeModel,
      latencyMs: Date.now() - started,
      noteText: routeNote,
    };
  }

  if (first?.url) {
    const imgResp = await fetch(first.url, { signal: AbortSignal.timeout(30000) });
    const outBuf = Buffer.from(await imgResp.arrayBuffer());
    const mime = detectImageMime(outBuf);
    return {
      imageUrl: `data:${mime};base64,${outBuf.toString('base64')}`,
      model: activeModel,
      latencyMs: Date.now() - started,
      noteText: routeNote,
    };
  }

  throw new Error(`No image payload was returned by ${activeModel}.`);
}

async function callGeminiImage(params: {
  prompt: string;
  model: string;
  aspectRatio: string;
  imageSize: '1K' | '2K' | '4K';
  enableSearch: boolean;
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{ imageUrl: string; model: string; latencyMs: number; noteText?: string }> {
  const ai = getGeminiImageClient();
  if (!ai) {
    throw new Error('Gemini image API key is not configured on the server.');
  }

  const activeModel =
    params.model === 'gemini-3.1-flash-lite-image' || params.model === 'gemini-nano-banana-2.1'
      ? params.model
      : GEMINI_DEFAULT_IMAGE;

  const started = Date.now();
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (params.sourceImageBase64 && params.sourceMimeType) {
    parts.push({
      inlineData: { data: params.sourceImageBase64, mimeType: params.sourceMimeType },
    });
  }
  parts.push({ text: params.prompt });

  const response = await ai.models.generateContent({
    model: activeModel,
    contents: { parts },
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
      },
      ...(params.enableSearch
        ? {
            tools: [
              {
                googleSearch: {
                  searchTypes: {
                    webSearch: {},
                    imageSearch: {},
                  },
                },
              },
            ],
          }
        : {}),
    },
  });

  const latencyMs = Date.now() - started;
  let imageUrl = '';
  let noteText = '';
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      imageUrl = `data:${mime};base64,${part.inlineData.data}`;
    } else if (part.text) {
      noteText += part.text;
    }
  }

  if (!imageUrl) {
    throw new Error(noteText || `No image payload was returned by ${activeModel}.`);
  }

  return {
    imageUrl,
    model: activeModel,
    latencyMs,
    noteText: noteText || undefined,
  };
}

function summarizeImageError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient_balance') || lower.includes('insufficient balance') || lower.includes('(402)')) {
    return 'Pollinations balance insufficient for selected tier';
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return 'Gemini image quota exceeded (HTTP 429)';
  }
  if (lower.includes('403') || lower.includes('permission_denied')) {
    return 'Gemini image billing/permission denied (HTTP 403)';
  }
  return raw.slice(0, 140);
}

export async function generateStudioImage(params: {
  prompt: string;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  provider?: ImageEngineProvider;
  model?: string;
  enableSearch?: boolean;
  enhancePrompt?: boolean;
  fallbackEnabled?: boolean;
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{
  imageUrl: string;
  model: string;
  provider: 'pollinations' | 'gemini';
  aspectRatio: string;
  imageSize: '1K' | '2K' | '4K';
  latencyMs: number;
  enhancedPrompt?: string;
  noteText?: string;
  fallbackNote?: string;
}> {
  const rawPrompt = params.prompt.trim();
  if (!rawPrompt) {
    throw new Error('Image prompt is required.');
  }

  const isEdit = Boolean(params.sourceImageBase64 && params.sourceMimeType);
  const { width, height, chosenRatio, chosenSize } = mapDimensions(
    params.aspectRatio || '1:1',
    params.imageSize || '1K'
  );

  const shouldEnhance = params.enhancePrompt !== false;
  const enhanced = shouldEnhance
    ? await enhanceImagePromptWithGemini(rawPrompt, isEdit)
    : { prompt: rawPrompt, wasEnhanced: false };
  const activePrompt = enhanced.prompt;

  const hasPollinations = Boolean(getImageProviderKey('pollinations').key);
  const hasGemini = Boolean(getImageProviderKey('gemini_image').key);

  if (!hasPollinations && !hasGemini) {
    throw new Error(
      'No image generation API keys are configured on the server. Configure POLLINATIONS_API_KEY or GEMINI_IMAGE_API_KEY.'
    );
  }

  const requestedModelInfo = params.model
    ? IMAGE_MODELS.find((m) => m.id === params.model)
    : undefined;

  let preferredProvider: 'pollinations' | 'gemini';
  if (requestedModelInfo) {
    preferredProvider = requestedModelInfo.provider;
  } else if (params.provider === 'gemini' || params.provider === 'pollinations') {
    preferredProvider = params.provider;
  } else if (params.enableSearch && hasGemini) {
    preferredProvider = 'gemini';
  } else {
    preferredProvider = hasPollinations ? 'pollinations' : 'gemini';
  }

  const allowFallback = params.fallbackEnabled !== false;
  const steps: Array<{ provider: 'pollinations' | 'gemini'; model: string }> = [];
  const pushUniqueStep = (provider: 'pollinations' | 'gemini', model: string) => {
    if (!steps.some((s) => s.provider === provider && s.model === model)) {
      steps.push({ provider, model });
    }
  };

  const pollinationsEditChain = [
    POLLINATIONS_DEFAULT_EDIT,
    'black-forest-labs/flux.2-klein-4b',
    'microsoft/mai-image-2.7-flash',
    'community/scriptsnsenses-sys/flux-2-dev-free',
  ];
  const pollinationsT2IChain = [
    POLLINATIONS_DEFAULT_T2I,
    'black-forest-labs/flux.2-klein-4b',
    'tongyi-mai/z-image-turbo',
    'microsoft/mai-image-2.7-flash',
    'community/scriptsnsenses-sys/flux-2-dev-free',
  ];

  if (preferredProvider === 'gemini') {
    if (hasGemini) {
      pushUniqueStep(
        'gemini',
        requestedModelInfo?.provider === 'gemini'
          ? requestedModelInfo.id
          : GEMINI_DEFAULT_IMAGE
      );
    }
    if ((allowFallback || !hasGemini) && hasPollinations) {
      for (const m of isEdit ? pollinationsEditChain : pollinationsT2IChain) {
        pushUniqueStep('pollinations', m);
      }
    }
  } else {
    if (hasPollinations) {
      const primaryPollinations =
        requestedModelInfo?.provider === 'pollinations'
          ? requestedModelInfo.id
          : isEdit
            ? POLLINATIONS_DEFAULT_EDIT
            : POLLINATIONS_DEFAULT_T2I;
      pushUniqueStep('pollinations', primaryPollinations);
      if (allowFallback) {
        for (const m of isEdit ? pollinationsEditChain : pollinationsT2IChain) {
          pushUniqueStep('pollinations', m);
        }
      }
    }
    if ((allowFallback || !hasPollinations) && hasGemini) {
      pushUniqueStep('gemini', GEMINI_DEFAULT_IMAGE);
    }
  }

  let primaryError = '';
  const stepErrors: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const result =
        step.provider === 'pollinations'
          ? await callPollinationsImage({
              prompt: activePrompt,
              model: step.model,
              width,
              height,
              sourceImageBase64: params.sourceImageBase64,
              sourceMimeType: params.sourceMimeType,
            })
          : await callGeminiImage({
              prompt: activePrompt,
              model: step.model,
              aspectRatio: chosenRatio,
              imageSize: chosenSize,
              enableSearch: Boolean(params.enableSearch),
              sourceImageBase64: params.sourceImageBase64,
              sourceMimeType: params.sourceMimeType,
            });

      const fallbackNote =
        i > 0 && primaryError
          ? `Switched from ${steps[0].model} (${summarizeImageError(primaryError)}) to ${result.model}`
          : undefined;

      return {
        imageUrl: result.imageUrl,
        model: result.model,
        provider: step.provider,
        aspectRatio: chosenRatio,
        imageSize: chosenSize,
        latencyMs: result.latencyMs,
        enhancedPrompt: enhanced.wasEnhanced ? activePrompt : undefined,
        noteText: result.noteText,
        fallbackNote,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stepErrors.push(`${step.model}: ${summarizeImageError(msg)}`);
      if (i === 0) primaryError = msg;
    }
  }

  throw new Error(
    primaryError
      ? `${summarizeImageError(primaryError)}. Fallbacks tried: ${stepErrors.slice(1).join(' | ')}`
      : 'All configured image generation providers failed.'
  );
}
