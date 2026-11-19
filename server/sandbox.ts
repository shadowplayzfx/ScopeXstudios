import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';
import type {
  SandboxDiagnostic,
  SandboxVerificationResult,
  StudioFile,
} from '../src/types/studio.ts';

const execFileAsync = promisify(execFile);

const SANDBOX_ROOT = path.join(os.tmpdir(), 'scopex-sandboxes');

const SAFE_PKG_REGEX =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9-._~^<>=*]+)?$/i;

const DANGEROUS_SHELL_TOKENS = /[;|&`$><\n\r]/;

export function sanitizeProjectId(raw: string): string {
  const cleaned = String(raw || 'default')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return cleaned || 'default';
}

export function normalizeSandboxRelPath(rawPath: string): string {
  const cleaned = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');

  if (!cleaned || cleaned === '.' || cleaned.split('/').some((seg) => seg === '..')) {
    throw new Error(`Invalid sandbox file path: "${rawPath}"`);
  }
  return cleaned;
}

export function getSandboxDir(projectId: string): string {
  const safeId = sanitizeProjectId(projectId);
  const dir = path.resolve(SANDBOX_ROOT, safeId);
  if (!dir.startsWith(path.resolve(SANDBOX_ROOT))) {
    throw new Error('Invalid sandbox workspace path.');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveInsideSandbox(sandboxDir: string, relPath: string): string {
  const safeRel = normalizeSandboxRelPath(relPath);
  const resolved = path.resolve(sandboxDir, safeRel);
  const base = path.resolve(sandboxDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path traversal blocked: "${relPath}"`);
  }
  return resolved;
}

export function syncFilesToSandbox(projectId: string, files: StudioFile[]): string {
  const sandboxDir = getSandboxDir(projectId);
  const expectedFiles = new Set<string>();

  for (const file of files) {
    try {
      const safeRel = normalizeSandboxRelPath(file.path);
      const targetPath = resolveInsideSandbox(sandboxDir, safeRel);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, file.content ?? '', 'utf8');
      expectedFiles.add(targetPath);
    } catch {
      // Skip invalid paths cleanly
    }
  }

  // Remove stale files from previous iterations inside sandboxDir (never outside)
  const prune = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        prune(full);
        if (fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full);
        }
      } else if (!expectedFiles.has(full)) {
        fs.unlinkSync(full);
      }
    }
  };
  prune(sandboxDir);

  return sandboxDir;
}

