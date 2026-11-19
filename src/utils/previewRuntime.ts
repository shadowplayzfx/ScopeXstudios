import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as LucideIcons from 'lucide-react';
import { transform } from 'sucrase';
import type { ProjectEnvVar, StudioFile } from '../types/studio';

declare global {
  interface Window {
    __SCOPEX_RUNTIME__?: {
      React: typeof React;
      ReactDOMClient: typeof ReactDOMClient;
      LucideIcons: typeof LucideIcons;
    };
  }
}

export function ensureParentRuntimeBridge(): void {
  window.__SCOPEX_RUNTIME__ = {
    React,
    ReactDOMClient,
    LucideIcons,
  };
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/');
}

function resolveImportPath(fromPath: string, specifier: string, allPaths: string[]): string | null {
  if (!specifier.startsWith('.')) return null;
  const fromDir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  const parts = (fromDir ? `${fromDir}/${specifier}` : specifier).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  const base = resolved.join('/');
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.json`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
    `${base}.css`,
  ];
  for (const c of candidates) {
    if (allPaths.includes(c)) return c;
  }
  return null;
}

function extractPkgDependencies(files: StudioFile[]): Record<string, string> {
  const pkgFile = files.find((f) => normalizePath(f.path) === 'package.json');
  if (!pkgFile) return {};
  try {
    const parsed = JSON.parse(pkgFile.content) as {
      dependencies?: Record<string, string>;
    };
    return parsed.dependencies || {};
  } catch {
    return {};
  }
}

function getRootPkgName(spec: string): string {
  if (spec.startsWith('@')) {
    return spec.split('/').slice(0, 2).join('/');
  }
  return spec.split('/')[0];
}

export interface PreviewBuildResult {
  html: string;
  compileErrors: string[];
  compiledFileCount: number;
  externalPackages: string[];
}

export function buildLivePreviewDocument(
  files: StudioFile[],
  projectEnvVars: ProjectEnvVar[] = []
): PreviewBuildResult {
  ensureParentRuntimeBridge();
  const compileErrors: string[] = [];
  const normalized = files.map((f) => ({
    ...f,
    path: normalizePath(f.path),
  }));

  const declaredDeps = extractPkgDependencies(normalized);
  const publicEnv: Record<string, string> = {};
  for (const ev of projectEnvVars) {
    if (
      ev.key &&
      (ev.isPublic || ev.key.startsWith('VITE_') || ev.key.startsWith('PUBLIC_'))
    ) {
      publicEnv[ev.key] = ev.value;
    }
  }

  const cssBlocks = normalized
    .filter((f) => f.path.endsWith('.css'))
    .map((f) => f.content)
    .join('\n\n');

  const entryReact =
    normalized.find((f) => f.path === 'src/App.tsx') ||
    normalized.find((f) => f.path === 'src/App.jsx') ||
    normalized.find((f) => f.path === 'App.tsx') ||
    normalized.find((f) => f.path.endsWith('.tsx') || f.path.endsWith('.jsx'));

  const htmlFile = normalized.find((f) => f.path === 'index.html');

  const consoleBridgeScript = `
<script>
window.__PROJECT_ENV__ = ${JSON.stringify(publicEnv)};
(function() {
  var send = function(level, args) {
    try {
      var text = Array.prototype.slice.call(args).map(function(a) {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message || String(a);
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
      window.parent.postMessage({ source: 'scopex-preview', level: level, text: text }, '*');
    } catch (e) {}
  };
  var origLog = console.log;
  var origWarn = console.warn;
  var origErr = console.error;
  console.log = function() { send('log', arguments); origLog.apply(console, arguments); };
  console.warn = function() { send('warn', arguments); origWarn.apply(console, arguments); };
  console.error = function() { send('error', arguments); origErr.apply(console, arguments); };
  window.onerror = function(msg, src, line, col) {
    send('error', [msg + ' (line ' + line + ':' + col + ')']);
  };
  window.onunhandledrejection = function(ev) {
    send('error', ['Unhandled rejection: ' + (ev && ev.reason ? (ev.reason.message || ev.reason) : 'unknown')]);
  };
})();
</script>`;

  // Plain HTML/CSS/JS project
  if (!entryReact && htmlFile) {
    const jsBlocks = normalized
      .filter((f) => f.path.endsWith('.js') && !f.path.includes('server'))
      .map((f) => f.content)
      .join('\n\n');

    let docHtml = htmlFile.content;
    const styleTag = `<style>${cssBlocks}</style>`;
    const scriptTag = jsBlocks ? `<script>${jsBlocks}</script>` : '';
    if (docHtml.includes('</head>')) {
      docHtml = docHtml.replace('</head>', `${consoleBridgeScript}${styleTag}</head>`);
    } else {
      docHtml = `${consoleBridgeScript}${styleTag}${docHtml}`;
    }
    if (scriptTag) {
      if (docHtml.includes('</body>')) {
        docHtml = docHtml.replace('</body>', `${scriptTag}</body>`);
      } else {
        docHtml += scriptTag;
      }
    }
    return {
      html: docHtml,
      compileErrors,
      compiledFileCount: normalized.length,
      externalPackages: [],
    };
  }

  // React / TypeScript multi-file bundle via Sucrase
  const codeFiles = normalized.filter(
    (f) =>
      (f.path.endsWith('.tsx') ||
        f.path.endsWith('.ts') ||
        f.path.endsWith('.jsx') ||
        f.path.endsWith('.js')) &&
      !f.path.startsWith('server') &&
      f.path !== 'vite.config.ts'
  );
  const jsonFiles = normalized.filter(
    (f) => f.path.endsWith('.json') && f.path !== 'package.json' && f.path !== 'tsconfig.json'
  );
  const allPaths = normalized.map((f) => f.path);
  const externalSpecifiers = new Set<string>();

  const moduleEntries: string[] = [];

  for (const jf of jsonFiles) {
    try {
      const parsed = JSON.parse(jf.content);
      moduleEntries.push(
        `${JSON.stringify(jf.path)}: { fn: function(require, module) { module.exports = ${JSON.stringify(parsed)}; }, map: {} }`
      );
    } catch (err) {
      compileErrors.push(`${jf.path}: Invalid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  for (const file of codeFiles) {
    try {
      const transformed = transform(file.content, {
        transforms: ['typescript', 'jsx', 'imports'],
        jsxRuntime: 'classic',
        production: true,
      }).code;

      const resolvedImportsMap: Record<string, string> = {};
      const importRegex = /require\(["']([^"']+)["']\)/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(transformed)) !== null) {
        const spec = match[1];
        if (spec.startsWith('.')) {
          const target = resolveImportPath(file.path, spec, allPaths);
          if (target) resolvedImportsMap[spec] = target;
        } else if (
          spec !== 'react' &&
          spec !== 'react-dom' &&
          spec !== 'react-dom/client' &&
          spec !== 'lucide-react'
        ) {
          externalSpecifiers.add(spec);
        }
      }

      moduleEntries.push(
        `${JSON.stringify(file.path)}: { fn: function(require, module, exports) {\n${transformed}\n}, map: ${JSON.stringify(resolvedImportsMap)} }`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      compileErrors.push(`${file.path}: ${msg}`);
    }
  }

  const entryPath = entryReact ? entryReact.path : codeFiles[0]?.path || 'src/App.tsx';

  // Map external specifiers to esm.sh CDN URLs pinned to declared package.json versions when available
  const externalMap: Record<string, string> = {};
  for (const spec of externalSpecifiers) {
    const root = getRootPkgName(spec);
    const rawVer = declaredDeps[root];
    const cleanVer = rawVer ? rawVer.replace(/^[\^~>=<]+/, '') : '';
    const subpath = spec.slice(root.length);
    const pkgWithVer = cleanVer ? `${root}@${cleanVer}${subpath}` : spec;
    externalMap[spec] = `https://esm.sh/${pkgWithVer}?deps=react@19.0.1,react-dom@19.0.1`;
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    ${cssBlocks}
  </style>
  ${consoleBridgeScript}
</head>
<body>
  <div id="root"></div>
  <script>
    (async function() {
      var runtime = window.parent && window.parent.__SCOPEX_RUNTIME__;
      if (!runtime) {
        document.getElementById('root').innerHTML = '<div style="padding:24px;color:#ef4444;font-family:monospace;">Runtime bridge unavailable.</div>';
        return;
      }
      var React = runtime.React;
      var ReactDOMClient = runtime.ReactDOMClient;
      var LucideIcons = runtime.LucideIcons;

      var SafeLucide = new Proxy(LucideIcons, {
        get: function(target, prop) {
          if (prop in target) return target[prop];
          if (prop === '__esModule') return true;
          return target.Box || function FallbackIcon(props) {
            return React.createElement('span', { style: { display: 'inline-block', width: (props && props.size) || 16, height: (props && props.size) || 16 } });
          };
        }
      });

      window.React = React;

      var externalUrls = ${JSON.stringify(externalMap)};
      var externalCache = {};
      var externalKeys = Object.keys(externalUrls);
      if (externalKeys.length > 0) {
        await Promise.all(externalKeys.map(async function(spec) {
          try {
            var imported = await import(externalUrls[spec]);
            externalCache[spec] = imported;
          } catch (cdnErr) {
            console.warn('Failed loading external package "' + spec + '": ' + (cdnErr && cdnErr.message ? cdnErr.message : cdnErr));
          }
        }));
      }

      var modules = {
        ${moduleEntries.join(',\n')}
      };
      var cache = {};

      function loadModule(id, fromId) {
        if (id === 'react') return React;
        if (id === 'react-dom' || id === 'react-dom/client') return ReactDOMClient;
        if (id === 'lucide-react') return SafeLucide;
        if (externalCache[id]) return externalCache[id];

        var resolved = id;
        if (fromId && modules[fromId] && modules[fromId].map && modules[fromId].map[id]) {
          resolved = modules[fromId].map[id];
        }
        if (resolved.endsWith('.css')) return {};
        if (cache[resolved]) return cache[resolved].exports;
        var modDef = modules[resolved];
        if (!modDef) {
          throw new Error('Cannot resolve module "' + id + '" from "' + (fromId || 'entry') + '"');
        }
        var mod = { exports: {} };
        cache[resolved] = mod;
        modDef.fn(function(childSpec) { return loadModule(childSpec, resolved); }, mod, mod.exports);
        return mod.exports;
      }

      function renderCrash(title, err) {
        var msg = err && err.stack ? err.stack : String(err);
        console.error(err && err.message ? err.message : String(err));
        document.getElementById('root').innerHTML =
          '<div style="padding:24px;background:#0D1117;color:#fca5a5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-height:100vh;">' +
          '<h3 style="margin:0 0 8px 0;color:#f87171;font-size:15px;">' + title + '</h3>' +
          '<pre style="white-space:pre-wrap;font-size:12px;line-height:1.5;background:#161b22;padding:12px;border-radius:8px;border:1px solid #30363d;">' +
          msg.replace(/</g, '&lt;') + '</pre></div>';
      }

      class PreviewErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error) {
          return { hasError: true, error: error };
        }
        componentDidCatch(error) {
          console.error('Render error: ' + (error && error.message ? error.message : String(error)));
        }
        render() {
          if (this.state.hasError) {
            return React.createElement(
              'div',
              { style: { padding: '24px', background: '#0D1117', color: '#fca5a5', fontFamily: 'monospace', minHeight: '100vh' } },
              React.createElement('h3', { style: { color: '#f87171', margin: '0 0 8px 0' } }, 'Component Render Error'),
              React.createElement('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px' } }, String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error))
            );
          }
          return this.props.children;
        }
      }

      try {
        var entryMod = loadModule(${JSON.stringify(entryPath)});
        var AppComponent = entryMod.default || entryMod.App || entryMod;
        if (typeof AppComponent !== 'function') {
          throw new Error('Entry module "' + ${JSON.stringify(entryPath)} + '" does not export a default React component.');
        }
        var rootEl = document.getElementById('root');
        var root = ReactDOMClient.createRoot(rootEl);
        root.render(React.createElement(PreviewErrorBoundary, null, React.createElement(AppComponent)));
      } catch (err) {
        renderCrash('Preview Runtime Error', err);
      }
    })();
  </script>
</body>
</html>`;

  return {
    html,
    compileErrors,
    compiledFileCount: codeFiles.length,
    externalPackages: Array.from(externalSpecifiers),
  };
}
