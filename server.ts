import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { Modality, Type } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ConcreteProviderId,
  ImageEngineProvider,
  MediaTrack,
  ProviderId,
  StudioFile,
} from './src/types/studio.ts';
import {
  ProviderApiError,
  STUDIO_TOOL_DECLARATIONS,
  callOpenAICompatible,
  classifyProviderError,
  getGeminiClient,
  getProvidersStatus,
  isValidModelForProvider,
  recordProviderUsage,
  resolveProviderRoute,
} from './server/aiEngine.ts';
import { getProviderKey, setImageProviderSecret, setProviderSecret } from './server/vault.ts';
import { generateStudioImage, getImageProvidersStatus } from './server/imageEngine.ts';
import {
  deployToVercel,
  executeSandboxCommand,
  exportToGitHub,
  lookupNpmPackage,
  upsertPackageJsonDependency,
  verifyProjectBuild,
} from './server/sandbox.ts';

const PORT = Number(process.env.PORT || 3000);

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1].trim()) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function runTextCompletion(params: {
  requestedProvider: ProviderId;
  requestedModel?: string;
  taskHint: 'chat' | 'app' | 'research' | 'code' | 'writer' | 'fast';
  fallbackEnabled: boolean;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
}): Promise<{
  text: string;
  usedProvider: ConcreteProviderId;
  usedModel: string;
  latencyMs: number;
  fallbackNote?: string;
}> {
  const { chain, skippedReason, missingConfigError } = resolveProviderRoute(
    params.requestedProvider,
    params.requestedModel,
    params.taskHint,
    params.fallbackEnabled
  );

  if (chain.length === 0) {
    throw new Error(
      missingConfigError ||
        'No AI provider is currently configured. Configure GEMINI_API_KEY, GROQ_API_KEY, or NVIDIA_API_KEY.'
    );
  }

  let lastErr = '';
  let primaryFailedMsg = '';

  const buildFallbackNote = (idx: number, activeProvider: ConcreteProviderId): string | undefined => {
    if (idx > 0 && primaryFailedMsg) {
      return `Switched from ${chain[0].provider.toUpperCase()} (${primaryFailedMsg}) to ${activeProvider.toUpperCase()}`;
    }
    if (skippedReason) {
      return `${skippedReason}; routed to ${activeProvider.toUpperCase()}`;
    }
    return undefined;
  };

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    try {
      if (step.provider === 'gemini') {
        const ai = getGeminiClient();
        if (!ai) {
          throw new ProviderApiError(
            'gemini',
            400,
            'missing_key',
            'GEMINI_API_KEY is not configured on the server.'
          );
        }
        const started = Date.now();
        let response;
        try {
          response = await ai.models.generateContent({
            model: step.model,
            contents: params.userPrompt,
            config: {
              systemInstruction: params.systemPrompt,
              ...(params.jsonMode ? { responseMimeType: 'application/json' } : {}),
            },
          });
        } catch (geminiErr) {
          const latencyMs = Date.now() - started;
          const classified = classifyProviderError('gemini', geminiErr, step.model);
          recordProviderUsage('gemini', latencyMs, classified.message);
          throw classified;
        }
        const latencyMs = Date.now() - started;
        recordProviderUsage('gemini', latencyMs);
        const text = response.text ?? '';
        return {
          text,
          usedProvider: 'gemini',
          usedModel: step.model,
          latencyMs,
          fallbackNote: buildFallbackNote(i, 'gemini'),
        };
      } else {
        const result = await callOpenAICompatible({
          provider: step.provider,
          model: step.model,
          systemPrompt: params.systemPrompt,
          messages: [{ role: 'user', content: params.userPrompt }],
          jsonMode: params.jsonMode,
        });
        return {
          text: result.text,
          usedProvider: step.provider,
          usedModel: step.model,
          latencyMs: result.latencyMs,
          fallbackNote: buildFallbackNote(i, step.provider),
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = msg;
      if (i === 0) primaryFailedMsg = msg;
    }
  }

  throw new Error(lastErr || 'All configured AI providers failed to respond.');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'scope-x-server', timestamp: Date.now() });
  });

  app.get('/api/providers', (_req: Request, res: Response) => {
    res.json({ providers: getProvidersStatus() });
  });

  app.get('/api/providers/live-models', async (_req: Request, res: Response) => {
    const out: Record<string, string[]> = {};
    const groqInfo = getProviderKey('groq');
    if (groqInfo.key) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${groqInfo.key}` },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const j = (await r.json()) as { data?: Array<{ id: string }> };
          out.groq = (j.data || []).map((m) => m.id);
        }
      } catch {
        out.groq = [];
      }
    }
    const nvInfo = getProviderKey('nvidia');
    if (nvInfo.key) {
      try {
        const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: `Bearer ${nvInfo.key}` },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const j = (await r.json()) as { data?: Array<{ id: string }> };
          out.nvidia = (j.data || []).map((m) => m.id);
        }
      } catch {
        out.nvidia = [];
      }
    }
    res.json(out);
  });

  app.post('/api/providers/config', (req: Request, res: Response) => {
    const { provider, apiKey } = req.body as {
      provider?: string;
      apiKey?: string | null;
    };

    if (provider !== 'groq' && provider !== 'nvidia') {
      res.status(400).json({
        error:
          'Only groq or nvidia can be configured here. Google Gemini uses server environment credentials (GEMINI_API_KEY).',
      });
      return;
    }

    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
      res.status(400).json({ error: 'apiKey must be a string or null.' });
      return;
    }

    setProviderSecret(provider, apiKey === undefined ? '' : apiKey);
    res.json({ ok: true, providers: getProvidersStatus() });
  });

  app.post('/api/providers/test', async (req: Request, res: Response) => {
    const { provider, model } = req.body as {
      provider?: string;
      model?: string;
    };
    if (!provider || (provider !== 'gemini' && provider !== 'groq' && provider !== 'nvidia')) {
      res.status(400).json({
        ok: false,
        errorType: 'invalid_provider',
        error: 'Invalid provider. Supported providers are gemini, groq, and nvidia.',
      });
      return;
    }

    const concreteProvider: ConcreteProviderId = provider;
    const defaultTestModel =
      concreteProvider === 'gemini'
        ? 'gemini-3.1-flash-lite'
        : concreteProvider === 'groq'
          ? 'openai/gpt-oss-120b'
          : 'nvidia/nemotron-3.5-lightning-30b-a3b';

    const testModel = isValidModelForProvider(concreteProvider, model)
      ? model!.trim()
      : defaultTestModel;

    const started = Date.now();
    try {
      if (concreteProvider === 'gemini') {
        const ai = getGeminiClient();
        if (!ai) {
          res.status(400).json({
            ok: false,
            errorType: 'missing_key',
            error: 'GEMINI_API_KEY is not configured in the server environment.',
          });
          return;
        }
        const r = await ai.models.generateContent({
          model: testModel,
          contents: 'Reply with exactly: OK',
        });
        const latencyMs = Date.now() - started;
        recordProviderUsage('gemini', latencyMs);
        res.json({
          ok: true,
          provider: 'gemini',
          model: testModel,
          latencyMs,
          reply: (r.text ?? 'OK').trim(),
        });
      } else {
        const result = await callOpenAICompatible({
          provider: concreteProvider,
          model: testModel,
          systemPrompt: 'Reply concisely.',
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        });
        res.json({
          ok: true,
          provider: concreteProvider,
          model: testModel,
          latencyMs: result.latencyMs,
          reply: result.text.trim(),
        });
      }
    } catch (err) {
      const latencyMs = Date.now() - started;
      const classified = classifyProviderError(concreteProvider, err, testModel);
      if (concreteProvider === 'gemini') {
        recordProviderUsage('gemini', latencyMs, classified.message);
      }
      res.status(classified.statusCode).json({
        ok: false,
        errorType: classified.errorType,
        error: classified.message,
      });
    }
  });

  // Central AI Assistant SSE stream with real studio tool execution
  app.post('/api/assistant/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const {
        message,
        history = [],
        provider = 'auto',
        model,
        fallbackEnabled = true,
        activeModule = 'assistant',
        activeProject,
        attachments = [],
      } = req.body as {
        message: string;
        history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
        activeModule?: string;
        activeProject?: { title: string; type: string; filePaths: string[] } | null;
        attachments?: Array<{ name: string; mimeType: string; textPreview?: string; base64Data?: string }>;
      };

      if (!message || typeof message !== 'string') {
        sendEvent('error', { error: 'Message text is required.' });
        res.end();
        return;
      }

      const { chain, skippedReason, missingConfigError } = resolveProviderRoute(
        provider,
        model,
        'chat',
        fallbackEnabled
      );
      if (chain.length === 0) {
        sendEvent('error', {
          error:
            missingConfigError ||
            'No AI provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY, or NVIDIA_API_KEY in the server environment or configure Groq/NVIDIA in Settings.',
        });
        res.end();
        return;
      }
      if (skippedReason) {
        sendEvent('status', {
          step: `${skippedReason} — falling back to ${chain[0].provider.toUpperCase()}`,
        });
      }

      const projectContext = activeProject
        ? `Active project: "${activeProject.title}" (type: ${activeProject.type}), files: [${activeProject.filePaths.join(', ')}].`
        : 'No project currently open.';

      const systemInstruction = [
        'You are SCOPE-X, an intelligent, composed, hyper-capable AI operating studio assistant.',
        'You control the entire SCOPE-X studio: App Builder, Research, Writer, Image Studio, Video Studio, Code Studio, Documents, Media & Lyria Music Studio, Google Maps Studio, 3D Studio, Aegis Intercept 3D Game, Projects, and Settings.',
        `Current active module: "${activeModule}". ${projectContext}`,
        'When the user asks you to build an app, edit the current app, research a topic, write content, generate an image, generate or animate a video, compose music, look up places on a map, inspect 3D models, launch the 3D game, create a presentation/PDF, play music, change the studio theme (e.g. darker background), open a module, manage projects, or toggle voice mode, ALWAYS invoke the appropriate tool rather than merely describing it.',
        'Before destructive actions like deleting a project or wiping all files, call manage_project with action="request_delete" so the studio asks the user for explicit confirmation first.',
        'Be concise, insightful, and natural for both reading and voice playback.',
      ].join('\n');

      let completed = false;
      let lastError = '';
      let primaryError = '';

      for (let idx = 0; idx < chain.length; idx++) {
        const target = chain[idx];
        try {
          sendEvent('status', {
            step: `Routing to ${target.provider.toUpperCase()} (${target.model})`,
          });

          if (target.provider === 'gemini') {
            const ai = getGeminiClient();
            if (!ai) throw new Error('GEMINI_API_KEY is not configured.');

            const started = Date.now();
            const geminiContents: Array<{
              role: 'user' | 'model';
              parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
            }> = [];

            for (const h of history.slice(-12)) {
              if (!h.content?.trim()) continue;
              geminiContents.push({
                role: h.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: h.content }],
              });
            }

            const currentParts: Array<{
              text?: string;
              inlineData?: { mimeType: string; data: string };
            }> = [{ text: message }];

            for (const att of attachments) {
              if (att.base64Data && att.mimeType) {
                currentParts.push({
                  inlineData: { mimeType: att.mimeType, data: att.base64Data },
                });
              } else if (att.textPreview) {
                currentParts.push({
                  text: `\n[Attached file "${att.name}"]:\n${att.textPreview.slice(0, 12000)}`,
                });
              }
            }

            geminiContents.push({ role: 'user', parts: currentParts });

            // First turn: tool-aware call so studio actions execute immediately
            const firstPass = await ai.models.generateContent({
              model: target.model,
              contents: geminiContents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: STUDIO_TOOL_DECLARATIONS }],
              },
            });

            const calls = firstPass.functionCalls;
            if (calls && calls.length > 0) {
              const previousContent = firstPass.candidates?.[0]?.content;
              const toolResults: Array<{
                functionResponse: { id?: string; name: string; response: Record<string, unknown> };
              }> = [];

              for (const call of calls) {
                const toolName = call.name || 'unknown_tool';
                const args = (call.args || {}) as Record<string, unknown>;
                sendEvent('status', { step: `Executing studio action: ${toolName}` });

                let executionResult: Record<string, unknown> = { ok: true, args };

                // If play_media was invoked, perform real server music search right away!
                if (toolName === 'play_media' && typeof args.query === 'string') {
                  try {
                    const tracks = await searchItunesTracks(args.query);
                    executionResult = {
                      ok: true,
                      query: args.query,
                      tracks,
                      playableCount: tracks.filter((t) => Boolean(t.previewUrl)).length,
                    };
                  } catch (e) {
                    executionResult = {
                      ok: false,
                      query: args.query,
                      error: e instanceof Error ? e.message : 'Music search failed',
                      tracks: [],
                    };
                  }
                }

                sendEvent('tool', {
                  id: call.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  name: toolName,
                  args,
                  result: executionResult,
                });

                toolResults.push({
                  functionResponse: {
                    id: call.id,
                    name: toolName,
                    response: executionResult,
                  },
                });
              }

              // Follow-up streaming turn with tool results
              const followUpStream = await ai.models.generateContentStream({
                model: target.model,
                contents: [
                  ...geminiContents,
                  ...(previousContent ? [previousContent] : []),
                  { role: 'user', parts: toolResults },
                ],
                config: {
                  systemInstruction,
                },
              });

              for await (const chunk of followUpStream) {
                if (chunk.text) {
                  sendEvent('chunk', { text: chunk.text });
                }
              }
            } else {
              // No tool call; stream or emit text
              const initialText = firstPass.text;
              if (initialText) {
                const chunkSize = 48;
                for (let p = 0; p < initialText.length; p += chunkSize) {
                  sendEvent('chunk', { text: initialText.slice(p, p + chunkSize) });
                }
              }
            }

            const latencyMs = Date.now() - started;
            recordProviderUsage('gemini', latencyMs);
            const fallbackNote =
              idx > 0 && primaryError
                ? `Fallback from ${chain[0].provider.toUpperCase()}: ${primaryError}`
                : skippedReason
                  ? `${skippedReason}; routed to GEMINI`
                  : undefined;
            sendEvent('done', {
              provider: 'gemini',
              model: target.model,
              latencyMs,
              fallbackNote,
            });
            completed = true;
            break;
          } else {
            // Groq / NVIDIA via OpenAI-compatible chat completions
            const attachmentNotes = attachments
              .filter((a) => a.textPreview)
              .map((a) => `\n[Attached file "${a.name}"]:\n${a.textPreview!.slice(0, 8000)}`)
              .join('\n');

            const result = await callOpenAICompatible({
              provider: target.provider,
              model: target.model,
              systemPrompt: `${systemInstruction}\nIf the user clearly requests opening a studio module, append a single line at the very end: [[NAVIGATE:<module>]] where <module> is one of builder, research, writer, images, video, code, documents, media, maps, studio3d, game, projects, settings.`,
              messages: [
                ...history.slice(-10).map((h) => ({
                  role: h.role,
                  content: h.content,
                })),
                { role: 'user', content: `${message}${attachmentNotes}` },
              ],
            });

            let output = result.text;
            const validModules = new Set([
              'assistant',
              'builder',
              'research',
              'writer',
              'images',
              'video',
              'code',
              'documents',
              'media',
              'maps',
              'studio3d',
              'game',
              'projects',
              'settings',
            ]);
            const navMatch = output.match(/\[\[NAVIGATE:([a-z0-9]+)\]\]/i);
            if (navMatch?.[1]) {
              const mod = navMatch[1].toLowerCase();
              output = output.replace(navMatch[0], '').trim();
              if (validModules.has(mod)) {
                sendEvent('tool', {
                  id: `tool_${Date.now()}`,
                  name: 'navigate_module',
                  args: { module: mod },
                  result: { ok: true },
                });
              }
            }

            const chunkSize = 48;
            for (let p = 0; p < output.length; p += chunkSize) {
              sendEvent('chunk', { text: output.slice(p, p + chunkSize) });
            }

            const fallbackNote =
              idx > 0 && primaryError
                ? `Fallback from ${chain[0].provider.toUpperCase()}: ${primaryError}`
                : skippedReason
                  ? `${skippedReason}; routed to ${target.provider.toUpperCase()}`
                  : undefined;

            sendEvent('done', {
              provider: target.provider,
              model: target.model,
              latencyMs: result.latencyMs,
              fallbackNote,
            });
            completed = true;
            break;
          }
        } catch (err) {
          const classified = classifyProviderError(target.provider, err, target.model);
          lastError = classified.message;
          if (idx === 0) primaryError = classified.message;
          if (target.provider === 'gemini') {
            recordProviderUsage('gemini', 0, classified.message);
          }
        }
      }

      if (!completed) {
        sendEvent('error', {
          error: lastError || 'Unable to reach any configured AI provider.',
        });
      }
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent('error', { error: msg });
      res.end();
    }
  });

  // SCOPE-X App Builder: creates or incrementally updates multi-file React/TS/HTML/CSS/JS apps
  app.post('/api/builder/generate', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        projectId = 'default',
        projectTitle,
        existingFiles = [],
        errorLog,
        provider = 'auto',
        model,
        fallbackEnabled = true,
      } = req.body as {
        prompt: string;
        projectId?: string;
        projectTitle?: string;
        existingFiles?: StudioFile[];
        errorLog?: string;
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
      };

      if (!prompt?.trim()) {
        res.status(400).json({ error: 'Application prompt is required.' });
        return;
      }

      const isEdit = existingFiles.length > 0;
      const existingContext = isEdit
        ? existingFiles
            .map((f) => `--- FILE: ${f.path} (${f.language}) ---\n${f.content}`)
            .join('\n\n')
        : 'None (brand-new application).';

      const systemPrompt = `You are the SCOPE-X Application Architect and Senior Full-Stack Engineer.
Generate genuinely working, interactive, production-grade web applications in React + TypeScript (preferred) or clean HTML/CSS/JS.
RUNTIME & DESIGN RULES:
1. Entry point MUST be "src/App.tsx" (default export React component) if building React, OR "index.html" if building plain HTML/CSS/JS.
2. In React projects, you may import from "react", "lucide-react", relative modules (e.g. "./components/Navbar.tsx"), and npm packages you declare in "dependenciesToInstall" (loaded cleanly in preview via ESM). Always prefer "lucide-react" and custom SVG/Tailwind UI unless a specialized library (like "chess.js", "recharts", "canvas-confetti", "three") genuinely adds capability.
3. Enforce clean typography, balanced color contrast, responsive layouts, smooth transitions, and accessible controls.
4. Every button, search bar, filter, cart, checkout flow, form, game move, auth form, or admin tab MUST have real interactive React state and working logic (never window.alert() or dead placeholders).
5. If backend/auth/database persistence is requested, include clean modular services/schema files (e.g. "src/lib/storage.ts", "server.ts", ".env.example") and NEVER hardcode secrets or API keys in client files.
6. If existingFiles are provided, MODIFY ONLY the files needed to satisfy the user's request and preserve existing working functionality unless a rewrite is requested.

Return ONLY valid JSON matching this exact structure:
{
  "title": "App Title",
  "description": "Concise 1-sentence description",
  "summary": "Brief changelog summary for version history",
  "plan": ["Step 1...", "Step 2..."],
  "architecture": "Overview of components, state flow, and data model",
  "databaseSchema": "Relational/document schema notes or N/A",
  "dependenciesToInstall": [],
  "buildLogs": ["Step 1...", "Step 2..."],
  "files": [
    { "path": "src/App.tsx", "language": "tsx", "content": "..." }
  ],
  "deletedPaths": []
}`;

      const userPrompt = [
        `User Request: ${prompt}`,
        projectTitle ? `Preferred Title: ${projectTitle}` : '',
        errorLog ? `Runtime/Compile Error to Fix:\n${errorLog}` : '',
        `Mode: ${isEdit ? 'INCREMENTAL EDIT of existing project' : 'NEW APPLICATION'}`,
        `Existing Project Files:\n${existingContext}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const aiResult = await runTextCompletion({
        requestedProvider: provider,
        requestedModel: model,
        taskHint: 'app',
        fallbackEnabled,
        systemPrompt,
        userPrompt,
        jsonMode: true,
      });

      const parsed = safeJsonParse<{
        title?: string;
        description?: string;
        summary?: string;
        plan?: string[];
        architecture?: string;
        databaseSchema?: string;
        dependenciesToInstall?: string[];
        buildLogs?: string[];
        files?: Array<{ path: string; language?: string; content: string }>;
        deletedPaths?: string[];
      }>(aiResult.text);

      if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        res.status(502).json({
          error: 'The AI returned an invalid application structure. Please retry or switch models.',
          rawPreview: aiResult.text.slice(0, 400),
        });
        return;
      }

      const now = Date.now();
      const mergedMap = new Map<string, StudioFile>(
        existingFiles.map((f) => [f.path, f])
      );
      for (const del of parsed.deletedPaths || []) {
        mergedMap.delete(del);
      }
      for (const f of parsed.files) {
        mergedMap.set(f.path, {
          id: mergedMap.get(f.path)?.id || `file_${now}_${Math.random().toString(36).slice(2, 6)}`,
          path: f.path,
          language: f.language || 'tsx',
          content: f.content,
          updatedAt: now,
        });
      }
      const verification = await verifyProjectBuild(projectId, Array.from(mergedMap.values()));

      res.json({
        title: parsed.title || projectTitle || 'Untitled SCOPE-X App',
        description: parsed.description || prompt.slice(0, 140),
        summary: parsed.summary || (isEdit ? `Updated: ${prompt.slice(0, 80)}` : 'Initial build'),
        plan: parsed.plan || [],
        architecture: parsed.architecture || 'Modular React + TypeScript architecture',
        databaseSchema: parsed.databaseSchema || 'Client-reactive state store',
        dependenciesToInstall: parsed.dependenciesToInstall || [],
        buildLogs: parsed.buildLogs || ['Compiled modules', 'Mounted preview bundle'],
        files: parsed.files,
        deletedPaths: parsed.deletedPaths || [],
        verification,
        usedProvider: aiResult.usedProvider,
        usedModel: aiResult.usedModel,
        latencyMs: aiResult.latencyMs,
        fallbackNote: aiResult.fallbackNote,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Autonomous Multi-Step Coding Agent over SSE (Inspect -> Plan -> Generate -> Install -> Verify -> Auto-Fix)
  app.post('/api/builder/agent', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const {
        prompt,
        projectId = `proj_${Date.now()}`,
        projectTitle,
        existingFiles = [],
        errorLog,
        provider = 'auto',
        model,
        fallbackEnabled = true,
      } = req.body as {
        prompt: string;
        projectId?: string;
        projectTitle?: string;
        existingFiles?: StudioFile[];
        errorLog?: string;
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
      };

      if (!prompt?.trim()) {
        sendEvent('error', { error: 'Application prompt is required.' });
        res.end();
        return;
      }

      const isEdit = existingFiles.length > 0;

      // Phase 1: Inspect workspace
      sendEvent('step', {
        phase: 'inspect',
        status: 'running',
        label: isEdit
          ? `Inspecting ${existingFiles.length} existing project file(s)`
          : 'Analyzing application requirements & target architecture',
      });

      const fileManifest = existingFiles
        .map((f) => `- ${f.path} (${f.language}, ${f.content.length} chars)`)
        .join('\n');
      const existingContext = isEdit
        ? existingFiles
            .map((f) => `--- FILE: ${f.path} (${f.language}) ---\n${f.content}`)
            .join('\n\n')
        : 'None (brand-new project).';

      sendEvent('step', {
        phase: 'inspect',
        status: 'completed',
        label: isEdit
          ? `Inspected ${existingFiles.length} files (${existingFiles.map((f) => f.path).slice(0, 4).join(', ')}${existingFiles.length > 4 ? '...' : ''})`
          : 'Initialized clean sandbox workspace',
      });

      // Phase 2: Plan & Generate
      sendEvent('step', {
        phase: 'plan',
        status: 'running',
        label: 'Designing architecture, UI system, and file changes',
      });

      const agentSystemPrompt = `You are the SCOPE-X Autonomous Coding Agent (inspired by Lovable, Replit Agent, and Base44).
Build complete, functional, modern web applications with React + TypeScript + Tailwind CSS (preferred) or HTML/CSS/JS.

DESIGN & ARCHITECTURE EXCELLENCE:
1. Typography & Visual Hierarchy: Strong typography scale, deliberate color palettes, balanced spacing, clean 1px structural borders, responsive desktop/tablet/mobile layouts, crisp interactive states, and accessible labels.
2. Working Interactivity: Every button, modal, search bar, filter, cart, checkout flow, authentication form, dashboard chart/table, game board/rules, or admin control MUST execute real working logic with clean TypeScript types. Never use window.alert() or placeholder stubs.
3. Database & Backend Support: When user requests auth, accounts, database persistence, API endpoints, or admin dashboards, scaffold real clean modules (e.g., localStorage/IndexedDB persistence layer + optional Supabase/Firebase client wrapper or Express "server.ts" API route template + ".env.example" — NEVER put API keys or secrets directly in client files).
4. Sandbox Compatibility:
   - Entry point MUST be "src/App.tsx" (default export React component) for React apps, or "index.html" for static HTML apps.
   - Standard dependencies available out of the box: "react", "lucide-react".
   - If you import any additional npm package (e.g., "chess.js", "canvas-confetti", "date-fns", "recharts", "clsx"), list its exact npm package name in "dependenciesToInstall". Only add packages that genuinely add value and compile cleanly in ESM.
   - Use Tailwind CSS classes in JSX (Tailwind CDN is active in Live Preview) plus optional "src/styles.css" custom styles.
5. Incremental Edits: When Existing Project Files are provided, modify ONLY the files necessary to fulfill the request (preserve existing working screens, state, and structure unless asked to redesign).

Return ONLY valid JSON:
{
  "title": "App Title",
  "description": "Concise 1-sentence summary",
  "summary": "Short changelog entry",
  "plan": ["Concise step 1", "Concise step 2", "Concise step 3"],
  "architecture": "Detailed component and state flow summary",
  "databaseSchema": "Data model, tables/collections, or API endpoints",
  "dependenciesToInstall": [],
  "files": [
    { "path": "src/App.tsx", "language": "tsx", "content": "..." }
  ],
  "deletedPaths": []
}`;

      const userPrompt = [
        `User Request: ${prompt}`,
        projectTitle ? `Project Title: ${projectTitle}` : '',
        errorLog ? `Errors to Diagnose & Fix:\n${errorLog}` : '',
        `Mode: ${isEdit ? 'INCREMENTAL EDIT (modify only needed files)' : 'NEW APPLICATION'}`,
        isEdit ? `File Manifest:\n${fileManifest}` : '',
        `Project Source Context:\n${existingContext}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const genResult = await runTextCompletion({
        requestedProvider: provider,
        requestedModel: model,
        taskHint: 'app',
        fallbackEnabled,
        systemPrompt: agentSystemPrompt,
        userPrompt,
        jsonMode: true,
      });

      const parsed = safeJsonParse<{
        title?: string;
        description?: string;
        summary?: string;
        plan?: string[];
        architecture?: string;
        databaseSchema?: string;
        dependenciesToInstall?: string[];
        files?: Array<{ path: string; language?: string; content: string }>;
        deletedPaths?: string[];
      }>(genResult.text);

      if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        sendEvent('error', {
          error: 'AI agent returned an unreadable file bundle. Please retry or try another model.',
        });
        res.end();
        return;
      }

      sendEvent('step', {
        phase: 'plan',
        status: 'completed',
        label: 'Architecture & implementation plan ready',
        detail: (parsed.plan || []).join(' • '),
      });

      sendEvent('step', {
        phase: 'generate',
        status: 'completed',
        label: `Generated ${parsed.files.length} file(s) via ${genResult.usedProvider.toUpperCase()} (${genResult.usedModel})`,
        detail: parsed.files.map((f) => f.path).join(', '),
      });

      // Merge files into workspace snapshot
      const now = Date.now();
      const workspaceMap = new Map<string, StudioFile>(
        existingFiles.map((f) => [f.path.replace(/^\.?\//, ''), { ...f }])
      );
      for (const del of parsed.deletedPaths || []) {
        workspaceMap.delete(del.replace(/^\.?\//, ''));
      }
      for (const f of parsed.files) {
        const cleanPath = f.path.replace(/^\.?\//, '');
        const prev = workspaceMap.get(cleanPath);
        workspaceMap.set(cleanPath, {
          id: prev?.id || `file_${now}_${Math.random().toString(36).slice(2, 6)}`,
          path: cleanPath,
          language: f.language || 'tsx',
          content: f.content,
          updatedAt: now,
        });
      }

      let currentFiles = Array.from(workspaceMap.values());
      const changedPaths = new Set(parsed.files.map((f) => f.path.replace(/^\.?\//, '')));

      // Phase 3: Install declared packages (excluding built-in react/react-dom/lucide-react)
      const requestedDeps = (parsed.dependenciesToInstall || []).filter(
        (d) =>
          typeof d === 'string' &&
          d.trim() &&
          !['react', 'react-dom', 'lucide-react', 'tailwindcss'].includes(d.trim().toLowerCase())
      );

      if (requestedDeps.length > 0) {
        sendEvent('step', {
          phase: 'install',
          status: 'running',
          label: `Resolving ${requestedDeps.length} npm package(s): ${requestedDeps.join(', ')}`,
        });
        const resolvedDeps: Array<{ name: string; version: string }> = [];
        for (const dep of requestedDeps.slice(0, 6)) {
          try {
            const info = await lookupNpmPackage(dep);
            resolvedDeps.push({ name: info.name, version: info.version });
          } catch {
            // Skip invalid/non-existent packages; build verify will catch if imported
          }
        }
        if (resolvedDeps.length > 0) {
          currentFiles = upsertPackageJsonDependency(
            currentFiles,
            parsed.title || projectTitle || 'SCOPE-X App',
            resolvedDeps
          );
          changedPaths.add('package.json');
        }
        sendEvent('step', {
          phase: 'install',
          status: 'completed',
          label:
            resolvedDeps.length > 0
              ? `Added ${resolvedDeps.map((d) => `${d.name}@${d.version}`).join(', ')} to package.json`
              : 'Package check complete',
        });
      }

      // Phase 4: Real Sandbox Build & Verification + Auto-Fix Loop (up to 2 repair cycles)
      sendEvent('step', {
        phase: 'verify',
        status: 'running',
        label: 'Running isolated esbuild compilation & security check',
      });

      let verification = await verifyProjectBuild(projectId, currentFiles);
      let activeProvider = genResult.usedProvider;
      let activeModel = genResult.usedModel;
      let repairPass = 0;

      while (!verification.passed && repairPass < 2) {
        repairPass += 1;
        const errSummary = verification.errors
          .map((e) => `${e.file || 'project'}:${e.line || 0} - ${e.message}`)
          .join('\n');

        sendEvent('step', {
          phase: 'fix',
          status: 'running',
          label: `Detected ${verification.errors.length} build issue(s) — auto-repair pass ${repairPass}/2`,
          detail: errSummary.slice(0, 220),
        });

        try {
          const repairCompletion = await runTextCompletion({
            requestedProvider: provider,
            requestedModel: model,
            taskHint: 'code',
            fallbackEnabled,
            systemPrompt: `You are debugging an application inside the SCOPE-X isolated esbuild sandbox.
Fix ONLY the files causing the compile/import errors below. Return ONLY valid JSON:
{
  "files": [
    { "path": "src/...", "language": "tsx", "content": "complete corrected file content" }
  ]
}`,
            userPrompt: `Build Errors:\n${errSummary}\n\nCurrent Files:\n${currentFiles
              .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
              .join('\n\n')}`,
            jsonMode: true,
          });

          const repairParsed = safeJsonParse<{
            files?: Array<{ path: string; language?: string; content: string }>;
          }>(repairCompletion.text);

          if (repairParsed?.files && repairParsed.files.length > 0) {
            activeProvider = repairCompletion.usedProvider;
            activeModel = repairCompletion.usedModel;
            const repairMap = new Map(currentFiles.map((f) => [f.path, f]));
            for (const rf of repairParsed.files) {
              const cleanPath = rf.path.replace(/^\.?\//, '');
              const prev = repairMap.get(cleanPath);
              repairMap.set(cleanPath, {
                id: prev?.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                path: cleanPath,
                language: rf.language || prev?.language || 'tsx',
                content: rf.content,
                updatedAt: Date.now(),
              });
              changedPaths.add(cleanPath);
            }
            currentFiles = Array.from(repairMap.values());
            verification = await verifyProjectBuild(projectId, currentFiles);

            sendEvent('step', {
              phase: 'fix',
              status: verification.passed ? 'completed' : 'failed',
              label: verification.passed
                ? `Auto-repair pass ${repairPass} resolved all build errors`
                : `Auto-repair pass ${repairPass} finished (${verification.errors.length} error(s) remaining)`,
            });
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      sendEvent('step', {
        phase: 'verify',
        status: verification.passed ? 'completed' : 'failed',
        label: verification.passed
          ? `Build verified (${verification.compiledFiles} modules, ${(verification.bundleBytes / 1024).toFixed(1)} KB in ${verification.durationMs}ms)`
          : `Build check reported ${verification.errors.length} error(s)`,
      });

      const buildLogs = [
        ...(parsed.plan || []).map((p) => `Plan: ${p}`),
        `Compiled ${verification.compiledFiles} module(s) via esbuild in ${verification.durationMs}ms (${(verification.bundleBytes / 1024).toFixed(1)} KB)`,
        ...(verification.securityWarnings.map((w) => `Security notice: ${w}`)),
        verification.passed
          ? 'Verification passed — preview ready.'
          : `Build errors: ${verification.errors.map((e) => e.message).join('; ')}`,
      ];

      sendEvent('done', {
        title: parsed.title || projectTitle || 'Untitled SCOPE-X App',
        description: parsed.description || prompt.slice(0, 140),
        summary: parsed.summary || (isEdit ? `Updated: ${prompt.slice(0, 80)}` : 'Initial build'),
        plan: parsed.plan || [],
        architecture: parsed.architecture || 'Modular React + TypeScript architecture',
        databaseSchema: parsed.databaseSchema || 'Client-reactive state store',
        files: currentFiles,
        changedFiles: Array.from(changedPaths),
        deletedPaths: parsed.deletedPaths || [],
        buildLogs,
        verification,
        usedProvider: activeProvider,
        usedModel: activeModel,
        latencyMs: genResult.latencyMs,
        fallbackNote: genResult.fallbackNote,
      });
      res.end();
    } catch (err) {
      sendEvent('error', {
        error: err instanceof Error ? err.message : 'App Builder agent failed.',
      });
      res.end();
    }
  });

  // Sandbox Verification Endpoint (real esbuild compile + security check)
  app.post('/api/sandbox/verify', async (req: Request, res: Response) => {
    try {
      const { projectId = 'default', files = [] } = req.body as {
        projectId?: string;
        files: StudioFile[];
      };
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: 'Project files are required for build verification.' });
        return;
      }
      const verification = await verifyProjectBuild(projectId, files);
      res.json({ verification });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Sandbox Package Installation Endpoint
  app.post('/api/sandbox/install', async (req: Request, res: Response) => {
    try {
      const {
        projectId = 'default',
        projectTitle = 'SCOPE-X App',
        packageName,
        files = [],
      } = req.body as {
        projectId?: string;
        projectTitle?: string;
        packageName: string;
        files: StudioFile[];
      };
      if (!packageName?.trim()) {
        res.status(400).json({ error: 'packageName is required.' });
        return;
      }
      const pkg = await lookupNpmPackage(packageName.trim());
      const updatedFiles = upsertPackageJsonDependency(files, projectTitle, [
        { name: pkg.name, version: pkg.version },
      ]);
      const verification = await verifyProjectBuild(projectId, updatedFiles);
      res.json({
        ok: true,
        package: pkg,
        files: updatedFiles,
        verification,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Isolated Sandbox Command Runner
  app.post('/api/sandbox/command', async (req: Request, res: Response) => {
    try {
      const {
        projectId = 'default',
        projectTitle = 'SCOPE-X App',
        command,
        files = [],
        projectEnv = {},
      } = req.body as {
        projectId?: string;
        projectTitle?: string;
        command: string;
        files: StudioFile[];
        projectEnv?: Record<string, string>;
      };

      if (!command || typeof command !== 'string') {
        res.status(400).json({ error: 'Command string is required.' });
        return;
      }

      const outcome = await executeSandboxCommand({
        projectId,
        projectTitle,
        command,
        files,
        projectEnv,
      });
      res.json(outcome);
    } catch (err) {
      res.status(500).json({
        ok: false,
        output: '',
        stderr: err instanceof Error ? err.message : 'Sandbox command execution error.',
      });
    }
  });

  // GitHub Repository Export / Push (real GitHub REST API, PAT never persisted)
  app.post('/api/builder/github-export', async (req: Request, res: Response) => {
    try {
      const {
        token,
        repoName,
        description,
        isPrivate = false,
        commitMessage,
        files = [],
      } = req.body as {
        token: string;
        repoName: string;
        description?: string;
        isPrivate?: boolean;
        commitMessage?: string;
        files: StudioFile[];
      };
      const result = await exportToGitHub({
        token,
        repoName,
        description,
        isPrivate,
        commitMessage,
        files,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Vercel Deployment Endpoint (real Vercel Deployments v13 API, token never persisted)
  app.post('/api/builder/vercel-deploy', async (req: Request, res: Response) => {
    try {
      const { token, projectName, files = [], envVars = {} } = req.body as {
        token: string;
        projectName: string;
        files: StudioFile[];
        envVars?: Record<string, string>;
      };
      const result = await deployToVercel({
        token,
        projectName,
        files,
        envVars,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI Research Studio: Google Search Grounding + URL Context + Structured Report
  app.post('/api/research', async (req: Request, res: Response) => {
    try {
      const { query, includeComparison = true } = req.body as {
        query: string;
        includeComparison?: boolean;
      };
      if (!query?.trim()) {
        res.status(400).json({ error: 'Research query is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({
          error: 'Gemini server key is required for live Google Search grounding.',
        });
        return;
      }

      const urlsInQuery = query.match(/https?:\/\/[^\s)]+/g) ?? [];
      const tools: Array<Record<string, unknown>> = [{ googleSearch: {} }];
      if (urlsInQuery.length > 0) {
        tools.push({ urlContext: {} });
      }

      const started = Date.now();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Conduct thorough, up-to-date research on: "${query}".
Provide:
1. An executive summary.
2. Well-structured thematic sections with concrete facts, prices/specs/dates where relevant.
${includeComparison ? '3. A clean Markdown comparison table when comparing options/products/approaches.' : ''}
Cite facts accurately.`,
        config: {
          tools,
        },
      });
      const latencyMs = Date.now() - started;
      recordProviderUsage('gemini', latencyMs);

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources: Array<{ title: string; uri: string }> = [];
      const seen = new Set<string>();
      for (const ch of chunks) {
        const web = (ch as { web?: { uri?: string; title?: string } }).web;
        if (web?.uri && !seen.has(web.uri)) {
          seen.add(web.uri);
          sources.push({
            title: web.title || web.uri,
            uri: web.uri,
          });
        }
      }

      res.json({
        query,
        markdown: response.text ?? '',
        sources,
        latencyMs,
        model: 'gemini-4-hydrogen',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordProviderUsage('gemini', 0, msg);
      res.status(500).json({ error: msg });
    }
  });

  // AI Writer Studio
  app.post('/api/writer', async (req: Request, res: Response) => {
    try {
      const {
        topic,
        format = 'article',
        tone = 'editorial',
        length = 'medium',
        provider = 'auto',
        model,
        fallbackEnabled = true,
      } = req.body as {
        topic: string;
        format?: string;
        tone?: string;
        length?: string;
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
      };

      if (!topic?.trim()) {
        res.status(400).json({ error: 'Topic or prompt is required.' });
        return;
      }

      const result = await runTextCompletion({
        requestedProvider: provider,
        requestedModel: model,
        taskHint: 'writer',
        fallbackEnabled,
        systemPrompt: `You are an acclaimed author, editor, and communications strategist in SCOPE-X Writer Studio.
Write a ${length}-length ${format} in a ${tone} tone. Format cleanly in Markdown with a compelling title.`,
        userPrompt: topic,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI Code Studio
  app.post('/api/code', async (req: Request, res: Response) => {
    try {
      const {
        task,
        code = '',
        language = 'typescript',
        action = 'generate',
        provider = 'auto',
        model,
        fallbackEnabled = true,
      } = req.body as {
        task: string;
        code?: string;
        language?: string;
        action?: 'generate' | 'explain' | 'debug' | 'refactor';
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
      };

      if (!task?.trim() && !code.trim()) {
        res.status(400).json({ error: 'Provide either a task description or source code.' });
        return;
      }

      const result = await runTextCompletion({
        requestedProvider: provider,
        requestedModel: model,
        taskHint: 'code',
        fallbackEnabled,
        systemPrompt: `You are the SCOPE-X Principal Code Assistant.
Action requested: ${action.toUpperCase()} (${language}).
Provide crisp architectural reasoning, identify edge cases or bugs, and return complete, copy-ready ${language} code blocks.`,
        userPrompt: `Task: ${task}\n\nSource Code:\n\`\`\`${language}\n${code}\n\`\`\``,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI Document & Presentation Studio
  app.post('/api/documents', async (req: Request, res: Response) => {
    try {
      const {
        topic,
        kind = 'presentation',
        slideCount = 7,
        provider = 'auto',
        model,
        fallbackEnabled = true,
      } = req.body as {
        topic: string;
        kind?: 'presentation' | 'document';
        slideCount?: number;
        provider?: ProviderId;
        model?: string;
        fallbackEnabled?: boolean;
      };

      if (!topic?.trim()) {
        res.status(400).json({ error: 'Document topic is required.' });
        return;
      }

      const result = await runTextCompletion({
        requestedProvider: provider,
        requestedModel: model,
        taskHint: 'writer',
        fallbackEnabled,
        systemPrompt: `You are the SCOPE-X Document & Presentation Architect.
Generate a ${kind === 'presentation' ? `${slideCount}-slide executive presentation deck` : 'comprehensive structured document ready for PDF export'}.
Return ONLY valid JSON:
{
  "title": "Main Title",
  "subtitle": "Subtitle or Executive Tagline",
  "content": "Full Markdown document body (detailed sections, bullet lists, conclusions)",
  "slides": [
    { "title": "Slide Title", "bullets": ["Point 1", "Point 2", "Point 3"], "speakerNotes": "Concise presenter notes" }
  ]
}`,
        userPrompt: `Topic: ${topic}\nKind: ${kind}`,
        jsonMode: true,
      });

      const parsed = safeJsonParse<{
        title?: string;
        subtitle?: string;
        content?: string;
        slides?: Array<{ title: string; bullets: string[]; speakerNotes?: string }>;
      }>(result.text);

      if (!parsed) {
        res.status(502).json({ error: 'Could not parse generated document JSON.' });
        return;
      }

      res.json({
        kind,
        title: parsed.title || topic,
        subtitle: parsed.subtitle || 'Generated by SCOPE-X Document Studio',
        content: parsed.content || '',
        slides: parsed.slides || [],
        usedProvider: result.usedProvider,
        usedModel: result.usedModel,
        latencyMs: result.latencyMs,
        fallbackNote: result.fallbackNote,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI Image Studio Configuration & Model Catalog
  app.get('/api/images/config', (_req: Request, res: Response) => {
    res.json(getImageProvidersStatus());
  });

  app.post('/api/images/config', (req: Request, res: Response) => {
    const { provider, apiKey } = req.body as {
      provider?: string;
      apiKey?: string | null;
    };
    if (provider !== 'pollinations') {
      res.status(400).json({
        error: 'Only Pollinations API credentials can be updated via this endpoint.',
      });
      return;
    }
    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
      res.status(400).json({ error: 'apiKey must be a string or null.' });
      return;
    }
    setImageProviderSecret('pollinations', apiKey === undefined ? '' : apiKey);
    res.json({ ok: true, ...getImageProvidersStatus() });
  });

  // AI Image Studio (Pollinations FLUX/MAI/Z-Image + Gemini Image Engine with Prompt Enhancement & Fallback)
  app.post('/api/images/generate', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        aspectRatio = '1:1',
        imageSize = '1K',
        provider = 'auto',
        model,
        enableSearch = false,
        enhancePrompt = true,
        fallbackEnabled = true,
        sourceImageBase64,
        sourceMimeType,
      } = req.body as {
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
      };

      if (!prompt?.trim()) {
        res.status(400).json({ error: 'Image prompt is required.' });
        return;
      }

      const result = await generateStudioImage({
        prompt,
        aspectRatio,
        imageSize,
        provider,
        model,
        enableSearch,
        enhancePrompt,
        fallbackEnabled,
        sourceImageBase64,
        sourceMimeType,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaOrAuth =
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('403') ||
        msg.includes('429');
      res.status(isQuotaOrAuth ? 402 : 500).json({ error: msg });
    }
  });

  // Lyria Music Studio (lyria-3-clip-preview & lyria-3-pro-preview)
  app.post('/api/music/generate', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        title,
        tier = 'clip',
        referenceImageBase64,
        referenceMimeType,
      } = req.body as {
        prompt: string;
        title?: string;
        tier?: 'clip' | 'pro';
        referenceImageBase64?: string;
        referenceMimeType?: string;
      };

      if (!prompt?.trim()) {
        res.status(400).json({ error: 'Music prompt is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
        return;
      }

      const chosenTier = tier === 'pro' ? 'pro' : 'clip';
      const modelId = chosenTier === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';
      const started = Date.now();

      const contents: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [{ text: prompt.trim() }];
      if (referenceImageBase64 && referenceMimeType) {
        contents.push({
          inlineData: { data: referenceImageBase64, mimeType: referenceMimeType },
        });
      }

      const responseStream = await ai.models.generateContentStream({
        model: modelId,
        contents,
        config: {
          responseModalities: ['AUDIO', 'TEXT'],
        },
      });

      const audioChunks: Buffer[] = [];
      let audioMimeType = chosenTier === 'pro' ? 'audio/mpeg' : 'audio/mpeg';
      let lyrics = '';

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.text) {
            lyrics += part.text;
          } else if (part.inlineData?.data) {
            if (part.inlineData.mimeType) {
              audioMimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
        }
      }

      const latencyMs = Date.now() - started;
      recordProviderUsage('gemini', latencyMs);

      if (audioChunks.length === 0) {
        res.status(502).json({
          error: lyrics || `No audio stream chunks were returned by ${modelId}.`,
        });
        return;
      }

      const combined = Buffer.concat(audioChunks).toString('base64');
      res.json({
        audioDataUrl: `data:${audioMimeType};base64,${combined}`,
        mimeType: audioMimeType,
        lyrics: lyrics.trim(),
        model: modelId,
        tier: chosenTier,
        title: title?.trim() || prompt.trim().slice(0, 48),
        latencyMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordProviderUsage('gemini', 0, msg);
      const isPaidKeyHint =
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('403') ||
        msg.includes('429') ||
        msg.toLowerCase().includes('billing') ||
        msg.toLowerCase().includes('paid');
      res.status(isPaidKeyHint ? 402 : 500).json({
        error: isPaidKeyHint
          ? `Music generation with Lyria requires a billing-enabled Gemini API key in AI Studio Settings > Secrets. (${msg})`
          : msg,
      });
    }
  });

  // Video Studio (Text-to-Video & Image-to-Video via gemini-omni-1.2-flash Interactions API)
  app.post('/api/video/generate', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        aspectRatio = '16:9',
        duration = 5,
        sourceImageBase64,
        sourceMimeType,
      } = req.body as {
        prompt: string;
        aspectRatio?: '16:9' | '9:16';
        duration?: number;
        sourceImageBase64?: string;
        sourceMimeType?: string;
      };

      if (!prompt?.trim()) {
        res.status(400).json({ error: 'Video prompt is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
        return;
      }

      const chosenAspect = aspectRatio === '9:16' ? '9:16' : '16:9';
      const chosenDuration = [4, 5, 6, 8].includes(Number(duration)) ? Number(duration) : 5;
      const started = Date.now();

      const inputPayload =
        sourceImageBase64 && sourceMimeType
          ? [
              { type: 'text' as const, text: prompt.trim() },
              {
                type: 'image' as const,
                data: sourceImageBase64,
                mime_type: sourceMimeType,
              },
            ]
          : prompt.trim();

      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: inputPayload,
          response_modalities: ['video'],
          response_format: {
            type: 'video',
            aspect_ratio: chosenAspect,
            duration: chosenDuration,
            resolution: '720p',
          },
        },
        { timeout: 300000 }
      );

      const latencyMs = Date.now() - started;
      recordProviderUsage('gemini', latencyMs);

      const outputs = (interaction as unknown as {
        outputs?: Array<{ type?: string; data?: string; uri?: string; mime_type?: string }>;
      }).outputs ?? [];
      const videoOut = outputs.find((o) => o.type === 'video');

      if (!videoOut || (!videoOut.data && !videoOut.uri)) {
        res.status(502).json({
          error: 'No video output was returned by gemini-omni-1.2-flash.',
        });
        return;
      }

      const videoUrl = videoOut.data
        ? `data:${videoOut.mime_type || 'video/mp4'};base64,${videoOut.data}`
        : String(videoOut.uri);

      res.json({
        videoUrl,
        aspectRatio: chosenAspect,
        model: 'gemini-omni-1.2-flash',
        sourceImageUsed: Boolean(sourceImageBase64),
        latencyMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordProviderUsage('gemini', 0, msg);
      const isPaidKeyHint =
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('403') ||
        msg.includes('429') ||
        msg.toLowerCase().includes('billing') ||
        msg.toLowerCase().includes('paid');
      res.status(isPaidKeyHint ? 402 : 500).json({
        error: isPaidKeyHint
          ? `Video generation with gemini-omni-1.2-flash requires a billing-enabled Gemini API key in AI Studio Settings > Secrets. (${msg})`
          : msg,
      });
    }
  });

  // Google Maps Client Config Endpoint (safe fallback if secret was not prefixed with VITE_)
  app.get('/api/maps/config', (_req: Request, res: Response) => {
    const raw =
      process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      '';
    const apiKey = raw && raw !== 'MY_GOOGLE_MAPS_API_KEY' ? raw : '';
    res.json({ apiKey });
  });

  // Gemini Google Maps Grounding Endpoint (gemini-4-hydrogen + { googleMaps: {} })
  app.post('/api/maps/ground', async (req: Request, res: Response) => {
    try {
      const { query, lat, lng } = req.body as {
        query: string;
        lat?: number;
        lng?: number;
      };
      if (!query?.trim()) {
        res.status(400).json({ error: 'Location query is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({
          error: 'GEMINI_API_KEY is required for Google Maps Grounding.',
        });
        return;
      }

      const started = Date.now();
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query.trim(),
        config: {
          tools: [{ googleMaps: {} }],
          ...(hasCoords
            ? {
                toolConfig: {
                  retrievalConfig: {
                    latLng: { latitude: Number(lat), longitude: Number(lng) },
                  },
                },
              }
            : {}),
        },
      });

      const latencyMs = Date.now() - started;
      recordProviderUsage('gemini', latencyMs);

      const groundingMeta = response.candidates?.[0]?.groundingMetadata as
        | {
            groundingChunks?: Array<{
              maps?: {
                uri?: string;
                title?: string;
                placeId?: string;
                placeAnswerSources?: {
                  reviewSnippets?: Array<{ text?: string }>;
                };
              };
            }>;
            googleMapsWidgetContextToken?: string;
          }
        | undefined;

      const places: Array<{
        title: string;
        uri: string;
        placeId?: string;
        reviewSnippets?: string[];
      }> = [];
      const seenUris = new Set<string>();

      for (const ch of groundingMeta?.groundingChunks ?? []) {
        const m = ch.maps;
        if (m?.uri && !seenUris.has(m.uri)) {
          seenUris.add(m.uri);
          places.push({
            title: m.title || 'Google Maps Place',
            uri: m.uri,
            placeId: m.placeId,
            reviewSnippets: (m.placeAnswerSources?.reviewSnippets ?? [])
              .map((s) => s.text || '')
              .filter(Boolean),
          });
        }
      }

      res.json({
        query: query.trim(),
        markdown: response.text ?? '',
        places,
        widgetToken: groundingMeta?.googleMapsWidgetContextToken,
        latencyMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordProviderUsage('gemini', 0, msg);
      const status = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ? 429 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Server-side Text-to-Speech via Gemini 3.8 Flash Lite TTS
  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const {
        text,
        voiceName = 'Charon',
        style = 'Composed, sophisticated, warm British-inspired AI studio assistant',
      } = req.body as {
        text: string;
        voiceName?: string;
        style?: string;
      };

      if (!text?.trim()) {
        res.status(400).json({ error: 'Text is required for speech synthesis.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
        return;
      }

      const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
      const chosenVoice = allowedVoices.includes(voiceName) ? voiceName : 'Charon';

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.slice(0, 2500),
                speechMetadata: {
                  style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: 'No audio output returned from TTS model.' });
        return;
      }

      res.json({
        audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
        voiceName: chosenVoice,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Server-side Audio Transcription via Gemini 3.5 Transcribe
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
      const { audioBase64, mimeType = 'audio/webm' } = req.body as {
        audioBase64: string;
        mimeType?: string;
      };
      if (!audioBase64) {
        res.status(400).json({ error: 'Audio data is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
        return;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: 'Transcribe this spoken user command cleanly without extra commentary.' },
          ],
        },
      });

      res.json({ text: (response.text ?? '').trim() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Legitimate Music Preview Search via iTunes Search API
  app.get('/api/media/search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Search query "q" is required.' });
      return;
    }

    try {
      const tracks = await searchItunesTracks(query);
      res.json({ query, tracks });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Music search unavailable.',
        tracks: [],
      });
    }
  });

  // Mount Vite in dev, or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  // Create explicit HTTP server so WebSocket (/live) and Express share port 3000 cleanly
  const httpServer = http.createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '/';
    const pathname = reqUrl.split('?')[0];
    if (pathname === '/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  liveWss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const ai = getGeminiClient();
    if (!ai) {
      ws.send(JSON.stringify({ type: 'error', error: 'GEMINI_API_KEY is not configured on the server.' }));
      ws.close();
      return;
    }

    const reqUrl = new URL(req.url || '/live', 'http://localhost');
    const requestedVoice = reqUrl.searchParams.get('voice') || 'Charon';
    const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const voiceName = allowedVoices.includes(requestedVoice) ? requestedVoice : 'Charon';

    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let closed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    try {
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          systemInstruction:
            'You are SCOPE-X Live, a composed, sophisticated, real-time voice assistant inside the SCOPE-X AI creation studio. Keep answers natural, concise, and helpful.',
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: 'ready', model: 'gemini-3.8-live', voiceName });
          },
          onmessage: (msg) => {
            const sc = msg.serverContent;
            if (!sc) return;

            if (sc.interrupted) {
              safeSend({ type: 'interrupted' });
            }

            const parts = sc.modelTurn?.parts ?? [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend({
                  type: 'audio',
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                });
              }
            }

            if (sc.inputTranscription?.text) {
              safeSend({ type: 'input_transcript', text: sc.inputTranscription.text });
            }
            if (sc.outputTranscription?.text) {
              safeSend({ type: 'output_transcript', text: sc.outputTranscription.text });
            }
            if (sc.turnComplete) {
              safeSend({ type: 'turn_complete' });
            }
          },
          onerror: (err) => {
            safeSend({
              type: 'error',
              error: err instanceof Error ? err.message : 'Live session error occurred.',
            });
          },
          onclose: () => {
            if (!closed) {
              safeSend({ type: 'closed' });
            }
          },
        },
      });
    } catch (err) {
      safeSend({
        type: 'error',
        error: err instanceof Error ? err.message : 'Failed to connect to gemini-3.8-live.',
      });
      ws.close();
      return;
    }

    ws.on('message', (raw) => {
      if (!session || closed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
        };
        if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && msg.text) {
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        }
      } catch {
        // Ignore malformed client message
      }
    });

    ws.on('close', () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // Ignore close error
      }
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SCOPE-X server running on http://0.0.0.0:${PORT}`);
  });
}

async function searchItunesTracks(query: string): Promise<MediaTrack[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=12`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Music catalog returned HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as {
    results?: Array<{
      trackId?: number;
      trackName?: string;
      artistName?: string;
      collectionName?: string;
      artworkUrl100?: string;
      previewUrl?: string;
      trackViewUrl?: string;
      trackTimeMillis?: number;
    }>;
  };

  return (data.results ?? [])
    .filter((item) => item.trackName && item.artistName)
    .map((item) => ({
      id: String(item.trackId ?? Math.random().toString(36).slice(2)),
      title: item.trackName || 'Unknown Track',
      artist: item.artistName || 'Unknown Artist',
      album: item.collectionName || 'Single',
      artworkUrl: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
      previewUrl: item.previewUrl || '',
      externalUrl: item.trackViewUrl || 'https://music.apple.com',
      durationSec: item.previewUrl
        ? 30
        : Math.round((item.trackTimeMillis ?? 180000) / 1000),
      sourceLabel: item.previewUrl ? 'Licensed 30s Preview (iTunes)' : 'External Listening Link Only',
    }));
}

startServer().catch((err) => {
  console.error('Failed to start SCOPE-X server:', err);
  process.exit(1);
});