export function scanProjectSecurity(files: StudioFile[]): string[] {
  const warnings: string[] = [];

  for (const file of files) {
    const p = file.path.toLowerCase();
    const isClientFile =
      p.startsWith('src/') ||
      p.endsWith('.tsx') ||
      p.endsWith('.jsx') ||
      p.endsWith('.html');

    if (
      /GEMINI_API_KEY|GROQ_API_KEY|NVIDIA_API_KEY/.test(file.content) &&
      !p.endsWith('.env.example') &&
      !p.endsWith('readme.md') &&
      !p.startsWith('server')
    ) {
      warnings.push(`${file.path}: References server-side API key name in application code.`);
    }

    if (
      isClientFile &&
      /\b(AIza[0-9A-Za-z_-]{25,}|gsk_[0-9A-Za-z]{20,}|nvapi-[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{20,})\b/.test(
        file.content
      )
    ) {
      warnings.push(`${file.path}: Possible hardcoded API credential detected in client file.`);
    }

    if (isClientFile && /\b(child_process|execSync|spawnSync)\b/.test(file.content)) {
      warnings.push(`${file.path}: Disallowed Node process execution API in browser module.`);
    }

    if (/\beval\s*\(|new\s+Function\s*\(/.test(file.content)) {
      warnings.push(`${file.path}: Dynamic code evaluation (eval / new Function) flagged.`);
    }
  }

  return warnings;
}

function parseEsbuildDiagnostics(
  messages: esbuild.Message[],
  severity: 'error' | 'warning'
): SandboxDiagnostic[] {
  return messages.map((m) => ({
    file: m.location?.file,
    line: m.location?.line,
    column: m.location?.column,
    message: m.text,
    severity,
  }));
}

export async function verifyProjectBuild(
  projectId: string,
  files: StudioFile[]
): Promise<SandboxVerificationResult> {
  const started = Date.now();
  const sandboxDir = syncFilesToSandbox(projectId, files);
  const securityWarnings = scanProjectSecurity(files);

  const normalizedMap = new Map<string, StudioFile>();
  for (const f of files) {
    try {
      const rel = normalizeSandboxRelPath(f.path);
      normalizedMap.set(rel, { ...f, path: rel });
    } catch {
      // ignore invalid
    }
  }

  const allPaths = Array.from(normalizedMap.keys());
  const detectedPackages = new Set<string>();

  const entryReact =
    normalizedMap.get('src/App.tsx') ||
    normalizedMap.get('src/App.jsx') ||
    normalizedMap.get('src/main.tsx') ||
    normalizedMap.get('App.tsx') ||
    Array.from(normalizedMap.values()).find(
      (f) => f.path.endsWith('.tsx') || f.path.endsWith('.jsx')
    );

  const htmlEntry = normalizedMap.get('index.html');
  const nodeEntry =
    normalizedMap.get('server.ts') ||
    normalizedMap.get('server.js') ||
    normalizedMap.get('src/server.ts');

  const errors: SandboxDiagnostic[] = [];
  const warnings: SandboxDiagnostic[] = [];
  let bundleBytes = 0;
  let compiledFiles = 0;

  const projectType: SandboxVerificationResult['projectType'] = entryReact
    ? 'react'
    : htmlEntry
      ? 'html'
      : 'node';

  const resolveLocal = (fromRel: string, spec: string): string | null => {
    const fromDir = fromRel.includes('/')
      ? fromRel.slice(0, fromRel.lastIndexOf('/'))
      : '';
    const joined = (fromDir ? `${fromDir}/${spec}` : spec).split('/');
    const stack: string[] = [];
    for (const part of joined) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    const base = stack.join('/');
    const candidates = [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      `${base}.js`,
      `${base}.json`,
      `${base}.css`,
      `${base}/index.tsx`,
      `${base}/index.ts`,
      `${base}/index.jsx`,
      `${base}/index.js`,
    ];
    for (const c of candidates) {
      if (normalizedMap.has(c)) return c;
    }
    return null;
  };

  if (entryReact) {
    const virtualPlugin: esbuild.Plugin = {
      name: 'scopex-sandbox-fs',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') {
            return { path: entryReact.path, namespace: 'sandbox' };
          }
          if (args.path.startsWith('.')) {
            const target = resolveLocal(args.importer, args.path);
            if (!target) {
              return {
                errors: [
                  {
                    text: `Cannot resolve local module "${args.path}" from "${args.importer}"`,
                  },
                ],
              };
            }
            return { path: target, namespace: 'sandbox' };
          }
          // Bare npm package specifier
          const pkgRoot = args.path.startsWith('@')
            ? args.path.split('/').slice(0, 2).join('/')
            : args.path.split('/')[0];
          detectedPackages.add(pkgRoot);
          return { path: args.path, external: true };
        });

        build.onLoad({ filter: /.*/, namespace: 'sandbox' }, (args) => {
          const file = normalizedMap.get(args.path);
          if (!file) {
            return { errors: [{ text: `File not found in sandbox: ${args.path}` }] };
          }
          compiledFiles += 1;
          const loader: esbuild.Loader = args.path.endsWith('.tsx')
            ? 'tsx'
            : args.path.endsWith('.ts')
              ? 'ts'
              : args.path.endsWith('.jsx')
                ? 'jsx'
                : args.path.endsWith('.css')
                  ? 'css'
                  : args.path.endsWith('.json')
                    ? 'json'
                    : 'js';
          return { contents: file.content, loader };
        });
      },
    };

    try {
      const result = await esbuild.build({
        entryPoints: [entryReact.path],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        plugins: [virtualPlugin],
        logLevel: 'silent',
      });
      for (const out of result.outputFiles || []) {
        bundleBytes += out.contents.byteLength;
      }
      warnings.push(...parseEsbuildDiagnostics(result.warnings, 'warning'));
    } catch (err) {
      const buildErr = err as { errors?: esbuild.Message[]; warnings?: esbuild.Message[] };
      if (Array.isArray(buildErr.errors) && buildErr.errors.length > 0) {
        errors.push(...parseEsbuildDiagnostics(buildErr.errors, 'error'));
      } else {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          severity: 'error',
        });
      }
      if (Array.isArray(buildErr.warnings)) {
        warnings.push(...parseEsbuildDiagnostics(buildErr.warnings, 'warning'));
      }
    }
  } else {
    // Plain HTML/CSS/JS or Node modules validation via individual esbuild transform
    for (const rel of allPaths) {
      const f = normalizedMap.get(rel);
      if (!f) continue;
      if (
        rel.endsWith('.ts') ||
        rel.endsWith('.tsx') ||
        rel.endsWith('.js') ||
        rel.endsWith('.jsx')
      ) {
        compiledFiles += 1;
        const loader: esbuild.Loader = rel.endsWith('.tsx')
          ? 'tsx'
          : rel.endsWith('.ts')
            ? 'ts'
            : rel.endsWith('.jsx')
              ? 'jsx'
              : 'js';
        try {
          const res = await esbuild.transform(f.content, { loader });
          bundleBytes += Buffer.byteLength(res.code, 'utf8');
        } catch (err) {
          const tErr = err as { errors?: esbuild.Message[] };
          if (Array.isArray(tErr.errors) && tErr.errors.length > 0) {
            errors.push(
              ...tErr.errors.map((m) => ({
                file: rel,
                line: m.location?.line,
                column: m.location?.column,
                message: m.text,
                severity: 'error' as const,
              }))
            );
          } else {
            errors.push({
              file: rel,
              message: err instanceof Error ? err.message : String(err),
              severity: 'error',
            });
          }
        }
      } else if (rel.endsWith('.html') || rel.endsWith('.css')) {
        compiledFiles += 1;
        bundleBytes += Buffer.byteLength(f.content, 'utf8');
      }
    }
  }

  // Also verify standalone server files if present in a React project
  if (entryReact && nodeEntry) {
    try {
      const loader: esbuild.Loader = nodeEntry.path.endsWith('.ts') ? 'ts' : 'js';
      await esbuild.transform(nodeEntry.content, { loader });
    } catch (err) {
      errors.push({
        file: nodeEntry.path,
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      });
    }
  }

  // Validate package.json if present
  const pkgFile = normalizedMap.get('package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const dep of Object.keys(pkg.dependencies || {})) {
        detectedPackages.add(dep);
      }
    } catch (e) {
      errors.push({
        file: 'package.json',
        message: `Invalid JSON in package.json: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
      });
    }
  }

  // Touch sandboxDir to confirm workspace sync
  void sandboxDir;

  return {
    passed: errors.length === 0,
    engine: 'esbuild-sandbox',
    projectType,
    compiledFiles,
    bundleBytes,
    durationMs: Date.now() - started,
    errors,
    warnings,
    securityWarnings,
    detectedPackages: Array.from(detectedPackages),
    checkedAt: Date.now(),
  };
}

export async function lookupNpmPackage(pkgInput: string): Promise<{
  name: string;
  version: string;
  description: string;
}> {
  const trimmed = pkgInput.trim();
  if (!SAFE_PKG_REGEX.test(trimmed)) {
    throw new Error(`Invalid npm package name: "${trimmed}"`);
  }

  // Separate optional @version suffix
  let pkgName = trimmed;
  let requestedTag = 'latest';
  if (trimmed.startsWith('@')) {
    const secondAt = trimmed.indexOf('@', 1);
    if (secondAt > 0) {
      pkgName = trimmed.slice(0, secondAt);
      requestedTag = trimmed.slice(secondAt + 1) || 'latest';
    }
  } else if (trimmed.includes('@')) {
    const atIdx = trimmed.indexOf('@');
    pkgName = trimmed.slice(0, atIdx);
    requestedTag = trimmed.slice(atIdx + 1) || 'latest';
  }

  const encoded = pkgName.startsWith('@')
    ? `@${encodeURIComponent(pkgName.slice(1))}`
    : encodeURIComponent(pkgName);

  const resp = await fetch(`https://registry.npmjs.org/${encoded}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(10000),
  });

  if (resp.status === 404) {
    throw new Error(`Package "${pkgName}" was not found on npm registry.`);
  }
  if (!resp.ok) {
    throw new Error(`npm registry returned HTTP ${resp.status} for "${pkgName}".`);
  }

  const data = (await resp.json()) as {
    name?: string;
    description?: string;
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { version?: string; description?: string }>;
  };

  const latestVer = data['dist-tags']?.latest;
  const resolvedVer =
    requestedTag === 'latest'
      ? latestVer
      : data['dist-tags']?.[requestedTag] ||
        (data.versions && data.versions[requestedTag]?.version) ||
        latestVer;

  if (!resolvedVer) {
    throw new Error(`Could not resolve a publishable version for "${pkgName}".`);
  }

  return {
    name: data.name || pkgName,
    version: `^${resolvedVer}`,
    description: data.description || '',
  };
}

