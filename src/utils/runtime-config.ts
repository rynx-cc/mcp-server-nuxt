/**
 * Static runtimeConfig analysis. Parses `runtimeConfig` from nuxt.config the
 * same way the route-rules tool does, then scans `useRuntimeConfig()` accesses.
 * Never prints secret values.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractConfigBody, findConfigFile } from './config-reader.js';
import { findTopLevelValue, isPlainObject, isRawExpression, parseJsLiteral } from './render-mode.js';
import { exists, findFiles, relativePath } from './nuxt-parser.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';

export interface RuntimeConfigKey {
  key: string;
  public: boolean;
  type: string;
  envVar: string;
}

export interface RuntimeConfigAccess {
  file: string;
  line: number;
  key: string;
  public: boolean;
}

export interface RuntimeConfigResult {
  configFile: string | null;
  keys: RuntimeConfigKey[];
  usedKeys: string[];
  usedButUndefined: string[];
  definedButUnused: string[];
  privateReadInClient: Array<{ file: string; line: number; key: string }>;
  env: Array<{ envVar: string; inEnv: boolean; inEnvExample: boolean }>;
  summary: string;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Config parsing                                                      */
/* ------------------------------------------------------------------ */

/** `apiBase` -> `API_BASE`, `db.host` -> `DB_HOST`, `dbURL` -> `DB_URL`. */
export function camelToUpperSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[.-]/g, '_')
    .toUpperCase();
}

function typeOf(value: unknown): string {
  if (isRawExpression(value)) return 'unknown';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function envVarFor(key: string, isPublic: boolean): string {
  if (isPublic) {
    const withoutNamespace = key.replace(/^public\./, '');
    return `NUXT_PUBLIC_${camelToUpperSnake(withoutNamespace)}`;
  }
  return `NUXT_${camelToUpperSnake(key)}`;
}

/**
 * Flatten `runtimeConfig` into leaf keys. Nested plain objects become dotted
 * keys (`db.host`) because that is how Nuxt maps env vars
 * (`NUXT_DB_HOST`); arrays and non-literals stay single leaves. The built-in
 * `app` namespace is skipped.
 */
export function flattenRuntimeConfig(config: unknown): RuntimeConfigKey[] {
  if (!isPlainObject(config)) return [];
  const keys: RuntimeConfigKey[] = [];

  const walk = (value: unknown, key: string, isPublic: boolean): void => {
    if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, key ? `${key}.${childKey}` : childKey, isPublic);
      }
      return;
    }
    if (!key) return;
    keys.push({ key, public: isPublic, type: typeOf(value), envVar: envVarFor(key, isPublic) });
  };

  for (const [key, value] of Object.entries(config)) {
    if (key === 'app') continue;
    if (key === 'public') {
      if (!isPlainObject(value)) continue;
      for (const [pubKey, pubValue] of Object.entries(value)) {
        walk(pubValue, `public.${pubKey}`, true);
      }
      continue;
    }
    walk(value, key, false);
  }

  return keys.sort((a, b) => a.key.localeCompare(b.key));
}

async function readRuntimeConfig(root: string): Promise<{
  configFile: string | null;
  keys: RuntimeConfigKey[];
  notes: string[];
}> {
  const configPath = findConfigFile(root);
  if (!configPath) {
    return { configFile: null, keys: [], notes: ['No nuxt.config file found.'] };
  }
  const source = await fs.readFile(configPath, 'utf8');
  const body = extractConfigBody(source);
  if (!body) {
    return { configFile: configPath, keys: [], notes: ['Could not locate defineNuxtConfig({...}).'] };
  }
  const raw = findTopLevelValue(body, 'runtimeConfig');
  if (raw === undefined) {
    return { configFile: configPath, keys: [], notes: ['No runtimeConfig in nuxt.config.'] };
  }
  const parsed = parseJsLiteral(raw);
  const keys = flattenRuntimeConfig(parsed.value);
  const notes = parsed.unresolved.map((expr) => `Unresolved runtimeConfig expression: ${expr}`);
  if (keys.some((key) => key.type === 'unknown')) {
    notes.push('Keys with type "unknown" could not be evaluated statically; env vars are still reported.');
  }
  return { configFile: configPath, keys, notes };
}

