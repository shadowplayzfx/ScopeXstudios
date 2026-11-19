import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Download,
  ExternalLink,
  Image as ImageIcon,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type { GeneratedMusicItem, MediaTrack } from '../types/studio';

interface MediaPlayerViewProps {
  queue: MediaTrack[];
  currentIndex: number;
  savedPlaylist: MediaTrack[];
  isSearching: boolean;
  searchError: string;
  onSearchTracks: (query: string) => Promise<void>;
  onSelectTrackIndex: (index: number) => void;
  onPlayFromPlaylist: (track: MediaTrack) => void;
  onSaveToPlaylist: (track: MediaTrack) => void;
  onRemoveFromPlaylist: (trackId: string) => void;
  autoPlaySignal: number;
  lyriaTracks: GeneratedMusicItem[];
  lyriaGenerating: boolean;
  lyriaError: string;
  onGenerateMusic: (params: {
    prompt: string;
    title?: string;
    tier: 'clip' | 'pro';
    referenceImageBase64?: string;
    referenceMimeType?: string;
  }) => Promise<void>;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MediaPlayerView: React.FC<MediaPlayerViewProps> = ({
  queue,
  currentIndex,
  savedPlaylist,
  isSearching,
  searchError,
  onSearchTracks,
  onSelectTrackIndex,
  onPlayFromPlaylist,
  onSaveToPlaylist,
  onRemoveFromPlaylist,
  autoPlaySignal,
  lyriaTracks,
  lyriaGenerating,
  lyriaError,
  onGenerateMusic,
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'lyria'>('catalog');
  const [query, setQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(0.8);
  const [playbackNotice, setPlaybackNotice] = useState('');
  const [artFallback, setArtFallback] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Lyria Studio state
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicTitle, setMusicTitle] = useState('');
  const [musicTier, setMusicTier] = useState<'clip' | 'pro'>('clip');
  const [refPreview, setRefPreview] = useState('');
  const [refBase64, setRefBase64] = useState('');
  const [refMime, setRefMime] = useState('');
  const [selectedLyriaId, setSelectedLyriaId] = useState<string>('');
  const refImageInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (lyriaTracks.length > 0) {
      setSelectedLyriaId(lyriaTracks[0].id);
      setActiveTab('lyria');
    }
  }, [lyriaTracks.length]);

  const activeLyriaTrack =
    lyriaTracks.find((t) => t.id === selectedLyriaId) || lyriaTracks[0] || null;

  const currentTrack = queue[currentIndex] || null;