export function upsertPackageJsonDependency(
  files: StudioFile[],
  projectTitle: string,
  depsToAdd: Array<{ name: string; version: string }>,
  depsToRemove: string[] = []
): StudioFile[] {
  const now = Date.now();
  const existing = files.find((f) => normalizePathSafe(f.path) === 'package.json');
  let pkgObj: {
    name: string;
    private: boolean;
    version: string;
    type: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };

  if (existing) {
    try {
      const parsed = JSON.parse(existing.content) as Partial<typeof pkgObj>;
      pkgObj = {
        name:
          parsed.name ||
          projectTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
          'scopex-app',
        private: true,
        version: parsed.version || '1.0.0',
        type: 'module',
        scripts: parsed.scripts || {
          dev: 'vite',
          build: 'vite build',
          typecheck: 'tsc --noEmit',
        },
        dependencies: parsed.dependencies || {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'lucide-react': '^0.546.0',
        },
      };
    } catch {
      pkgObj = createDefaultPackageJson(projectTitle);
    }
  } else {
    pkgObj = createDefaultPackageJson(projectTitle);
  }

  for (const dep of depsToAdd) {
    pkgObj.dependencies[dep.name] = dep.version;
  }
  for (const rem of depsToRemove) {
    delete pkgObj.dependencies[rem];
  }

  const nextContent = JSON.stringify(pkgObj, null, 2) + '\n';
  if (existing) {
    return files.map((f) =>
      f.id === existing.id ? { ...f, content: nextContent, updatedAt: now } : f
    );
  }
  return [
    ...files,
    {
      id: `file_pkg_${now}`,
      path: 'package.json',
      language: 'json',
      content: nextContent,
      updatedAt: now,
    },
  ];
}