/* ------------------------------------------------------------------ */
/* useRuntimeConfig() access scanning                                  */
/* ------------------------------------------------------------------ */

type ChainResult = { key: string; public: boolean } | null;

function skipWs(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  return i;
}

/** Parse `.a` / `.public['b']` / `?.['a']` chains immediately after `from`. */
function parseChain(src: string, from: number): string[] {
  const names: string[] = [];
  let i = from;
  for (;;) {
    i = skipWs(src, i);
    if (src[i] === '?' && src[i + 1] === '.') i++;
    if (src[i] === '.') {
      i = skipWs(src, i + 1);
      const match = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (!match) break;
      names.push(match[0]);
      i += match[0].length;
      continue;
    }
    if (src[i] === '[') {
      const match = /^\[\s*(['"])([^'"]+)\1\s*\]/.exec(src.slice(i));
      if (!match) break;
      names.push(match[2]!);
      i += match[0].length;
      continue;
    }
    break;
  }
  return names;
}

function interpretChain(names: string[], kind: 'config' | 'public'): ChainResult {
  if (names.length === 0) return null;
  let parts = [...names];
  let isPublic = kind === 'public';
  if (kind === 'config') {
    const first = parts[0]!;
    if (first === 'public') {
      isPublic = true;
      parts = parts.slice(1);
    } else if (first === 'app' || first === 'nitro') {
      return null;
    }
  }
  if (parts.length === 0) return null;
  const key = parts.join('.');
  return { key: isPublic ? `public.${key}` : key, public: isPublic };
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content[i] === '\n') line++;
  return line;
}

function splitTopLevelComma(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Key name of one destructuring entry (`apiBase`, `apiBase: x`, `apiBase = ''`). */
function destructuredKeyName(part: string): string | null {
  const trimmed = part.trim();
  if (!trimmed || trimmed.startsWith('...') || trimmed.startsWith('[')) return null;
  const raw = trimmed.split(/[:=]/)[0]!.trim();
  const unquoted = raw.replace(/^['"`]|['"`]$/g, '');
  return /^[A-Za-z_$][\w$]*$/.test(unquoted) ? unquoted : null;
}

interface DestructureResult {
  accesses: Array<{ key: string; public: boolean }>;
  /** Aliases bound to the public namespace (`public: cfg`) or the public object. */
  publicAliases: string[];
}

function parseDestructurePattern(pattern: string, allPublic: boolean): DestructureResult {
  const accesses: DestructureResult['accesses'] = [];
  const publicAliases: string[] = [];
  const inner = pattern.slice(pattern.indexOf('{') + 1, pattern.lastIndexOf('}'));
  for (const rawPart of splitTopLevelComma(inner)) {
    const part = rawPart.trim();
    if (!part) continue;

    const nested = part.match(/^public\s*:\s*\{([\s\S]*)\}$/);
    if (nested) {
      for (const nestedPart of splitTopLevelComma(nested[1]!)) {
        const name = destructuredKeyName(nestedPart);
        if (name) accesses.push({ key: `public.${name}`, public: true });
      }
      continue;
    }

    // eslint-disable-next-line regexp/no-super-linear-backtracking -- adjacent \s* needed for optional `public` / `public: alias` destructure forms
    const alias = part.match(/^public\s*(?::\s*([A-Za-z_$][\w$]*))?\s*$/);
    if (alias) {
      publicAliases.push(alias[1] ?? 'public');
      continue;
    }

    const name = destructuredKeyName(part);
    if (!name) continue;
    accesses.push(allPublic ? { key: `public.${name}`, public: true } : { key: name, public: false });
  }
  return { accesses, publicAliases };
}

interface AliasBinding {
  name: string;
  kind: 'config' | 'public';
}

interface BaseScan {
  accesses: Array<{ key: string; public: boolean; index: number }>;
  aliases: AliasBinding[];
}

/**
 * Find every `const { ... } = useRuntimeConfig()`, `const cfg = useRuntimeConfig()`
 * and `const cfg = useRuntimeConfig().public` binding in the file, plus every
 * direct `useRuntimeConfig().public.x` access.
 */
function scanBaseCall(content: string): BaseScan {
  const accesses: BaseScan['accesses'] = [];
  const aliases: AliasBinding[] = [];
  const re = /\buseRuntimeConfig\s*\(\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content))) {
    const start = match.index;
    const afterCall = skipWs(content, start + match[0].length);
    const allPublic = /^\.\s*public\b/.test(content.slice(afterCall));

    // Pattern 1: destructuring directly before the call.
    let i = start - 1;
    while (i >= 0 && /\s/.test(content[i]!)) i--;
    const isAssignment =
      content[i] === '=' &&
      content[i - 1] !== '=' &&
      content[i - 1] !== '!' &&
      content[i - 1] !== '<' &&
      content[i - 1] !== '>' &&
      content[i + 1] !== '=';
    if (isAssignment) {
      let j = i - 1;
      while (j >= 0 && /\s/.test(content[j]!)) j--;
      if (content[j] === '}') {
        let depth = 0;
        let open = -1;
        for (let k = j; k >= 0; k--) {
          const ch = content[k]!;
          if (ch === '}') depth++;
          else if (ch === '{') {
            depth--;
            if (depth === 0) {
              open = k;
              break;
            }
          }
        }
        const before = open >= 0 ? content.slice(Math.max(0, open - 20), open) : '';
        if (open >= 0 && /(?:const|let|var)\s*$/.test(before)) {
          const { accesses: destructured, publicAliases } = parseDestructurePattern(
            content.slice(open, j + 1),
            allPublic,
          );
          for (const access of destructured) accesses.push({ ...access, index: start });
          for (const aliasName of publicAliases) aliases.push({ name: aliasName, kind: 'public' });
          re.lastIndex = start + match[0].length;
          continue;
        }
      }
    }

    // Pattern 2: `const cfg = useRuntimeConfig()` / `... = useRuntimeConfig().public`.
    const assignment = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(
      content.slice(Math.max(0, start - 120), start),
    );
    if (assignment) aliases.push({ name: assignment[1]!, kind: allPublic ? 'public' : 'config' });

    // Direct chain after the call, e.g. useRuntimeConfig().public.apiBase.
    const direct = interpretChain(parseChain(content, afterCall), 'config');
    if (direct) accesses.push({ ...direct, index: start });
  }

  return { accesses, aliases };
}

/** Accesses through aliases: `cfg.public.x`, `cfg.x`, `cfg['x']`. */
function scanAliases(content: string, aliases: AliasBinding[]): BaseScan['accesses'] {
  const accesses: BaseScan['accesses'] = [];
  for (const binding of aliases) {
    const re = new RegExp(`\\b${binding.name}\\b`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      // `foo.cfg` is a property, not the binding.
      if (content[match.index - 1] === '.') continue;
      const chain = parseChain(content, match.index + match[0].length);
      const interpreted = interpretChain(chain, binding.kind);
      if (interpreted) accesses.push({ ...interpreted, index: match.index });
    }
  }
  return accesses;
}

/* ------------------------------------------------------------------ */
/* File scanning                                                       */
/* ------------------------------------------------------------------ */

function isClientSideFile(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  if (/\.server\.(?:ts|js|mts|mjs|vue)$/.test(normalized)) return false;
  if (/\.client\.(?:ts|js|mts|mjs|vue)$/.test(normalized)) return true;
  return /\.vue$/.test(normalized);
}

async function collectScanFiles(root: string, dirs: SourceDirs): Promise<string[]> {
  const app = path.join(root, 'app');
  const entries: Array<{ dir: string; vue: boolean }> = [
    { dir: dirs.pagesDir, vue: true },
    { dir: dirs.componentsDir, vue: true },
    { dir: dirs.composablesDir, vue: false },
    { dir: dirs.utilsDir, vue: false },
    { dir: dirs.layoutsDir, vue: true },
    { dir: dirs.pluginsDir, vue: false },
    { dir: dirs.middlewareDir, vue: false },
    { dir: path.join(app, 'pages'), vue: true },
    { dir: path.join(app, 'components'), vue: true },
    { dir: path.join(app, 'composables'), vue: false },
    { dir: path.join(app, 'utils'), vue: false },
    { dir: path.join(app, 'layouts'), vue: true },
    { dir: path.join(app, 'plugins'), vue: false },
    { dir: path.join(app, 'middleware'), vue: false },
  ];
  const seenDirs = new Set<string>();
  const files: string[] = [];
  for (const { dir, vue } of entries) {
    const resolved = path.resolve(dir);
    if (seenDirs.has(resolved)) continue;
    seenDirs.add(resolved);
    if (!(await exists(resolved))) continue;
    const patterns = vue ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
    files.push(...(await findFiles(resolved, patterns, ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'])));
  }
  for (const base of [dirs.srcDir, root]) {
    for (const name of ['app.vue', 'error.vue']) {
      const abs = path.join(base, name);
      if (await exists(abs)) files.push(abs);
    }
  }
  return [...new Set(files)];
}

async function readEnvVarNames(root: string): Promise<{ env: Set<string>; envExample: Set<string> }> {
  const env = new Set<string>();
  const envExample = new Set<string>();
  for (const [name, set] of [
    ['.env', env],
    ['.env.example', envExample],
  ] as const) {
    const abs = path.join(root, name);
    const content = await fs.readFile(abs, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) set.add(match[1]!);
    }
  }
  return { env, envExample };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function checkRuntimeConfig(root: string): Promise<RuntimeConfigResult> {
  const { configFile, keys, notes } = await readRuntimeConfig(root);
  const defined = new Set(keys.map((k) => k.key));
  const dirs = await resolveSourceDirs(root);
  const files = await collectScanFiles(root, dirs);

  const accesses: RuntimeConfigAccess[] = [];
  const addAccess = (file: string, access: { key: string; public: boolean; index: number }, content: string): void => {
    const line = lineAt(content, access.index);
    if (accesses.some((a) => a.file === file && a.line === line && a.key === access.key && a.public === access.public)) {
      return;
    }
    accesses.push({ file, line, key: access.key, public: access.public });
  };

  for (const file of files) {
    const rel = relativePath(root, file);
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    if (!content || !content.includes('useRuntimeConfig')) continue;

    const { accesses: found, aliases } = scanBaseCall(content);
    for (const access of found) addAccess(rel, access, content);
    for (const access of scanAliases(content, aliases)) addAccess(rel, access, content);
  }

  const usedKeys = [...new Set(accesses.map((a) => a.key))].sort();
  const isDefined = (used: string): boolean =>
    defined.has(used) || [...defined].some((key) => key.startsWith(`${used}.`));
  const usedButUndefined = usedKeys.filter((key) => !isDefined(key));
  const definedButUnused = keys
    .map((k) => k.key)
    .filter((key) => !usedKeys.some((used) => used === key || key.startsWith(`${used}.`)));

  const privateReadInClient = accesses
    .filter((a) => !a.public && isClientSideFile(a.file))
    .map((a) => ({ file: a.file, line: a.line, key: a.key }));

  const { env, envExample } = await readEnvVarNames(root);
  const envOut = keys.map((k) => ({
    envVar: k.envVar,
    inEnv: env.has(k.envVar),
    inEnvExample: envExample.has(k.envVar),
  }));

  return {
    configFile: configFile ? path.basename(configFile) : null,
    keys,
    usedKeys,
    usedButUndefined,
    definedButUnused,
    privateReadInClient,
    env: envOut,
    summary: `${keys.length} runtimeConfig key(s), ${usedKeys.length} used, ${usedButUndefined.length} undefined, ${privateReadInClient.length} private read in client code.`,
    notes,
  };
}
