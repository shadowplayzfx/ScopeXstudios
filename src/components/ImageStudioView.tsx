import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  Globe,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type {
  GeneratedImageItem,
  ImageEngineProvider,
  ImageModelDescriptor,
} from '../types/studio';

interface ImageStudioViewProps {
  gallery: GeneratedImageItem[];
  isGenerating: boolean;
  error: string;
  onGenerateImage: (params: {
    prompt: string;
    aspectRatio: string;
    imageSize?: '1K' | '2K' | '4K';
    provider?: ImageEngineProvider;
    model?: string;
    enableSearch?: boolean;
    enhancePrompt?: boolean;
    sourceImageBase64?: string;
    sourceMimeType?: string;
  }) => Promise<void>;
  onAnimateToVideo?: (params: {
    imageUrl: string;
    base64: string;
    mimeType: string;
    prompt: string;
  }) => void;
}

interface ImageConfigStatus {
  pollinations: { connected: boolean; source: string };
  gemini: { connected: boolean; source: string };
  models: ImageModelDescriptor[];
}

const DEFAULT_MODELS: ImageModelDescriptor[] = [
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
    description: 'Google multimodal generation with optional search grounding.',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Image',
    provider: 'gemini',
    badge: 'Fast Gemini',
    supportsEdit: true,
    description: 'Low-latency Gemini native image synthesis & editing.',
  },
];