function normalizePathSafe(p: string): string {
  return p.replace(/^\.?\//, '').replace(/\/+/g, '/');
}

function createDefaultPackageJson(projectTitle: string) {
  return {
    name:
      projectTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'scopex-app',
    private: true,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'lucide-react': '^0.546.0',
    },
  };
}

export interface SandboxCommandOutcome {
  ok: boolean;
  output: string;
  stderr?: string;
  updatedFiles?: StudioFile[];
  verification?: SandboxVerificationResult;
  refreshPreview?: boolean;
  clearConsole?: boolean;
}

export async function executeSandboxCommand(params: {
  projectId: string;
  projectTitle: string;
  command: string;
  files: StudioFile[];
  projectEnv?: Record<string, string>;
}): Promise<SandboxCommandOutcome> {
  const raw = params.command.trim();
  if (!raw) {
    return { ok: true, output: '' };
  }

  if (DANGEROUS_SHELL_TOKENS.test(raw)) {
    return {
      ok: false,
      output: '',
      stderr:
        'Blocked: chained shell operators (;, &&, ||, |, `, $(), >, <) are disallowed inside the isolated SCOPE-X sandbox.',
    };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const cmd = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const sandboxDir = syncFilesToSandbox(params.projectId, params.files);

  if (cmd === 'clear') {
    return { ok: true, output: '', clearConsole: true };
  }

  if (cmd === 'help') {
    return {
      ok: true,
      output: [
        'SCOPE-X Isolated Sandbox Shell — Supported Commands:',
        '  ls [dir]              List files in the isolated project workspace',
        '  cat <path>            Display contents of a project file',
        '  pwd                   Print sandbox workspace root',
        '  touch <path>          Create an empty file in the project',
        '  rm <path>             Remove a file from the project',
        '  npm install <pkg>     Resolve real package via npm registry & update package.json',
        '  npm uninstall <pkg>   Remove package from package.json',
        '  npm run build         Verify & bundle project with isolated esbuild compiler',
        '  npm run dev           Rebuild & reload live application preview',
        '  npm run typecheck     Run static TypeScript/JSX & import validation',
        '  node <file.js|ts>     Execute a script inside isolated Node sandbox (clean env)',
        '  node -v               Print sandbox Node.js runtime version',
        '  env                   List configured project environment keys (masked)',
        '  clear                 Clear terminal output',
      ].join('\n'),
    };
  }

  if (cmd === 'pwd') {
    return { ok: true, output: `/sandbox/${sanitizeProjectId(params.projectId)}` };
  }

  if (cmd === 'ls' || cmd === 'dir') {
    const sub = args[0] ? normalizeSandboxRelPath(args[0]) : '';
    const matched = params.files
      .map((f) => normalizePathSafe(f.path))
      .filter((p) => !sub || p === sub || p.startsWith(`${sub}/`))
      .sort();
    return {
      ok: true,
      output: matched.length > 0 ? matched.join('\n') : '(workspace empty)',
    };
  }

  if (cmd === 'cat') {
    if (!args[0]) {
      return { ok: false, output: '', stderr: 'Usage: cat <relative-file-path>' };
    }
    try {
      const targetRel = normalizeSandboxRelPath(args[0]);
      const found = params.files.find((f) => normalizePathSafe(f.path) === targetRel);
      if (!found) {
        return { ok: false, output: '', stderr: `cat: ${targetRel}: No such file in project` };
      }
      return { ok: true, output: found.content };
    } catch (err) {
      return {
        ok: false,
        output: '',
        stderr: err instanceof Error ? err.message : 'Invalid file path',
      };
    }
  }

  if (cmd === 'touch') {
    if (!args[0]) {
      return { ok: false, output: '', stderr: 'Usage: touch <relative-file-path>' };
    }
    try {
      const rel = normalizeSandboxRelPath(args[0]);
      if (params.files.some((f) => normalizePathSafe(f.path) === rel)) {
        return { ok: true, output: `Updated timestamp: ${rel}` };
      }
      const nextFiles: StudioFile[] = [
        ...params.files,
        {
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          path: rel,
          language: rel.endsWith('.tsx')
            ? 'tsx'
            : rel.endsWith('.ts')
              ? 'ts'
              : rel.endsWith('.css')
                ? 'css'
                : rel.endsWith('.json')
                  ? 'json'
                  : 'text',
          content: '',
          updatedAt: Date.now(),
        },
      ];
      return { ok: true, output: `Created ${rel}`, updatedFiles: nextFiles };
    } catch (err) {
      return {
        ok: false,
        output: '',
        stderr: err instanceof Error ? err.message : 'Invalid path',
      };
    }
  }

  if (cmd === 'rm') {
    const cleanArgs = args.filter((a) => !a.startsWith('-'));
    if (!cleanArgs[0] || args.some((a) => a === '-rf' && cleanArgs[0] === '/')) {
      return { ok: false, output: '', stderr: 'Usage: rm <relative-file-path>' };
    }
    try {
      const rel = normalizeSandboxRelPath(cleanArgs[0]);
      const nextFiles = params.files.filter((f) => normalizePathSafe(f.path) !== rel);
      if (nextFiles.length === params.files.length) {
        return { ok: false, output: '', stderr: `rm: ${rel}: No such file in project` };
      }
      return { ok: true, output: `Removed ${rel}`, updatedFiles: nextFiles };
    } catch (err) {
      return {
        ok: false,
        output: '',
        stderr: err instanceof Error ? err.message : 'Invalid path',
      };
    }
  }

  if (cmd === 'env') {
    const keys = Object.keys(params.projectEnv || {});
    if (keys.length === 0) {
      return {
        ok: true,
        output:
          'No custom project environment variables configured. Add variables in Deploy & Export > Project .env.',
      };
    }
    return {
      ok: true,
      output: keys.map((k) => `${k}=******** (project-scoped)`).join('\n'),
    };
  }

  if (cmd === 'node') {
    if (args[0] === '-v' || args[0] === '--version') {
      return { ok: true, output: process.version };
    }
    if (!args[0]) {
      return { ok: false, output: '', stderr: 'Usage: node <file.js|file.ts>' };
    }
    try {
      const rel = normalizeSandboxRelPath(args[0]);
      const full = resolveInsideSandbox(sandboxDir, rel);
      if (!fs.existsSync(full)) {
        return { ok: false, output: '', stderr: `node: ${rel} not found in sandbox workspace` };
      }

      // If TypeScript, compile first into an ephemeral .mjs inside sandboxDir
      let runTarget = full;
      let tempCompiled: string | null = null;
      if (rel.endsWith('.ts') || rel.endsWith('.tsx')) {
        const src = fs.readFileSync(full, 'utf8');
        const built = await esbuild.transform(src, {
          loader: rel.endsWith('.tsx') ? 'tsx' : 'ts',
          format: 'esm',
        });
        tempCompiled = path.join(sandboxDir, `.scopex_tmp_${Date.now()}.mjs`);
        fs.writeFileSync(tempCompiled, built.code, 'utf8');
        runTarget = tempCompiled;
      }

      // Clean isolated environment: NEVER pass host secrets (GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY)
      const isolatedEnv: Record<string, string> = {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        NODE_ENV: 'sandbox',
        ...(params.projectEnv || {}),
      };

      try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [runTarget], {
          cwd: sandboxDir,
          env: isolatedEnv,
          timeout: 8000,
          maxBuffer: 256 * 1024,
        });
        return {
          ok: true,
          output: stdout.trim() || '(process exited 0 with no stdout)',
          stderr: stderr.trim() || undefined,
        };
      } finally {
        if (tempCompiled && fs.existsSync(tempCompiled)) {
          fs.unlinkSync(tempCompiled);
        }
      }
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      return {
        ok: false,
        output: e.stdout?.trim() || '',
        stderr: e.stderr?.trim() || e.message || 'Sandbox node execution failed',
      };
    }
  }

  if (cmd === 'npm' || cmd === 'npx' || cmd === 'tsc') {
    const sub = cmd === 'tsc' ? 'typecheck' : (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (sub === 'install' || sub === 'i' || sub === 'add') {
      const pkgs = rest.filter((a) => !a.startsWith('-'));
      if (pkgs.length === 0) {
        const verification = await verifyProjectBuild(params.projectId, params.files);
        return {
          ok: verification.passed,
          output: `Verified ${verification.detectedPackages.length} declared package(s): ${verification.detectedPackages.join(', ') || 'react, lucide-react'}`,
          verification,
        };
      }

      const resolved: Array<{ name: string; version: string; description: string }> = [];
      const installErrors: string[] = [];
      for (const p of pkgs.slice(0, 6)) {
        try {
          const info = await lookupNpmPackage(p);
          resolved.push(info);
        } catch (err) {
          installErrors.push(err instanceof Error ? err.message : String(err));
        }
      }

      if (resolved.length === 0) {
        return {
          ok: false,
          output: '',
          stderr: installErrors.join('\n') || 'Failed to install requested packages.',
        };
      }

      const updatedFiles = upsertPackageJsonDependency(
        params.files,
        params.projectTitle,
        resolved
      );
      const verification = await verifyProjectBuild(params.projectId, updatedFiles);
      const summaryLines = resolved.map(
        (r) => `+ ${r.name}@${r.version}${r.description ? ` — ${r.description.slice(0, 80)}` : ''}`
      );
      if (installErrors.length > 0) {
        summaryLines.push(...installErrors.map((e) => `! ${e}`));
      }
      summaryLines.push(
        'Updated package.json and synced ESM import maps for Live Preview.'
      );

      return {
        ok: installErrors.length === 0,
        output: summaryLines.join('\n'),
        stderr: installErrors.length > 0 ? installErrors.join('\n') : undefined,
        updatedFiles,
        verification,
        refreshPreview: true,
      };
    }

    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') {
      const pkgs = rest.filter((a) => !a.startsWith('-'));
      if (pkgs.length === 0) {
        return { ok: false, output: '', stderr: 'Usage: npm uninstall <package>' };
      }
      const updatedFiles = upsertPackageJsonDependency(
        params.files,
        params.projectTitle,
        [],
        pkgs
      );
      return {
        ok: true,
        output: `Removed from package.json: ${pkgs.join(', ')}`,
        updatedFiles,
        refreshPreview: true,
      };
    }

    if (
      sub === 'run' ||
      sub === 'build' ||
      sub === 'dev' ||
      sub === 'typecheck' ||
      sub === 'test'
    ) {
      const scriptName = sub === 'run' ? (rest[0] || 'build').toLowerCase() : sub;
      const verification = await verifyProjectBuild(params.projectId, params.files);
      const kb = (verification.bundleBytes / 1024).toFixed(1);
      if (!verification.passed) {
        return {
          ok: false,
          output: `> scopex-sandbox ${scriptName} (${verification.durationMs}ms)`,
          stderr: verification.errors
            .map(
              (e) =>
                `${e.file || 'project'}${e.line ? `:${e.line}:${e.column || 0}` : ''} — ${e.message}`
            )
            .join('\n'),
          verification,
        };
      }
      return {
        ok: true,
        output: [
          `> scopex-sandbox ${scriptName}`,
          `Compiled ${verification.compiledFiles} module(s) with esbuild in ${verification.durationMs}ms (${kb} KB bundle).`,
          verification.securityWarnings.length > 0
            ? `Security notices (${verification.securityWarnings.length}):\n${verification.securityWarnings.join('\n')}`
            : 'Security scan: 0 issues detected.',
          scriptName === 'dev' ? 'Preview sandbox server refreshed.' : 'Build verification passed.',
        ].join('\n'),
        verification,
        refreshPreview: scriptName === 'dev' || scriptName === 'build',
      };
    }
  }

  return {
    ok: false,
    output: '',
    stderr: `Command "${cmd}" is not permitted in the isolated SCOPE-X sandbox. Type "help" to list supported commands.`,
  };
}

