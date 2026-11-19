import React, { useEffect, useRef, useState } from 'react';
import { Download, Film, Loader2, Sparkles, Upload, Video, X } from 'lucide-react';
import type { GeneratedVideoItem } from '../types/studio';

export interface PrefilledVideoSource {
  imageUrl: string;
  base64: string;
  mimeType: string;
  prompt?: string;
}

interface VideoStudioViewProps {
  gallery: GeneratedVideoItem[];
  isGenerating: boolean;
  error: string;
  prefilledSource: PrefilledVideoSource | null;
  onClearPrefilledSource: () => void;
  onGenerateVideo: (params: {
    prompt: string;
    aspectRatio: '16:9' | '9:16';
    duration: number;
    sourceImageBase64?: string;
    sourceMimeType?: string;
  }) => Promise<void>;
}

export const VideoStudioView: React.FC<VideoStudioViewProps> = ({
  gallery,
  isGenerating,
  error,
  prefilledSource,
  onClearPrefilledSource,
  onGenerateVideo,
}) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [duration, setDuration] = useState<number>(5);
  const [sourcePreview, setSourcePreview] = useState('');
  const [sourceBase64, setSourceBase64] = useState('');
  const [sourceMime, setSourceMime] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (prefilledSource) {
      setSourcePreview(prefilledSource.imageUrl);
      setSourceBase64(prefilledSource.base64);
      setSourceMime(prefilledSource.mimeType);
      if (prefilledSource.prompt && !prompt.trim()) {
        setPrompt(`Smooth cinematic camera push-in: ${prefilledSource.prompt}`);
      }
    }
  }, [prefilledSource]);

  useEffect(() => {
    if (gallery.length > 0) {
      setActiveIndex(0);
    }
  }, [gallery.length]);

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
    await onGenerateVideo({
      prompt: prompt.trim(),
      aspectRatio,
      duration,
      sourceImageBase64: sourceBase64 || undefined,
      sourceMimeType: sourceMime || undefined,
    });
  };

  const handleDownload = (item: GeneratedVideoItem) => {
    const a = document.createElement('a');
    a.href = item.videoUrl;
    a.download = `scopex-video-${item.id}.mp4`;
    a.click();
  };

  const activeVideo = gallery[activeIndex] || null;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-white">
            AI Video & Motion Studio
          </h2>
          <p className="text-xs text-slate-400">
            Text-to-Video synthesis and Image-to-Video animation powered by gemini-omni-1.2-flash.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-400">
          Model: gemini-omni-1.2-flash · 720p MP4
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Aspect:</span>
              {(['16:9', '9:16'] as const).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                    aspectRatio === ratio
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Duration:</span>
              {[5, 8].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setDuration(sec)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                    duration === sec
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
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
              {sourcePreview ? 'Change Start Frame' : 'Animate Image'}
            </button>
          </div>
        </div>

        {sourcePreview && (
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#07090E] border border-white/10">
            <img
              src={sourcePreview}
              alt="Start frame"
              className="w-16 h-12 rounded object-cover shrink-0"
            />
            <div className="flex-1 text-xs text-slate-300">
              Start frame loaded for Image-to-Video animation. Describe the camera motion and scene action below.
            </div>
            <button
              type="button"
              onClick={() => {
                setSourcePreview('');
                setSourceBase64('');
                setSourceMime('');
                onClearPrefilledSource();
              }}
              className="p-1 text-slate-400 hover:text-white"
              aria-label="Remove start frame"
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
                ? 'Describe the motion (e.g., "Slow orbital pan around the subject with mist drifting across foreground")...'
                : 'Describe a cinematic video scene (subject, camera motion, lighting, atmosphere)...'
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
                Rendering Video...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {sourcePreview ? 'Animate to Video' : 'Generate Video'}
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            'Aerial drone flythrough over bioluminescent ocean waves at twilight',
            'Macro shot of glowing holographic circuit architecture assembling in dark studio lighting',
            'Slow tracking shot through a sunlit botanical glasshouse with mist',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPrompt(preset)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#07090E] border border-white/[0.07] hover:border-blue-500/40 text-slate-400 hover:text-slate-200 transition-colors text-left"
            >
              {preset}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
          {error}
        </div>
      )}

      {isGenerating && (
        <div className="bg-[#0D1119] border border-blue-500/30 rounded-xl p-8 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
          <div className="text-sm font-medium text-white">
            Synthesizing motion frames with gemini-omni-1.2-flash...
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Video synthesis runs asynchronously and may take 30–120 seconds depending on motion complexity.
          </p>
        </div>
      )}

      {activeVideo ? (
        <div className="space-y-4">
          <div className="bg-[#0D1119] border border-white/10 rounded-xl overflow-hidden">
            <div className="bg-[#07090E] flex items-center justify-center p-4">
              <video
                key={activeVideo.id}
                src={activeVideo.videoUrl}
                controls
                loop
                playsInline
                className={`rounded-lg max-h-[460px] bg-black ${
                  activeVideo.aspectRatio === '9:16' ? 'w-auto' : 'w-full max-w-3xl'
                }`}
              />
            </div>
            <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08]">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">{activeVideo.prompt}</div>
                <div className="text-xs font-mono text-slate-400">
                  {activeVideo.aspectRatio} · {activeVideo.model}
                  {activeVideo.sourceImageUsed ? ' · Image-to-Video' : ' · Text-to-Video'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(activeVideo)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Save MP4
              </button>
            </div>
          </div>

          {gallery.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {gallery.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    idx === activeIndex
                      ? 'bg-blue-600/15 border-blue-500/40'
                      : 'bg-[#0D1119] border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-white">
                    <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{item.prompt}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1">
                    {item.aspectRatio} · {item.sourceImageUsed ? 'Image-to-Video' : 'Text-to-Video'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        !isGenerating && (
          <div className="bg-[#0D1119] border border-white/10 rounded-xl p-10 text-center space-y-2">
            <Video className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="text-sm text-slate-300">
              Generated videos and animated images will play here.
            </p>
          </div>
        )
      )}
    </div>
  );
};
