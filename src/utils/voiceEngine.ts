export interface VoiceOption {
  id: string;
  label: string;
  description: string;
  engine: 'gemini-tts' | 'browser';
  geminiVoiceName?: string;
  geminiStyle?: string;
  browserVoiceURI?: string;
  lang?: string;
  pitch?: number;
  rate?: number;
}

export const CURATED_VOICES: VoiceOption[] = [
  {
    id: 'studio-butler',
    label: 'J.A.R.V.I.S.-Inspired Studio Butler',
    description:
      'Composed, articulate British-style assistant delivery via Gemini Neural TTS (licensed synthetic voice, not a celebrity clone).',
    engine: 'gemini-tts',
    geminiVoiceName: 'Charon',
    geminiStyle:
      'Composed, articulate, warm, sophisticated British-accented studio assistant with crisp diction and natural conversational pauses',
  },
  {
    id: 'studio-kore',
    label: 'Aria Studio (Neural Clear)',
    description: 'Clear, balanced contemporary studio narrator via Gemini Neural TTS.',
    engine: 'gemini-tts',
    geminiVoiceName: 'Kore',
    geminiStyle: 'Clear, calm, intelligent AI creative director with natural pacing',
  },
  {
    id: 'studio-fenrir',
    label: 'Atlas Deep (Neural Executive)',
    description: 'Measured, resonant baritone delivery via Gemini Neural TTS.',
    engine: 'gemini-tts',
    geminiVoiceName: 'Fenrir',
    geminiStyle: 'Confident, grounded, thoughtful engineering lead',
  },
  {
    id: 'studio-zephyr',
    label: 'Zephyr Bright (Neural Conversational)',
    description: 'Expressive, upbeat conversational assistant via Gemini Neural TTS.',
    engine: 'gemini-tts',
    geminiVoiceName: 'Zephyr',
    geminiStyle: 'Warm, approachable, expressive collaborator',
  },
];

export function getAvailableVoices(): VoiceOption[] {
  const list: VoiceOption[] = [...CURATED_VOICES];
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const sysVoices = window.speechSynthesis.getVoices();
    const british = sysVoices.find(
      (v) =>
        v.lang.startsWith('en-GB') &&
        (v.name.includes('Male') || v.name.includes('Daniel') || v.name.includes('Arthur'))
    );
    if (british) {
      list.push({
        id: `browser-british-${british.voiceURI}`,
        label: `Browser British (${british.name})`,
        description: 'Zero-latency local browser speech synthesis in British English.',
        engine: 'browser',
        browserVoiceURI: british.voiceURI,
        lang: british.lang,
        pitch: 0.94,
        rate: 0.98,
      });
    }
    for (const v of sysVoices.slice(0, 8)) {
      if (british && v.voiceURI === british.voiceURI) continue;
      list.push({
        id: `browser-${v.voiceURI}`,
        label: `${v.name} (${v.lang})`,
        description: 'Local browser speech synthesis.',
        engine: 'browser',
        browserVoiceURI: v.voiceURI,
        lang: v.lang,
        pitch: 1,
        rate: 1,
      });
    }
  }
  return list;
}

class VoiceController {
  private currentAudio: HTMLAudioElement | null = null;
  private speakingCallbacks: Set<(speaking: boolean) => void> = new Set();
  private isSpeaking = false;

  onSpeakingChange(cb: (speaking: boolean) => void): () => void {
    this.speakingCallbacks.add(cb);
    return () => {
      this.speakingCallbacks.delete(cb);
    };
  }

  private setSpeaking(val: boolean): void {
    this.isSpeaking = val;
    for (const cb of this.speakingCallbacks) {
      cb(val);
    }
  }

  getSpeaking(): boolean {
    return this.isSpeaking;
  }

  stopSpeaking(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // Ignore cleanup errors
      }
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.setSpeaking(false);
  }

  async speak(text: string, voice: VoiceOption): Promise<void> {
    this.stopSpeaking();
    const cleaned = text
      .replace(/```[\s\S]*?```/g, ' Code block generated on screen. ')
      .replace(/[#*_`>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return;

    if (voice.engine === 'gemini-tts') {
      try {
        this.setSpeaking(true);
        const resp = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleaned.slice(0, 1400),
            voiceName: voice.geminiVoiceName || 'Charon',
            style: voice.geminiStyle,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { audioDataUrl?: string };
          if (data.audioDataUrl) {
            await new Promise<void>((resolve) => {
              const audio = new Audio(data.audioDataUrl);
              this.currentAudio = audio;
              audio.onended = () => {
                this.currentAudio = null;
                this.setSpeaking(false);
                resolve();
              };
              audio.onerror = () => {
                this.currentAudio = null;
                this.setSpeaking(false);
                resolve();
              };
              audio.play().catch(() => {
                this.currentAudio = null;
                this.setSpeaking(false);
                resolve();
              });
            });
            return;
          }
        }
      } catch {
        // Gracefully fall through to browser speech synthesis
      }
    }

    await this.speakWithBrowser(cleaned, voice);
  }

  private speakWithBrowser(text: string, voice: VoiceOption): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        this.setSpeaking(false);
        resolve();
        return;
      }

      const utter = new SpeechSynthesisUtterance(text);
      const all = window.speechSynthesis.getVoices();
      const matched =
        (voice.browserVoiceURI &&
          all.find((v) => v.voiceURI === voice.browserVoiceURI)) ||
        all.find((v) => v.lang.startsWith('en-GB')) ||
        all.find((v) => v.lang.startsWith('en'));
      if (matched) utter.voice = matched;
      utter.pitch = voice.pitch ?? (voice.id === 'studio-butler' ? 0.94 : 1);
      utter.rate = voice.rate ?? 0.98;

      utter.onstart = () => this.setSpeaking(true);
      utter.onend = () => {
        this.setSpeaking(false);
        resolve();
      };
      utter.onerror = () => {
        this.setSpeaking(false);
        resolve();
      };

      this.setSpeaking(true);
      window.speechSynthesis.speak(utter);
    });
  }
}

export const voiceController = new VoiceController();

export interface SpeechRecognizerHandle {
  stop: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startLiveSpeechRecognition(callbacks: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: string) => void;
  onEnd: () => void;
}): SpeechRecognizerHandle | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((ev: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    webkitSpeechRecognition?: new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((ev: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
  };

  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Rec) {
    callbacks.onError('Browser speech recognition is unavailable in this browser.');
    return null;
  }

  const rec = new Rec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  let stopped = false;

  rec.onresult = (event) => {
    let interim = '';
    let finalChunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const txt = res[0]?.transcript || '';
      if (res.isFinal) {
        finalChunk += txt;
      } else {
        interim += txt;
      }
    }
    if (interim.trim()) callbacks.onInterim(interim.trim());
    if (finalChunk.trim()) callbacks.onFinal(finalChunk.trim());
  };

  rec.onerror = (ev) => {
    if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
      callbacks.onError(ev.error);
    }
  };

  rec.onend = () => {
    if (!stopped) {
      callbacks.onEnd();
    }
  };

  try {
    rec.start();
  } catch (e) {
    callbacks.onError(e instanceof Error ? e.message : 'Failed to start microphone.');
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        // Ignore
      }
    },
  };
}
