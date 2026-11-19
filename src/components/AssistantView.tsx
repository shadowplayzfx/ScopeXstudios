import React, { useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  CheckCircle2,
  FileCode2,
  Loader2,
  Mic,
  Paperclip,
  ShieldAlert,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type {
  ChatAttachment,
  ChatMessage,
  StudioModule,
} from '../types/studio';
import { MarkdownView } from './MarkdownView';
import { VoiceVisualizer } from './VoiceVisualizer';
import type { VoiceOption } from '../utils/voiceEngine';
import { AudioRecorderHelper, type LiveConnectionState } from '../utils/liveAudioClient';

interface AssistantViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  statusText: string;
  pendingConfirmDelete: { projectId: string; title: string } | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => void;
  onSpeakMessage: (text: string) => void;
  onNavigateModule: (mod: StudioModule) => void;
  onSendCodeToStudio: (code: string, lang: string) => void;
  // Voice props
  voiceOpen: boolean;
  onToggleVoicePanel: () => void;
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  continuous: boolean;
  interimTranscript: string;
  voices: VoiceOption[];
  selectedVoiceId: string;
  onToggleListening: () => void;
  onInterruptVoice: () => void;
  onToggleMute: () => void;
  onToggleContinuous: () => void;
  onSelectVoice: (id: string) => void;
  liveState: LiveConnectionState;
  liveInputTranscript: string;
  liveOutputTranscript: string;
  onToggleLiveSession: () => void;
}

const SUGGESTED_COMMANDS = [
  'Build me a website about ocean conservation.',
  'Create a video of ocean waves illuminated by moonlight.',
  'Compose an upbeat electronic synth track with Lyria.',
  'Find quiet specialty coffee shops near San Francisco.',
  'Open the 3D Studio to inspect a procedural observatory.',
  'Launch the 3D interceptor game.',
];

