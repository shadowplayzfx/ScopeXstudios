export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveClientCallbacks {
  onStateChange?: (state: LiveConnectionState) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (error: string) => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function downsampleTo16kInt16(input: Float32Array, sourceRate: number): ArrayBuffer {
  if (sourceRate === 16000) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out.buffer;
  }

  const ratio = sourceRate / 16000;
  const newLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    const avg = count > 0 ? sum / count : input[start] || 0;
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

const WORKLET_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}
registerProcessor('scopex-pcm-capture', PcmCaptureProcessor);
`;

export class GeminiLiveAudioClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private muted = false;
  private state: LiveConnectionState = 'disconnected';
  private callbacks: LiveClientCallbacks;

  constructor(callbacks: LiveClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  updateCallbacks(callbacks: LiveClientCallbacks): void {
    this.callbacks = callbacks;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.outputGain) {
      this.outputGain.gain.value = muted ? 0 : 1;
    }
    if (muted) {
      this.stopPlaybackQueue();
    }
  }

  getState(): LiveConnectionState {
    return this.state;
  }

  private setState(next: LiveConnectionState): void {
    this.state = next;
    this.callbacks.onStateChange?.(next);
  }

  async connect(voiceName = 'Charon'): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.setState('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.micStream = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      const inputCtx = new AudioCtx();
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      this.inputCtx = inputCtx;
      this.outputCtx = outputCtx;

      const gain = outputCtx.createGain();
      gain.gain.value = this.muted ? 0 : 1;
      gain.connect(outputCtx.destination);
      this.outputGain = gain;
      this.nextStartTime = outputCtx.currentTime;

      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${wsProto}//${window.location.host}/live?voice=${encodeURIComponent(voiceName)}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = async () => {
        try {
          if (inputCtx.state === 'suspended') await inputCtx.resume();
          if (outputCtx.state === 'suspended') await outputCtx.resume();
          await this.startMicCapture(stream, inputCtx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unable to start audio capture.';
          this.callbacks.onError?.(msg);
          this.disconnect();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            text?: string;
            error?: string;
          };
          if (msg.type === 'ready') {
            this.setState('connected');
          } else if (msg.type === 'audio' && msg.data) {
            this.enqueuePcm24k(msg.data);
          } else if (msg.type === 'input_transcript' && msg.text) {
            this.callbacks.onInputTranscript?.(msg.text);
          } else if (msg.type === 'output_transcript' && msg.text) {
            this.callbacks.onOutputTranscript?.(msg.text);
          } else if (msg.type === 'interrupted') {
            this.stopPlaybackQueue();
            this.callbacks.onInterrupted?.();
          } else if (msg.type === 'turn_complete') {
            this.callbacks.onTurnComplete?.();
          } else if (msg.type === 'error') {
            this.callbacks.onError?.(msg.error || 'Live voice session error.');
            this.setState('error');
          } else if (msg.type === 'closed') {
            this.disconnect();
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        this.callbacks.onError?.('WebSocket connection to Live Voice failed.');
        this.setState('error');
        this.cleanupMedia();
      };

      ws.onclose = () => {
        if (this.state !== 'disconnected') {
          this.cleanupMedia();
          this.setState('disconnected');
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to initialize Live Voice.';
      this.callbacks.onError?.(msg);
      this.setState('error');
      this.cleanupMedia();
    }
  }

  private async startMicCapture(stream: MediaStream, ctx: AudioContext): Promise<void> {
    const source = ctx.createMediaStreamSource(stream);
    const sendFloatChunk = (chunk: Float32Array) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const pcmBuffer = downsampleTo16kInt16(chunk, ctx.sampleRate);
      const b64 = arrayBufferToBase64(pcmBuffer);
      this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
    };

    if (ctx.audioWorklet) {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(moduleUrl);
        const node = new AudioWorkletNode(ctx, 'scopex-pcm-capture');
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
          sendFloatChunk(ev.data);
        };
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(node);
        node.connect(silentGain);
        silentGain.connect(ctx.destination);
        this.workletNode = node;
        return;
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
      const channel = ev.inputBuffer.getChannelData(0);
      sendFloatChunk(channel);
    };
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);
    this.scriptNode = processor;
  }

  private enqueuePcm24k(base64Pcm: string): void {
    const ctx = this.outputCtx;
    const gain = this.outputGain;
    if (!ctx || !gain || this.muted) return;

    const int16 = base64ToInt16Array(base64Pcm);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.015, this.nextStartTime);
    this.nextStartTime = startAt + audioBuffer.duration;

    this.activeSources.add(source);
    this.callbacks.onSpeakingChange?.(true);

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.callbacks.onSpeakingChange?.(false);
      }
    };

    source.start(startAt);
  }

  sendTextTurn(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && text.trim()) {
      this.ws.send(JSON.stringify({ type: 'text', text: text.trim() }));
    }
  }

  stopPlaybackQueue(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped source
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    }
    this.callbacks.onSpeakingChange?.(false);
  }

  private cleanupMedia(): void {
    this.stopPlaybackQueue();
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        // Ignore
      }
      this.workletNode = null;
    }
    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect();
      } catch {
        // Ignore
      }
      this.scriptNode = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.inputCtx) {
      void this.inputCtx.close().catch(() => undefined);
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      void this.outputCtx.close().catch(() => undefined);
      this.outputCtx = null;
    }
    this.outputGain = null;
  }

  disconnect(): void {
    const prevWs = this.ws;
    this.ws = null;
    if (prevWs) {
      try {
        prevWs.close();
      } catch {
        // Ignore
      }
    }
    this.cleanupMedia();
    this.setState('disconnected');
  }
}

export class AudioRecorderHelper {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = 'audio/webm';

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording is not supported in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    this.chunks = [];

    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const supported = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
    const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
    this.mimeType = recorder.mimeType || supported || 'audio/webm';

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };

    recorder.start(200);
    this.recorder = recorder;
  }

  async stop(): Promise<{ audioBase64: string; mimeType: string }> {
    const recorder = this.recorder;
    if (!recorder) {
      throw new Error('Recorder is not active.');
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType.split(';')[0] || 'audio/webm' }));
      };
      recorder.stop();
    });

    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.recorder = null;
    this.chunks = [];

    const buffer = await blob.arrayBuffer();
    return {
      audioBase64: arrayBufferToBase64(buffer),
      mimeType: (this.mimeType || blob.type || 'audio/webm').split(';')[0],
    };
  }
}