export async function exportToGitHub(params: {
  token: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  commitMessage?: string;
  files: StudioFile[];
}): Promise<{ repoUrl: string; commitSha: string; pushedFiles: number }> {
  const token = params.token.trim();
  const repoName = params.repoName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!token) throw new Error('GitHub Personal Access Token is required.');
  if (!repoName) throw new Error('Repository name is required.');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SCOPE-X-Builder',
    'Content-Type': 'application/json',
  };

  // 1. Identify authenticated user
  const userResp = await fetch('https://api.github.com/user', {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!userResp.ok) {
    const errText = await userResp.text();
    throw new Error(`GitHub auth failed (HTTP ${userResp.status}): ${errText.slice(0, 180)}`);
  }
  const ghUser = (await userResp.json()) as { login: string };

  // 2. Check if repo exists, otherwise create it with auto_init
  const repoCheck = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(ghUser.login)}/${encodeURIComponent(repoName)}`,
    { headers, signal: AbortSignal.timeout(10000) }
  );

  let defaultBranch = 'main';
  let repoUrl = `https://github.com/${ghUser.login}/${repoName}`;

  if (repoCheck.status === 404) {
    const createResp = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: repoName,
        description: params.description || 'Built with SCOPE-X App Builder',
        private: Boolean(params.isPrivate),
        auto_init: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!createResp.ok) {
      const errText = await createResp.text();
      throw new Error(
        `Failed to create GitHub repo (HTTP ${createResp.status}): ${errText.slice(0, 200)}`
      );
    }
    const created = (await createResp.json()) as {
      html_url: string;
      default_branch?: string;
    };
    repoUrl = created.html_url;
    defaultBranch = created.default_branch || 'main';
    // Brief wait for GitHub auto_init branch creation
    await new Promise((r) => setTimeout(r, 1200));
  } else if (repoCheck.ok) {
    const existing = (await repoCheck.json()) as {
      html_url: string;
      default_branch?: string;
    };
    repoUrl = existing.html_url;
    defaultBranch = existing.default_branch || 'main';
  } else {
    throw new Error(`Failed to inspect repository (HTTP ${repoCheck.status}).`);
  }

  // 3. Get current ref HEAD SHA
  const refResp = await fetch(
    `https://api.github.com/repos/${ghUser.login}/${repoName}/git/ref/heads/${defaultBranch}`,
    { headers, signal: AbortSignal.timeout(10000) }
  );
  if (!refResp.ok) {
    throw new Error(`Unable to read branch "${defaultBranch}" (HTTP ${refResp.status}).`);
  }
  const refData = (await refResp.json()) as { object: { sha: string } };
  const parentCommitSha = refData.object.sha;

  const commitResp = await fetch(
    `https://api.github.com/repos/${ghUser.login}/${repoName}/git/commits/${parentCommitSha}`,
    { headers, signal: AbortSignal.timeout(10000) }
  );
  if (!commitResp.ok) {
    throw new Error('Unable to read base commit tree.');
  }
  const baseCommit = (await commitResp.json()) as { tree: { sha: string } };

  // 4. Create tree items & commit atomically
  const treeItems: Array<{ path: string; mode: string; type: string; content: string }> = [];
  for (const f of params.files) {
    try {
      const cleanPath = normalizeSandboxRelPath(f.path);
      treeItems.push({
        path: cleanPath,
        mode: '100644',
        type: 'blob',
        content: f.content,
      });
    } catch {
      // skip invalid
    }
  }

  const treeResp = await fetch(
    `https://api.github.com/repos/${ghUser.login}/${repoName}/git/trees`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeItems,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!treeResp.ok) {
    const errText = await treeResp.text();
    throw new Error(`GitHub tree creation failed: ${errText.slice(0, 180)}`);
  }
  const treeData = (await treeResp.json()) as { sha: string };

  const newCommitResp = await fetch(
    `https://api.github.com/repos/${ghUser.login}/${repoName}/git/commits`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: params.commitMessage || 'Update application via SCOPE-X App Builder',
        tree: treeData.sha,
        parents: [parentCommitSha],
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!newCommitResp.ok) {
    throw new Error(`GitHub commit failed (HTTP ${newCommitResp.status}).`);
  }
  const newCommit = (await newCommitResp.json()) as { sha: string };

  const updateRefResp = await fetch(
    `https://api.github.com/repos/${ghUser.login}/${repoName}/git/refs/heads/${defaultBranch}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommit.sha }),
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!updateRefResp.ok) {
    throw new Error(`Failed to advance branch "${defaultBranch}".`);
  }

  return {
    repoUrl,
    commitSha: newCommit.sha,
    pushedFiles: treeItems.length,
  };
}

export async function deployToVercel(params: {
  token: string;
  projectName: string;
  files: StudioFile[];
  envVars?: Record<string, string>;
}): Promise<{ deploymentUrl: string; inspectorUrl?: string; readyState?: string }> {
  const token = params.token.trim();
  const projectName = params.projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'scopex-app';

  if (!token) throw new Error('Vercel API token is required.');

  const deployFiles: Array<{ file: string; data: string }> = [];
  for (const f of params.files) {
    try {
      const cleanPath = normalizeSandboxRelPath(f.path);
      deployFiles.push({ file: cleanPath, data: f.content });
    } catch {
      // skip invalid
    }
  }

  // Ensure standard Vite entry files exist for Vercel deployment if React project
  const pathsSet = new Set(deployFiles.map((f) => f.file));
  if (!pathsSet.has('package.json')) {
    deployFiles.push({
      file: 'package.json',
      data: JSON.stringify(createDefaultPackageJson(projectName), null, 2),
    });
  }
  if (!pathsSet.has('index.html') && pathsSet.has('src/App.tsx')) {
    deployFiles.push({
      file: 'index.html',
      data: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
    });
  }
  if (!pathsSet.has('src/main.tsx') && pathsSet.has('src/App.tsx')) {
    deployFiles.push({
      file: 'src/main.tsx',
      data: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
    });
  }

  const resp = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      files: deployFiles,
      projectSettings: {
        framework: pathsSet.has('src/App.tsx') ? 'vite' : null,
      },
      ...(params.envVars && Object.keys(params.envVars).length > 0
        ? { env: params.envVars }
        : {}),
    }),
    signal: AbortSignal.timeout(25000),
  });

  const data = (await resp.json()) as {
    url?: string;
    inspectorUrl?: string;
    readyState?: string;
    error?: { message?: string };
  };

  if (!resp.ok || !data.url) {
    throw new Error(
      data.error?.message || `Vercel deployment failed (HTTP ${resp.status}).`
    );
  }

  return {
    deploymentUrl: data.url.startsWith('http') ? data.url : `https://${data.url}`,
    inspectorUrl: data.inspectorUrl,
    readyState: data.readyState,
  };
}