export const AssistantView: React.FC<AssistantViewProps> = ({
  messages,
  isStreaming,
  statusText,
  pendingConfirmDelete,
  onConfirmDelete,
  onCancelDelete,
  onSendMessage,
  onSpeakMessage,
  onNavigateModule,
  onSendCodeToStudio,
  voiceOpen,
  onToggleVoicePanel,
  listening,
  speaking,
  muted,
  continuous,
  interimTranscript,
  voices,
  selectedVoiceId,
  onToggleListening,
  onInterruptVoice,
  onToggleMute,
  onToggleContinuous,
  onSelectVoice,
  liveState,
  liveInputTranscript,
  liveOutputTranscript,
  onToggleLiveSession,
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [emblemError, setEmblemError] = useState(false);
  const [isRecordingTranscribe, setIsRecordingTranscribe] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState('');
  const recorderRef = useRef<AudioRecorderHelper | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const handleToggleTranscribe = async () => {
    setTranscribeError('');
    if (!isRecordingTranscribe) {
      try {
        const helper = new AudioRecorderHelper();
        await helper.start();
        recorderRef.current = helper;
        setIsRecordingTranscribe(true);
      } catch (err) {
        setTranscribeError(
          err instanceof Error ? err.message : 'Unable to access microphone.'
        );
      }
      return;
    }

    const helper = recorderRef.current;
    recorderRef.current = null;
    setIsRecordingTranscribe(false);
    if (!helper) return;

    setIsTranscribing(true);
    try {
      const { audioBase64, mimeType } = await helper.stop();
      const resp = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType }),
      });
      const data = (await resp.json()) as { text?: string; error?: string };
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Audio transcription failed.');
      }
      if (data.text) {
        setInput((prev) => (prev ? `${prev.trimEnd()} ${data.text}` : data.text!));
      }
    } catch (err) {
      setTranscribeError(
        err instanceof Error ? err.message : 'Audio transcription failed.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) return;
    onSendMessage(trimmed || 'Analyze the attached file.', attachments);
    setInput('');
    setAttachments([]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files) return;
    const loaded: ChatAttachment[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || '');
            resolve(res.split(',')[1] || '');
          };
          reader.readAsDataURL(file);
        });
        loaded.push({
          name: file.name,
          mimeType: file.type,
          size: file.size,
          base64Data: base64,
        });
      } else {
        const text = await file.text();
        loaded.push({
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          textPreview: text.slice(0, 20000),
        });
      }
    }
    setAttachments((prev) => [...prev, ...loaded]);
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full px-4 md:px-6 py-4">
      {/* Voice Bar */}
      {(voiceOpen || listening || speaking || liveState === 'connected' || liveState === 'connecting') && (
        <div className="mb-3 shrink-0">
          <VoiceVisualizer
            listening={listening}
            speaking={speaking}
            muted={muted}
            continuous={continuous}
            interimTranscript={interimTranscript}
            voices={voices}
            selectedVoiceId={selectedVoiceId}
            onToggleListening={onToggleListening}
            onInterrupt={onInterruptVoice}
            onToggleMute={onToggleMute}
            onToggleContinuous={onToggleContinuous}
            onSelectVoice={onSelectVoice}
            liveState={liveState}
            liveInputTranscript={liveInputTranscript}
            liveOutputTranscript={liveOutputTranscript}
            onToggleLiveSession={onToggleLiveSession}
          />
        </div>
      )}

      {/* Conversation Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/10 bg-[#0D1119] mb-5 flex items-center justify-center">
              {!emblemError ? (
                <img
                  src="/src/assets/images/scopex_emblem_1795015235754.jpg"
                  alt="SCOPE-X Emblem"
                  referrerPolicy="no-referrer"
                  onError={() => setEmblemError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="font-display font-bold text-xl text-blue-400">SX</span>
              )}
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-white">
              One Intelligence. Infinite Possibilities.
            </h1>
            <p className="mt-2.5 text-sm md:text-base text-slate-400 max-w-xl leading-relaxed">
              Direct SCOPE-X using text or voice to build live applications, run web-grounded research, compose documents, generate media, and manage your studio.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl text-left">
              {SUGGESTED_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => onSendMessage(cmd)}
                  className="px-4 py-3 rounded-xl bg-[#0D1119] border border-white/[0.08] hover:border-blue-500/40 hover:bg-[#121824] text-sm text-slate-200 transition-colors text-left"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600/20 border border-blue-500/30 text-slate-100'
                    : 'bg-[#0D1119] border border-white/[0.08] text-slate-200'
                }`}
              >
                {msg.role === 'assistant' && (msg.provider || msg.model) && (
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-xs text-slate-400">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {msg.provider ? msg.provider.toUpperCase() : 'SCOPE-X'}
                        {msg.model ? ` · ${msg.model}` : ''}
                      </span>
                      {msg.fallbackNote && (
                        <span className="text-[11px] text-amber-300/90">
                          ({msg.fallbackNote})
                        </span>
                      )}
                    </div>
                    {msg.content && (
                      <button
                        type="button"
                        onClick={() => onSpeakMessage(msg.content)}
                        className="inline-flex items-center gap-1 hover:text-blue-400 transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Listen
                      </button>
                    )}
                  </div>
                )}

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2 text-xs text-blue-300">
                    {msg.attachments.map((att, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        <FileCode2 className="w-3.5 h-3.5" />
                        {att.name}
                      </span>
                    ))}
                  </div>
                )}

                {msg.toolActions && msg.toolActions.length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    {msg.toolActions.map((act) => (
                      <div
                        key={act.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#07090E] border border-white/[0.07] text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {act.status === 'running' ? (
                            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          )}
                          <span className="text-slate-200 truncate">{act.summary}</span>
                        </div>
                        {typeof act.payload?.module === 'string' && (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateModule(act.payload?.module as StudioModule)
                            }
                            className="text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                          >
                            Open
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {msg.content ? (
                  <MarkdownView
                    content={msg.content}
                    onSendCodeToStudio={onSendCodeToStudio}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>{statusText || 'Processing request...'}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Destructive Action Confirmation Prompt */}
        {pendingConfirmDelete && (
          <div className="bg-[#131924] border border-amber-500/35 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-white">
                  Confirm Project Deletion
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Are you sure you want to permanently delete “{pendingConfirmDelete.title}” and all of its files?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onCancelDelete}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                Delete Project
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Attachment Preview Strip */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 py-2">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0D1119] border border-white/10 text-xs text-slate-200"
            >
              <span className="truncate max-w-[180px]">{att.name}</span>
              <button
                type="button"
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, i) => i !== idx))
                }
                className="text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="mt-2 bg-[#0D1119] border border-white/10 focus-within:border-blue-500/60 rounded-xl p-2.5 transition-colors shrink-0"
      >
        {(isStreaming && statusText) || isRecordingTranscribe || isTranscribing || transcribeError ? (
          <div className="px-2 pb-1.5 flex flex-wrap items-center gap-3 text-xs">
            {isStreaming && statusText && (
              <span className="inline-flex items-center gap-1.5 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                {statusText}
              </span>
            )}
            {isRecordingTranscribe && (
              <span className="inline-flex items-center gap-1.5 text-rose-300">
                <AudioLines className="w-3.5 h-3.5" />
                Recording audio — click Stop to transcribe with gemini-3.5-transcribe
              </span>
            )}
            {isTranscribing && (
              <span className="inline-flex items-center gap-1.5 text-violet-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                Transcribing spoken command...
              </span>
            )}
            {transcribeError && (
              <span className="text-amber-300">{transcribeError}</span>
            )}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file, code, image, or audio"
            className="p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleVoicePanel}
            title="Toggle Live Voice & TTS panel"
            className={`p-2.5 rounded-lg transition-colors shrink-0 ${
              voiceOpen || listening || liveState === 'connected'
                ? 'bg-blue-600/25 text-blue-400'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Mic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => void handleToggleTranscribe()}
            disabled={isTranscribing}
            title={
              isRecordingTranscribe
                ? 'Stop recording and transcribe (gemini-3.5-transcribe)'
                : 'Record & Transcribe audio into prompt (gemini-3.5-transcribe)'
            }
            className={`p-2.5 rounded-lg transition-colors shrink-0 ${
              isRecordingTranscribe
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isRecordingTranscribe ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <AudioLines className="w-4 h-4" />
            )}
          </button>

          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Command SCOPE-X to build an app, create video/music, search maps, or play 3D..."
            className="flex-1 bg-transparent resize-none text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none py-2 max-h-36"
          />

          <button
            type="submit"
            disabled={isStreaming || (!input.trim() && attachments.length === 0)}
            className="p-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shrink-0"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
