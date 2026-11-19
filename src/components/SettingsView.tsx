import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  KeyRound,
  Loader2,
  Palette,
  RefreshCw,
  ShieldCheck,
  Volume2,
  XCircle,
} from 'lucide-react';
import type {
  ConcreteProviderId,
  ProviderId,
  ProviderStatus,
  StudioTheme,
} from '../types/studio';
import type { VoiceOption } from '../utils/voiceEngine';

interface SettingsViewProps {
  providers: ProviderStatus[];
  selectedProvider: ProviderId;
  selectedModel: string;
  autoRoute: boolean;
  fallbackEnabled: boolean;
  theme: StudioTheme;
  voices: VoiceOption[];
  selectedVoiceId: string;
  onSelectProvider: (p: ProviderId) => void;
  onSelectModel: (m: string) => void;
  onToggleAutoRoute: (val: boolean) => void;
  onToggleFallback: (val: boolean) => void;
  onUpdateTheme: (next: Partial<StudioTheme>) => void;
  onSelectVoice: (id: string) => void;
  onPreviewVoice: (voiceId: string) => void;
  onRefreshProviders: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  providers,
  selectedProvider,
  selectedModel,
  autoRoute,
  fallbackEnabled,
  theme,
  voices,
  selectedVoiceId,
  onSelectProvider,
  onSelectModel,
  onToggleAutoRoute,
  onToggleFallback,
  onUpdateTheme,
  onSelectVoice,
  onPreviewVoice,
  onRefreshProviders,
}) => {
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const allModels = providers.flatMap((p) => p.models);
  const activeProviderObj =
    selectedProvider === 'auto'
      ? null
      : providers.find((p) => p.id === selectedProvider) || null;

  const handleSaveProviderKey = async (
    providerId: Exclude<ConcreteProviderId, 'gemini'>
  ) => {
    setBusyProvider(providerId);
    try {
      const resp = await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          apiKey: keyInputs[providerId] ?? '',
        }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || 'Failed to save configuration.');
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      await onRefreshProviders();
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          ok: true,
          text: 'Configuration saved in encrypted server vault.',
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          ok: false,
          text: err instanceof Error ? err.message : 'Save failed.',
        },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleClearProviderKey = async (
    providerId: Exclude<ConcreteProviderId, 'gemini'>
  ) => {
    setBusyProvider(providerId);
    try {
      await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: null }),
      });
      await onRefreshProviders();
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { ok: true, text: 'Key removed from server vault.' },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleTestProvider = async (providerId: ConcreteProviderId) => {
    setBusyProvider(`test_${providerId}`);
    try {
      const resp = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        reply?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Connection test failed.');
      }
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          ok: true,
          text: `Verified live connection in ${data.latencyMs}ms`,
        },
      }));
      await onRefreshProviders();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          ok: false,
          text: err instanceof Error ? err.message : 'Verification failed.',
        },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">
            Multi-Model Engine & Studio Settings
          </h2>
          <p className="text-xs text-slate-400">
            Configure routing, fallback resilience, voice synthesis, and external server-side provider credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefreshProviders()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D1119] border border-white/10 hover:border-white/20 text-xs text-slate-200"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Status
        </button>
      </div>

      {/* Routing & Default Model */}
      <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 space-y-4">
        <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          Routing & Default Model
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Active Provider Mode
            </label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                const nextP = e.target.value as ProviderId;
                onSelectProvider(nextP);
                if (nextP !== 'auto') {
                  const first = providers.find((p) => p.id === nextP)?.models[0];
                  if (first) onSelectModel(first.id);
                }
              }}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="auto">Automatic Smart Router (Recommended)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.connected ? '(Connected)' : '(Not Configured)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Default Model
            </label>
            <select
              value={selectedModel}
              disabled={selectedProvider === 'auto'}
              onChange={(e) => onSelectModel(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 disabled:opacity-50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              {(selectedProvider === 'auto'
                ? allModels
                : providers.find((p) => p.id === selectedProvider)?.models || allModels
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.provider.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRoute}
              onChange={(e) => onToggleAutoRoute(e.target.checked)}
              className="accent-blue-500"
            />
            Automatically route tasks by specialty (speed vs deep reasoning)
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={fallbackEnabled}
              onChange={(e) => onToggleFallback(e.target.checked)}
              className="accent-blue-500"
            />
            Enable automatic provider fallback if primary model is unavailable
          </label>
        </div>

        {activeProviderObj && !activeProviderObj.connected && (
          <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
            {activeProviderObj.name} is not configured yet.{' '}
            {fallbackEnabled
              ? 'Requests will automatically fall back to a connected provider until configured.'
              : 'Enable automatic fallback or configure its API key below before sending requests.'}
          </div>
        )}
      </div>

      {/* Provider Status & Server-Side Vault */}
      <div className="space-y-3">
        <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-400" />
          AI Providers & Connection Diagnostics
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((p) => {
            const testInfo = testResults[p.id];
            return (
              <div
                key={p.id}
                className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-white">
                        {p.name}
                      </h4>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {p.connected ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Connected · {p.source === 'env' ? 'Server Env' : 'Encrypted Vault'}
                            {p.maskedKey ? ` (${p.maskedKey})` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <XCircle className="w-3.5 h-3.5 text-slate-500" />
                            Not Configured
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyProvider === `test_${p.id}` || !p.connected}
                      onClick={() => void handleTestProvider(p.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-xs text-slate-200 whitespace-nowrap"
                    >
                      {busyProvider === `test_${p.id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {p.description}
                  </p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400 tabular-nums">
                    <span>Calls: {p.usageCount}</span>
                    {p.lastLatencyMs !== undefined && (
                      <span>Latency: {p.lastLatencyMs}ms</span>
                    )}
                  </div>

                  {p.lastError && (
                    <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 break-words">
                      Last error: {p.lastError}
                    </div>
                  )}

                  {testInfo && (
                    <div
                      className={`text-[11px] rounded-lg p-2 ${
                        testInfo.ok
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      }`}
                    >
                      {testInfo.text}
                    </div>
                  )}
                </div>

                {/* Server-side key management for non-Gemini external providers */}
                {p.managedExternally ? (
                  <div className="pt-2 border-t border-white/[0.06] text-[11px] text-slate-400">
                    Managed externally via server-side <code className="font-mono text-slate-300">GEMINI_API_KEY</code> environment secret.
                  </div>
                ) : (
                  <div className="pt-3 border-t border-white/[0.06] space-y-2">
                    {!p.connected && (
                      <div className="text-[11px] text-amber-300/90">
                        Needs <code className="font-mono">{p.id === 'groq' ? 'GROQ_API_KEY' : 'NVIDIA_API_KEY'}</code> in server env or saved securely below.
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <KeyRound className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          value={keyInputs[p.id] || ''}
                          onChange={(e) =>
                            setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder={`Enter ${p.name} API key (stored server-side)...`}
                          className="w-full bg-[#07090E] border border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={
                          busyProvider === p.id || !keyInputs[p.id]?.trim()
                        }
                        onClick={() =>
                          void handleSaveProviderKey(
                            p.id as Exclude<ConcreteProviderId, 'gemini'>
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white whitespace-nowrap"
                      >
                        Save
                      </button>
                      {p.source === 'vault' && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleClearProviderKey(
                              p.id as Exclude<ConcreteProviderId, 'gemini'>
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-xs text-slate-300 hover:text-rose-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Voice & Studio Appearance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-blue-400" />
            Voice Persona Selection
          </h3>
          <select
            value={selectedVoiceId}
            onChange={(e) => onSelectVoice(e.target.value)}
            className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400">
            {voices.find((v) => v.id === selectedVoiceId)?.description}
          </p>
          <button
            type="button"
            onClick={() => onPreviewVoice(selectedVoiceId)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Test Voice Sample
          </button>
        </div>

        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-violet-400" />
            Studio Surface & Accent
          </h3>
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Canvas Darkness</div>
            <div className="flex gap-2">
              {(['charcoal', 'obsidian', 'midnight'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateTheme({ canvas: c })}
                  className={`px-3 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                    theme.canvas === c
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#07090E] border border-white/10 text-slate-300'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Primary Accent</div>
            <div className="flex gap-2">
              {(['blue', 'violet', 'cyan'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onUpdateTheme({ accent: a })}
                  className={`px-3 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                    theme.accent === a
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#07090E] border border-white/10 text-slate-300'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