export const ImageStudioView: React.FC<ImageStudioViewProps> = ({
  gallery,
  isGenerating,
  error,
  onGenerateImage,
  onAnimateToVideo,
}) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [enableSearch, setEnableSearch] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<string>('');
  const [sourceBase64, setSourceBase64] = useState<string>('');
  const [sourceMime, setSourceMime] = useState<string>('');
  const [configStatus, setConfigStatus] = useState<ImageConfigStatus | null>(null);
  const [lightboxItem, setLightboxItem] = useState<GeneratedImageItem | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch('/api/images/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ImageConfigStatus | null) => {
        if (data?.models) setConfigStatus(data);
      })
      .catch(() => {
        // Use default model list silently if config check fails
      });
  }, []);

  const models = configStatus?.models || DEFAULT_MODELS;
  const activeModelMeta =
    selectedModel === 'auto' ? null : models.find((m) => m.id === selectedModel) || null;

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setSourcePreview(result);
      setSourceBase64(result.split(',')[1] || '');
      setSourceMime(file.type || 'image/png');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    const chosenProvider: ImageEngineProvider = activeModelMeta
      ? activeModelMeta.provider
      : 'auto';
    await onGenerateImage({
      prompt: prompt.trim(),
      aspectRatio,
      imageSize,
      provider: chosenProvider,
      model: selectedModel === 'auto' ? undefined : selectedModel,
      enableSearch,
      enhancePrompt,
      sourceImageBase64: sourceBase64 || undefined,
      sourceMimeType: sourceMime || undefined,
    });
  };

  const handleDownload = (item: GeneratedImageItem) => {
    const a = document.createElement('a');
    a.href = item.imageUrl;
    const ext = item.imageUrl.startsWith('data:image/jpeg')
      ? 'jpg'
      : item.imageUrl.startsWith('data:image/webp')
        ? 'webp'
        : 'png';
    a.download = `scopex-image-${item.id}.${ext}`;
    a.click();
  };

  const handleAnimate = (item: GeneratedImageItem) => {
    if (!onAnimateToVideo) return;
    const match = item.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    onAnimateToVideo({
      imageUrl: item.imageUrl,
      mimeType: match[1] || 'image/png',
      base64: match[2],
      prompt: item.enhancedPrompt || item.prompt,
    });
  };

  const formatShortModel = (modelId: string) => {
    const found = models.find((m) => m.id === modelId);
    if (found) return found.label;
    return modelId.split('/').pop() || modelId;
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-white">
            AI Image Studio
          </h2>
          <p className="text-xs text-slate-400">
            Studio-grade image synthesis, Gemini prompt enhancement, and instruction-based reference editing powered by FLUX 1.1 Pro, FLUX 2, MAI 2.7 & Gemini.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {configStatus?.pollinations.connected && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Pollinations Ready
            </span>
          )}
          {configStatus?.gemini.connected && (
            <span className="inline-flex items-center gap-1 text-blue-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Gemini Ready
            </span>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Engine:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-md px-2.5 py-1 text-xs text-white focus:outline-none"
              >
                <option value="auto">
                  Auto Best Quality ({sourcePreview ? 'FLUX.1 Kontext Edit' : 'FLUX 1.1 Pro'})
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.provider === 'pollinations' ? 'Pollinations' : 'Gemini'} · {m.badge})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400 mr-1">Aspect:</span>
              {['1:1', '16:9', '4:3', '3:4', '9:16'].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`px-2 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                    aspectRatio === ratio
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400 mr-1">Size:</span>
              {(['1K', '2K', '4K'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setImageSize(sz)}
                  className={`px-2 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                    imageSize === sz
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setEnhancePrompt((v) => !v)}
              title="Use Gemini to enrich concise prompts with realistic lighting, composition, and texture details"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
                enhancePrompt
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/35'
                  : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Enhance Prompt: {enhancePrompt ? 'On' : 'Off'}
            </button>

            <button
              type="button"
              onClick={() => setEnableSearch((s) => !s)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
                enableSearch
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/35'
                  : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Search Grounding: {enableSearch ? 'On' : 'Off'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {sourcePreview ? 'Change Reference Image' : 'Upload Image to Edit'}
            </button>
          </div>
        </div>

        {activeModelMeta && (
          <div className="text-[11px] text-slate-400">
            {activeModelMeta.description}
          </div>
        )}

        {sourcePreview && (
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#07090E] border border-white/10">
            <img
              src={sourcePreview}
              alt="Source reference"
              className="w-14 h-14 rounded object-cover"
            />
            <div className="flex-1 text-xs text-slate-300">
              Reference image attached for editing. Describe the edits below (uses FLUX.1 Kontext Pro / FLUX 2 Flex).
            </div>
            <button
              type="button"
              onClick={() => {
                setSourcePreview('');
                setSourceBase64('');
                setSourceMime('');
              }}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              sourcePreview
                ? 'Describe your edit (e.g., "Change lighting to golden hour and add subtle mist")...'
                : 'Describe the image to generate (subject, setting, mood, lighting, camera style)...'
            }
            className="flex-1 bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                {sourcePreview ? 'Edit Image' : 'Generate Image'}
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
          {error}
        </div>
      )}

      {gallery.length === 0 ? (
        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-10 text-center space-y-2">
          <ImageIcon className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-sm text-slate-300">
            Generated and edited images will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gallery.map((item) => (
            <div
              key={item.id}
              className="bg-[#0D1119] border border-white/10 rounded-xl overflow-hidden flex flex-col"
            >
              <div className="relative aspect-square bg-[#07090E] overflow-hidden group">
                <img
                  src={item.imageUrl}
                  alt={item.prompt}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setLightboxItem(item)}
                  title="Inspect full image"
                  className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/60 text-slate-200 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-slate-200 line-clamp-2">{item.prompt}</p>
                  {item.enhancedPrompt && item.enhancedPrompt !== item.prompt && (
                    <p
                      title={item.enhancedPrompt}
                      className="text-[11px] text-blue-300/80 line-clamp-2"
                    >
                      Enhanced: {item.enhancedPrompt}
                    </p>
                  )}
                  {item.fallbackNote && (
                    <p className="text-[11px] text-amber-300/90 line-clamp-2">
                      {item.fallbackNote}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 pt-1">
                  <span className="truncate font-mono">
                    {item.aspectRatio} · {formatShortModel(item.model)}
                    {item.latencyMs ? ` · ${(item.latencyMs / 1000).toFixed(1)}s` : ''}
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {onAnimateToVideo && item.imageUrl.startsWith('data:') && (
                      <button
                        type="button"
                        onClick={() => handleAnimate(item)}
                        className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 whitespace-nowrap"
                      >
                        <Film className="w-3.5 h-3.5" />
                        Animate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="max-w-4xl w-full bg-[#0D1119] border border-white/10 rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="text-xs font-mono text-slate-300 truncate">
                {formatShortModel(lightboxItem.model)} · {lightboxItem.aspectRatio}
                {lightboxItem.latencyMs
                  ? ` · ${(lightboxItem.latencyMs / 1000).toFixed(1)}s`
                  : ''}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownload(lightboxItem)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save Image
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxItem(null)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-[#07090E] max-h-[75vh] flex items-center justify-center p-2">
              <img
                src={lightboxItem.imageUrl}
                alt={lightboxItem.prompt}
                className="max-h-[72vh] w-auto object-contain rounded"
              />
            </div>
            <div className="p-4 space-y-1.5 text-xs">
              <div className="text-slate-200">{lightboxItem.prompt}</div>
              {lightboxItem.enhancedPrompt &&
                lightboxItem.enhancedPrompt !== lightboxItem.prompt && (
                  <div className="text-blue-300/80">
                    Enhanced prompt: {lightboxItem.enhancedPrompt}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