  useEffect(() => {
    setArtFallback(false);
    setPlaybackNotice('');
    setCurrentTime(0);
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (!currentTrack.previewUrl) {
      audio.pause();
      setIsPlaying(false);
      setPlaybackNotice(
        'Full stream playback requires an external music service subscription. Use the official listening link below.'
      );
      return;
    }

    audio.src = currentTrack.previewUrl;
    audio.load();

    if (autoPlaySignal > 0) {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setPlaybackNotice('');
        })
        .catch(() => {
          setIsPlaying(false);
          setPlaybackNotice('Click Play to start the licensed 30-second audio preview.');
        });
    }
  }, [currentTrack, autoPlaySignal]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (!currentTrack.previewUrl) {
      setPlaybackNotice(
        'Audio preview is unavailable for this track. Open the external listening link instead.'
      );
      return;
    }
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setPlaybackNotice('');
        })
        .catch((err) => {
          setPlaybackNotice(
            err instanceof Error ? err.message : 'Unable to start audio playback.'
          );
        });
    }
  };

  const handlePrev = () => {
    if (queue.length === 0) return;
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    onSelectTrackIndex(prevIdx);
  };

  const handleNext = () => {
    if (queue.length === 0) return;
    const nextIdx = (currentIndex + 1) % queue.length;
    onSelectTrackIndex(nextIdx);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    await onSearchTracks(query.trim());
  };

  const handleRefImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      setRefPreview(res);
      setRefBase64(res.split(',')[1] || '');
      setRefMime(file.type || 'image/png');
    };
    reader.readAsDataURL(file);
  };

  const handleLyriaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicPrompt.trim() || lyriaGenerating) return;
    await onGenerateMusic({
      prompt: musicPrompt.trim(),
      title: musicTitle.trim() || undefined,
      tier: musicTier,
      referenceImageBase64: refBase64 || undefined,
      referenceMimeType: refMime || undefined,
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() =>
          setDuration(audioRef.current?.duration || currentTrack?.durationSec || 30)
        }
        onEnded={() => {
          setIsPlaying(false);
          if (queue.length > 1) handleNext();
        }}
      />

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-[#0D1119] border border-white/10 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'catalog'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Catalog Player
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('lyria')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'lyria'
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Lyria AI Music Studio
          </button>
        </div>

        <div className="text-xs font-mono text-slate-400">
          {activeTab === 'lyria'
            ? 'lyria-3-clip-preview · lyria-3-pro-preview'
            : 'Licensed 30s Audio Previews'}
        </div>
      </div>

      {activeTab === 'lyria' ? (
        <div className="space-y-6">
          <form
            onSubmit={handleLyriaSubmit}
            className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Model Tier:</span>
                <button
                  type="button"
                  onClick={() => setMusicTier('clip')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    musicTier === 'clip'
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  Clip (30s · lyria-3-clip-preview)
                </button>
                <button
                  type="button"
                  onClick={() => setMusicTier('pro')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    musicTier === 'pro'
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#07090E] text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  Full Track (lyria-3-pro-preview)
                </button>
              </div>

              <div>
                <input
                  ref={refImageInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleRefImage(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => refImageInput.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 whitespace-nowrap shrink-0"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  {refPreview ? 'Change Mood Image' : 'Attach Mood Image'}
                </button>
              </div>
            </div>

            {refPreview && (
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#07090E] border border-white/10">
                <img src={refPreview} alt="Mood reference" className="w-12 h-12 rounded object-cover" />
                <div className="flex-1 text-xs text-slate-300">
                  Visual mood reference attached for Lyria soundtrack alignment.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRefPreview('');
                    setRefBase64('');
                    setRefMime('');
                  }}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3">
              <input
                type="text"
                value={musicTitle}
                onChange={(e) => setMusicTitle(e.target.value)}
                placeholder="Track title (optional)"
                className="bg-[#07090E] border border-white/10 focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder="Describe genre, instruments, BPM, mood, and vocals (e.g., Ambient synthwave at 110 BPM, warm analog arpeggios)..."
                  className="flex-1 bg-[#07090E] border border-white/10 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={lyriaGenerating || !musicPrompt.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
                >
                  {lyriaGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Composing...
                    </>
                  ) : (
                    <>
                      <Music2 className="w-4 h-4" />
                      Compose
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                'Lofi chillhop beats at 82 BPM with warm Rhodes chords and soft vinyl texture',
                'Epic orchestral hybrid score with cello ostinato and brass swells at 128 BPM',
                'Atmospheric synthwave night drive track with analog bassline and shimmering pads',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMusicPrompt(preset)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-[#07090E] border border-white/[0.07] hover:border-violet-500/40 text-slate-400 hover:text-slate-200 transition-colors text-left"
                >
                  {preset}
                </button>
              ))}
            </div>
          </form>

          {lyriaError && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              {lyriaError}
            </div>
          )}

          {activeLyriaTrack ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-violet-300">
                      {activeLyriaTrack.model} · {activeLyriaTrack.tier === 'pro' ? 'Full Track' : '30s Clip'}
                    </div>
                    <h3 className="font-display text-lg font-bold text-white truncate mt-0.5">
                      {activeLyriaTrack.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">{activeLyriaTrack.prompt}</p>
                  </div>
                  <a
                    href={activeLyriaTrack.audioDataUrl}
                    download={`scopex-lyria-${activeLyriaTrack.id}.mp3`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-blue-300 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Audio
                  </a>
                </div>

                <audio
                  key={activeLyriaTrack.id}
                  src={activeLyriaTrack.audioDataUrl}
                  controls
                  className="w-full"
                />

                {activeLyriaTrack.lyrics && (
                  <div className="bg-[#07090E] border border-white/[0.08] rounded-xl p-3.5 space-y-1">
                    <div className="text-[11px] font-medium text-slate-400">
                      Generated Lyrics & Structure Notes
                    </div>
                    <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                      {activeLyriaTrack.lyrics}
                    </pre>
                  </div>
                )}
              </div>

              <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3">
                <h3 className="font-display text-sm font-semibold text-white">
                  Composed Tracks ({lyriaTracks.length})
                </h3>
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {lyriaTracks.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => setSelectedLyriaId(tr.id)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                        tr.id === activeLyriaTrack.id
                          ? 'bg-violet-600/20 border-violet-500/35'
                          : 'bg-[#07090E] border-white/[0.06] hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-medium text-white truncate">{tr.title}</div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {tr.model}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#0D1119] border border-white/10 rounded-xl p-10 text-center space-y-2">
              <Music2 className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm text-slate-300">
                Original music compositions generated with Lyria 3 will appear here.
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Search Bar */}
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs, artists, or albums (licensed preview catalog)..."
                className="w-full bg-[#0D1119] border border-white/10 focus:border-blue-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors whitespace-nowrap"
            >
              {isSearching ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching
                </span>
              ) : (
                'Search Music'
              )}
            </button>
          </form>

          {searchError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
              {searchError}
            </div>
          )}

          {/* Now Playing Stage */}
          <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 md:p-6 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-center">
            <div className="w-44 h-44 md:w-48 md:h-48 mx-auto rounded-xl overflow-hidden border border-white/10 bg-[#07090E] shrink-0">
              <img
                src={
                  !artFallback && currentTrack?.artworkUrl
                    ? currentTrack.artworkUrl
                    : '/src/assets/images/media_ambient_cover_1795015236195.jpg'
                }
                alt={currentTrack ? `${currentTrack.title} album art` : 'SCOPE-X Media Cover'}
                referrerPolicy="no-referrer"
                onError={() => setArtFallback(true)}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-4 min-w-0">
              <div>
                <div className="text-xs text-slate-400 mb-1">
                  {currentTrack ? currentTrack.sourceLabel : 'Media Deck Ready'}
                </div>
                <h2 className="font-display text-2xl font-bold text-white truncate">
                  {currentTrack ? currentTrack.title : 'No Track Loaded'}
                </h2>
                <p className="text-sm text-slate-300 truncate mt-0.5">
                  {currentTrack
                    ? `${currentTrack.artist} · ${currentTrack.album}`
                    : 'Ask the AI assistant to play a song or search above'}
                </p>
              </div>

              {playbackNotice && (
                <p className="text-xs text-amber-300">{playbackNotice}</p>
              )}

              {/* Seek Bar */}
              <div className="space-y-1.5">
                <input
                  type="range"
                  min={0}
                  max={duration || 30}
                  step={0.1}
                  value={currentTime}
                  disabled={!currentTrack?.previewUrl}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setCurrentTime(next);
                    if (audioRef.current) audioRef.current.currentTime = next;
                  }}
                  className="w-full accent-blue-500 cursor-pointer"
                />
                <div className="flex justify-between text-xs font-mono text-slate-400 tabular-nums">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Transport Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrev}
                    disabled={queue.length === 0}
                    className="p-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-slate-200 transition-colors"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    disabled={!currentTrack}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-4 h-4" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Play
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={queue.length === 0}
                    className="p-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-slate-200 transition-colors"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-slate-400" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      aria-label="Volume"
                      className="w-24 accent-blue-500"
                    />
                  </div>

                  {currentTrack && (
                    <>
                      <button
                        type="button"
                        onClick={() => onSaveToPlaylist(currentTrack)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors"
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <a
                        href={currentTrack.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-blue-300 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Full Track
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Queue & Saved Playlist */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-blue-400" />
                  Playback Queue ({queue.length})
                </h3>
              </div>
              {queue.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  Search for any song or ask the assistant: “Play Midnight City by M83”.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {queue.map((t, idx) => (
                    <div
                      key={`${t.id}_${idx}`}
                      onClick={() => onSelectTrackIndex(idx)}
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                        idx === currentIndex
                          ? 'bg-blue-600/20 border border-blue-500/30'
                          : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={t.artworkUrl || '/src/assets/images/media_ambient_cover_1795015236195.jpg'}
                          alt={t.title}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover shrink-0 bg-[#07090E]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{t.title}</div>
                          <div className="text-xs text-slate-400 truncate">{t.artist}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs text-slate-400 font-mono tabular-nums">
                        <span>{formatTime(t.durationSec)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3">
              <h3 className="font-display text-sm font-semibold text-white">
                Saved Playlist ({savedPlaylist.length})
              </h3>
              {savedPlaylist.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  Save tracks from the player to build your persistent playlist.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {savedPlaylist.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onPlayFromPlaylist(t)}
                        className="flex items-center gap-3 min-w-0 text-left flex-1"
                      >
                        <img
                          src={t.artworkUrl || '/src/assets/images/media_ambient_cover_1795015236195.jpg'}
                          alt={t.title}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover shrink-0 bg-[#07090E]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{t.title}</div>
                          <div className="text-xs text-slate-400 truncate">{t.artist}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFromPlaylist(t.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400"
                        title="Remove from playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
