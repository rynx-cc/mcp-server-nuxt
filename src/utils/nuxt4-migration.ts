/**
 * Static Nuxt 4 migration checks. Every rule comes from the official upgrade
 * guide (https://nuxt.com/docs/getting-started/upgrade) — see `guideSection`
 * on each finding. No DevServer, no `nuxi prepare`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractConfigBody, findConfigFile } from './config-reader.js';
import { findTopLevelValue, isPlainObject, isRawExpression, parseJsLiteral } from './render-mode.js';
import { exists, findFiles, relativePath } from './nuxt-parser.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';
import { findMatchingParen, findOpenParen, lineOf } from './api-callers.js';

export type Nuxt4RuleId =
  | 'legacy-root-dir'
  | 'legacy-root-file'
  | 'shared-key-conflict'
  | 'getcacheddata-old-signature'
  | 'default-data-error-null'
  | 'shallow-data-mutation'
  | 'shared-prerender-data'
  | 'dedupe-boolean'
  | 'pending-idle'
  | 'route-meta-dedup'
  | 'unhead-removed-prop'
  | 'unhead-direct-import'
  | 'error-data-parsed'
  | 'window-nuxt-global'
  | 'removed-experimental-option'
  | 'removed-generate-config'
  | 'pages-extend-meta';

export interface Nuxt4MigrationFinding {
  file: string;
  line: number;
  ruleId: Nuxt4RuleId;
  severity: 'error' | 'warning';
  reason: string;
  fix: string;
  /** Heading in the official Nuxt 4 upgrade guide. */
  guideSection: string;
}

export interface Nuxt4MigrationProject {
  nuxtVersion: string | null;
  nuxtMajor: number | null;
  usesAppDir: boolean;
  compatibilityVersion: number | null;
  migrated: boolean;
  configFile: string | null;
}

export interface Nuxt4MigrationResult {
  project: Nuxt4MigrationProject;
  readiness: 'ready' | 'needs-attention' | 'blocked';
  findings: Nuxt4MigrationFinding[];
  summary: {
    total: number;
    error: number;
    warning: number;
    byRule: Record<string, number>;
  };
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Project detection                                                   */
/* ------------------------------------------------------------------ */

/** Parse a semver range from package.json: `^4.0.0` -> 4, `~3.12.1` -> 3. */
export function parseNuxtMajor(version: string | null | undefined): number | null {
  if (!version) return null;
  const match = version.match(/(\d+)(?:\.\d+)*/);
  return match ? Number(match[1]) : null;
}

async function readNuxtVersion(root: string): Promise<{ version: string | null; notes: string[] }> {
  const notes: string[] = [];
  const pkgPath = path.join(root, 'package.json');
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    for (const section of sections) {
      const deps = pkg[section];
      if (isPlainObject(deps) && typeof deps['nuxt'] === 'string') {
        return { version: deps['nuxt'], notes };
      }
    }
    notes.push('No "nuxt" dependency found in package.json.');
    return { version: null, notes };
  } catch {
    notes.push('Could not read package.json.');
    return { version: null, notes };
  }
}

/* ------------------------------------------------------------------ */
/* Data-fetching scan (useFetch / useAsyncData)                        */
/* ------------------------------------------------------------------ */

type FetchKind = 'useFetch' | 'useLazyFetch' | 'useAsyncData' | 'useLazyAsyncData';

interface FetchCall {
  kind: FetchKind;
  start: number;
  line: number;
  key?: string;
  url?: string;
  source: string;
  optionsRaw: string;
}

const FETCH_RE = /\b(useFetch|useLazyFetch|useAsyncData|useLazyAsyncData)\b/g;

function splitArgs(src: string, open: number, close: number): Array<{ raw: string; start: number }> {
  const args: Array<{ raw: string; start: number }> = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      args.push({ raw: src.slice(start, i), start });
      start = i + 1;
    }
  }
  args.push({ raw: src.slice(start, close), start });
  return args;
}

function literalValue(raw: string): { value?: string; dynamic: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { dynamic: false };
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== '`') return { value: trimmed, dynamic: true };
  if (trimmed.length < 2 || !trimmed.endsWith(quote)) return { value: trimmed, dynamic: true };
  const value = trimmed.slice(1, -1);
  return { value, dynamic: quote === '`' && value.includes('${') };
}

/** Explicit key: a plain string or template literal (reactive keys included). */
function explicitKey(raw: string): string | null {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'" && quote !== '`') || trimmed.length < 2 || !trimmed.endsWith(quote)) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function optionString(raw: string, name: string): string | undefined {
  const match = raw.match(new RegExp(`\\b${name}\\s*:\\s*(['"])([^'"]+)\\1`));
  return match?.[2];
}

/** Raw source of one option value, up to the next top-level comma. */
export function optionValueRaw(raw: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*:`).exec(raw);
  if (!match) return '';
  let i = match.index + match[0].length;
  let depth = 0;
  let quote: string | null = null;
  let out = '';
  for (; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += raw[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === ',' && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

function extractFetchCalls(content: string): FetchCall[] {
  const calls: FetchCall[] = [];
  FETCH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FETCH_RE.exec(content))) {
    const kind = match[1] as FetchKind;
    const start = match.index;
    const open = findOpenParen(content, start + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    const args = splitArgs(content, open, close);
    let key: string | undefined;
    let url: string | undefined;
    let optionsRaw = '';
    let source = '';

    if (kind === 'useFetch' || kind === 'useLazyFetch') {
      url = literalValue(args[0]?.raw ?? '').value;
      optionsRaw = args[1]?.raw ?? '';
      key = optionString(optionsRaw, 'key');
      const method = optionString(optionsRaw, 'method')?.toUpperCase() ?? 'GET';
      source = `${url ?? ''}|${method}`;
    } else {
      const first = args[0];
      const firstIsFetcher = !!first && /=>|\bfunction\b/.test(first.raw);
      let fetcher = args[1];
      if (firstIsFetcher) {
        fetcher = first;
        optionsRaw = args[1]?.raw ?? '';
      } else {
        key = first ? (explicitKey(first.raw) ?? undefined) : undefined;
        optionsRaw = args[2]?.raw ?? '';
      }
      const method = optionString(optionsRaw, 'method')?.toUpperCase() ?? 'GET';
      const fetchUrl = fetcher?.raw.match(/\$fetch\s*\(\s*(['"`])([^'"`]+)\1/);
      url = fetchUrl?.[2];
      source = url ? `${url}|${method}` : (fetcher?.raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }

    calls.push({ kind, start, line: lineOf(content, start), key, url, source, optionsRaw });
  }
  return calls;
}

function getCachedDataParamCount(optionsRaw: string): number | null {
  const value = optionValueRaw(optionsRaw, 'getCachedData');
  if (!value) return null;
  let match = value.match(/^(?:async\s*)?\(([^)]*)\)\s*=>/);
  if (match) return countParams(match[1]!);
  match = value.match(/^(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/);
  if (match) return 1;
  // eslint-disable-next-line regexp/no-super-linear-backtracking -- keep Nuxt4 function-form param parsing; adjacent \s* is intentional
  match = value.match(/^(?:async\s*)?function\s*[A-Za-z_$]*\s*\(([^)]*)\)/);
  if (match) return countParams(match[1]!);
  return null;
}

function countParams(params: string): number {
  const parts = params
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part.startsWith('...'))) return 99;
  return parts.length;
}

function templateText(src: string): string {
  return src.match(/<template\b[^>]*>([\s\S]*)<\/template\s*>/)?.[1] ?? '';
}

const CONFLICT_OPTIONS = ['deep', 'transform', 'pick', 'getCachedData', 'default'] as const;

function conflictSignature(call: FetchCall): string {
  const options = CONFLICT_OPTIONS.map((name) => {
    const value = optionValueRaw(call.optionsRaw, name).replace(/\s+/g, ' ');
    // Nuxt 4's default is shallow data (deep: false).
    if (name === 'deep') return value || 'false';
    return value;
  });
  return [call.source, ...options].join('||');
}

/* ------------------------------------------------------------------ */
/* File discovery                                                      */
/* ------------------------------------------------------------------ */

const IGNORE = ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'];

async function appSourceFiles(root: string, dirs: SourceDirs): Promise<string[]> {
  const app = path.join(root, 'app');
  const entries: Array<{ dir: string; vue: boolean }> = [
    { dir: dirs.pagesDir, vue: true },
    { dir: dirs.componentsDir, vue: true },
    { dir: dirs.layoutsDir, vue: true },
    { dir: dirs.composablesDir, vue: false },
    { dir: dirs.utilsDir, vue: false },
    { dir: dirs.middlewareDir, vue: false },
    { dir: dirs.pluginsDir, vue: false },
    { dir: path.join(app, 'pages'), vue: true },
    { dir: path.join(app, 'components'), vue: true },
    { dir: path.join(app, 'layouts'), vue: true },
    { dir: path.join(app, 'composables'), vue: false },
    { dir: path.join(app, 'utils'), vue: false },
    { dir: path.join(app, 'middleware'), vue: false },
    { dir: path.join(app, 'plugins'), vue: false },
  ];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const { dir, vue } of entries) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!(await exists(resolved))) continue;
    const patterns = vue ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
    files.push(...(await findFiles(resolved, patterns, IGNORE)));
  }
  for (const base of [dirs.srcDir, root]) {
    for (const name of ['app.vue', 'error.vue', 'app.config.ts']) {
      const abs = path.join(base, name);
      if (await exists(abs)) files.push(abs);
    }
  }
  return [...new Set(files)];
}

/* ------------------------------------------------------------------ */
/* Structure checks (New Directory Structure)                          */
/* ------------------------------------------------------------------ */

const LEGACY_DIRS: Array<{ name: string; patterns: string[]; label: string }> = [
  { name: 'pages', patterns: ['**/*.vue'], label: 'pages/' },
  { name: 'components', patterns: ['**/*.vue'], label: 'components/' },
  { name: 'composables', patterns: ['**/*.{ts,js,mts,mjs}'], label: 'composables/' },
  { name: 'layouts', patterns: ['**/*.vue'], label: 'layouts/' },
  { name: 'middleware', patterns: ['**/*.{ts,js,mts,mjs}'], label: 'middleware/' },
  { name: 'plugins', patterns: ['**/*.{ts,js,mts,mjs}'], label: 'plugins/' },
  { name: 'utils', patterns: ['**/*.{ts,js,mts,mjs}'], label: 'utils/' },
  { name: 'assets', patterns: ['**/*'], label: 'assets/' },
];

const LEGACY_FILES = ['app.vue', 'error.vue', 'app.config.ts'];

async function structureFindings(
  root: string,
  dirs: SourceDirs,
  usesAppDir: boolean,
): Promise<Nuxt4MigrationFinding[]> {
  if (usesAppDir) return [];
  const findings: Nuxt4MigrationFinding[] = [];

  for (const entry of LEGACY_DIRS) {
    const abs = path.join(dirs.srcDir, entry.name);
    if (!(await exists(abs))) continue;
    const files = await findFiles(abs, entry.patterns, IGNORE);
    if (files.length === 0) continue;
    const rel = relativePath(root, abs) + '/';
    findings.push({
      file: rel,
      line: 1,
      ruleId: 'legacy-root-dir',
      severity: 'warning',
      reason: `${entry.label} lives outside app/, but Nuxt 4 resolves app code from app/ (srcDir) by default. Nuxt still auto-detects the old layout.`,
      fix: `Move ${entry.label} to app/${entry.label}`,
      guideSection: 'New Directory Structure',
    });
  }

  for (const name of LEGACY_FILES) {
    const abs = path.join(dirs.srcDir, name);
    if (!(await exists(abs))) continue;
    findings.push({
      file: relativePath(root, abs),
      line: 1,
      ruleId: 'legacy-root-file',
      severity: 'warning',
      reason: `${name} is at the project root; Nuxt 4's default srcDir is app/, so app-level files belong in app/. Nuxt still auto-detects the old layout.`,
      fix: `Move ${name} to app/${name}`,
      guideSection: 'New Directory Structure',
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* nuxt.config checks                                                  */
/* ------------------------------------------------------------------ */

function lineForKey(source: string, key: string): number {
  const index = source.search(new RegExp(`\\b${key}\\s*:`));
  return index >= 0 ? lineOf(source, index) : 1;
}

function configFindings(
  root: string,
  configPath: string,
  source: string,
  body: string,
  notes: string[],
): { findings: Nuxt4MigrationFinding[]; compatibilityVersion: number | null } {
  const findings: Nuxt4MigrationFinding[] = [];
  const rel = relativePath(root, configPath);

  const push = (
    line: number,
    ruleId: Nuxt4RuleId,
    severity: 'error' | 'warning',
    reason: string,
    fix: string,
    guideSection: string,
  ): void => {
    findings.push({ file: rel, line, ruleId, severity, reason, fix, guideSection });
  };

  const generate = findTopLevelValue(body, 'generate');
  if (generate !== undefined) {
    push(
      lineForKey(source, 'generate'),
      'removed-generate-config',
      'warning',
      'The top-level `generate` option was removed in Nuxt 4 and is ignored.',
      'Move `generate.exclude` / `generate.routes` to `nitro.prerender.ignore` / `nitro.prerender.routes`.',
      'Removal of Top-Level generate Configuration',
    );
  }

  const rawExperimental = findTopLevelValue(body, 'experimental');
  if (rawExperimental !== undefined) {
    const parsed = parseJsLiteral(rawExperimental);
    if (isPlainObject(parsed.value)) {
      const removed = ['treeshakeClientOnly', 'configSchema', 'polyfillVueUseHead', 'respectNoSSRHeader'];
      for (const key of removed) {
        if (key in parsed.value) {
          push(
            lineForKey(source, key),
            'removed-experimental-option',
            'warning',
            `experimental.${key} is no longer configurable in Nuxt 4; the configured value is ignored.`,
            `Remove experimental.${key} from nuxt.config.`,
            'Removal of Experimental Features',
          );
        }
      }
    } else if (isRawExpression(parsed.value)) {
      notes.push('experimental config is not statically evaluable; removed experimental options were not checked.');
    } else if (parsed.value !== undefined) {
      notes.push('experimental config is not a static object; removed experimental options were not checked.');
    }
  }

  const rawVite = findTopLevelValue(body, 'vite');
  if (rawVite !== undefined) {
    const parsed = parseJsLiteral(rawVite);
    if (isPlainObject(parsed.value) && 'devBundler' in parsed.value) {
      push(
        lineForKey(source, 'devBundler'),
        'removed-experimental-option',
        'warning',
        'vite.devBundler is no longer configurable in Nuxt 4; Nuxt uses vite-node by default.',
        'Remove vite.devBundler from nuxt.config.',
        'Removal of Experimental Features',
      );
    }
  }

  const pagesExtend = source.search(/['"]pages:extend['"]/);
  if (pagesExtend >= 0) {
    const window = source.slice(pagesExtend, pagesExtend + 2000);
    if (/\.meta\s*(?:\|\|=|=)|\.meta\s*\.\s*[A-Za-z_$][\w$]*\s*=/.test(window)) {
      push(
        lineOf(source, pagesExtend),
        'pages-extend-meta',
        'warning',
        'Page meta is scanned after `pages:extend` in Nuxt 4; mutating `page.meta` there is too late.',
        'Move page meta mutations to the `pages:resolved` hook.',
        'Scan Page Meta After Resolution',
      );
    }
  }

  let compatibilityVersion: number | null = null;
  const rawFuture = findTopLevelValue(body, 'future');
  if (rawFuture !== undefined) {
    const parsed = parseJsLiteral(rawFuture);
    if (isPlainObject(parsed.value)) {
      const version = parsed.value['compatibilityVersion'];
      if (typeof version === 'number') compatibilityVersion = version;
    } else if (isRawExpression(parsed.value)) {
      notes.push('future.compatibilityVersion is not statically evaluable.');
    }
  }

  return { findings, compatibilityVersion };
}

/* ------------------------------------------------------------------ */
/* Source checks                                                       */
/* ------------------------------------------------------------------ */

function nextLine(content: string, index: number): number {
  return lineOf(content, index);
}

function scanUseHeadRemovedProps(content: string, file: string): Nuxt4MigrationFinding[] {
  const findings: Nuxt4MigrationFinding[] = [];
  const callRe = /\buseHead\b/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(content))) {
    const open = findOpenParen(content, match.index + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    const inner = content.slice(open, close + 1);
    for (const prop of ['vmid', 'hid', 'children', 'body']) {
      const propRe = new RegExp(`\\b${prop}\\s*:`, 'g');
      let propMatch: RegExpExecArray | null;
      while ((propMatch = propRe.exec(inner))) {
        findings.push({
          file,
          line: nextLine(content, open + propMatch.index),
          ruleId: 'unhead-removed-prop',
          severity: 'warning',
          reason: `Unhead v2 removed the \`${prop}\` tag prop.`,
          fix: `Remove \`${prop}\` from useHead(); Unhead v2 no longer accepts it.`,
          guideSection: 'Unhead v2',
        });
      }
    }
  }
  return findings;
}

function regexFindings(
  content: string,
  file: string,
  re: RegExp,
  ruleId: Nuxt4RuleId,
  severity: 'error' | 'warning',
  reason: string,
  fix: string,
  guideSection: string,
  onlyWhen?: boolean,
): Nuxt4MigrationFinding[] {
  if (onlyWhen === false) return [];
  const findings: Nuxt4MigrationFinding[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    findings.push({
      file,
      line: lineOf(content, match.index),
      ruleId,
      severity,
      reason,
      fix,
      guideSection,
    });
  }
  return findings;
}

async function sourceFindings(root: string, dirs: SourceDirs): Promise<Nuxt4MigrationFinding[]> {
  const findings: Nuxt4MigrationFinding[] = [];
  const files = await appSourceFiles(root, dirs);

  const sharedKeyCalls: Array<{ file: string; call: FetchCall }> = [];

  for (const abs of files) {
    const content = await fs.readFile(abs, 'utf8').catch(() => '');
    if (!content) continue;
    const file = relativePath(root, abs);
    const isVue = abs.endsWith('.vue');
    const template = isVue ? templateText(content) : '';
    const calls = extractFetchCalls(content);
    const hasFetch = calls.length > 0;

    for (const call of calls) {
      sharedKeyCalls.push({ file, call });

      const cacheParams = getCachedDataParamCount(call.optionsRaw);
      if (cacheParams !== null && cacheParams < 3) {
        findings.push({
          file,
          line: call.line,
          ruleId: 'getcacheddata-old-signature',
          severity: 'warning',
          reason: 'getCachedData now receives a third context argument (`ctx.cause`); this implementation only accepts the old signature.',
          fix: 'Update getCachedData to `(key, nuxtApp, ctx) => ...` and check `ctx.cause` when deciding whether to use cached data.',
          guideSection: 'Singleton Data Fetching Layer',
        });
      }

      if (/\bimmediate\s*:\s*false\b/.test(call.optionsRaw) && isVue && /!\s*pending\b/.test(template)) {
        findings.push({
          file,
          line: call.line,
          ruleId: 'pending-idle',
          severity: 'warning',
          reason: 'With `immediate: false`, pending is now false until the first request; `!pending` no longer means "loading".',
          fix: "Use `status === 'success'` (or `status !== 'pending'`) instead of `!pending`.",
          guideSection: 'Alignment of pending value in useAsyncData and useFetch',
        });
      }

      if (
        isVue &&
        (call.kind === 'useAsyncData' || call.kind === 'useLazyAsyncData') &&
        !call.key &&
        ((call.url ?? '').includes('params') || call.source.includes('params')) &&
        /\[[^\]]+\]/.test(file)
      ) {
        findings.push({
          file,
          line: call.line,
          ruleId: 'shared-prerender-data',
          severity: 'warning',
          reason: 'Prerendered useAsyncData payloads are shared across pages in Nuxt 4; a dynamic page without an explicit key can reuse another route param\'s data.',
          fix: 'Pass a key that includes the route param, e.g. useAsyncData(`post-$' + '{slug}`, () => $fetch(`/api/posts/$' + '{slug}`)).',
          guideSection: 'Shared Prerender Data',
        });
      }
    }

    if (hasFetch) {
      findings.push(
        ...regexFindings(
          content,
          file,
          /\b(?:data|error)\s*(?:\.\s*value\s*)?(?:===?|!==?)\s*null\b/g,
          'default-data-error-null',
          'warning',
          'useAsyncData/useFetch now default `data` and `error` to undefined instead of null.',
          'Check for undefined instead of null, or use a truthiness check.',
          'Default data and error values in useAsyncData and useFetch',
        ),
      );

      findings.push(
        ...regexFindings(
          content,
          file,
          /\bdata\s*\.\s*value\s*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])+\s*(?:=(?!=)|\+=|-=|\*=|\/=|\.(?:push|pop|shift|unshift|splice|sort|reverse|fill)\s*\()/g,
          'shallow-data-mutation',
          'warning',
          'Fetched `data` is a shallowRef in Nuxt 4; mutating nested properties no longer triggers reactivity.',
          'Opt in with `{ deep: true }` on the fetch call, or replace `data.value` with a new object instead of mutating it.',
          'Shallow Data Reactivity in useAsyncData and useFetch',
        ),
      );
    }

    findings.push(
      ...regexFindings(
        content,
        file,
        /(?:\broute|\$route)\s*\.\s*meta\s*\.\s*(?:name|path)\b/g,
        'route-meta-dedup',
        'warning',
        'Route name/path are no longer duplicated onto route.meta in Nuxt 4.',
        'Read `route.name` / `route.path` instead of `route.meta.name` / `route.meta.path`.',
        'Deduplication of Route Metadata',
      ),
    );

    findings.push(
      ...regexFindings(
        content,
        file,
        /\bfrom\s+['"]@unhead\/vue['"]/g,
        'unhead-direct-import',
        'warning',
        'Unhead v2 recommends importing through `#imports` (or `nuxt/app`) instead of `@unhead/vue` directly.',
        "Change the import to `import { useHead } from '#imports'`.",
        'Unhead v2',
      ),
    );

    findings.push(...scanUseHeadRemovedProps(content, file));

    findings.push(
      ...regexFindings(
        content,
        file,
        /\brefresh\s*\(\s*\{\s*dedupe\s*:\s*(?:true|false)\b/g,
        'dedupe-boolean',
        'warning',
        'Nuxt 4 removed the boolean aliases for `refresh({ dedupe })`.',
        "Use `dedupe: 'cancel'` (was true) or `dedupe: 'defer'` (was false).",
        'Removal of deprecated boolean values for dedupe option when calling refresh in useAsyncData and useFetch',
      ),
    );

    findings.push(
      ...regexFindings(
        content,
        file,
        /\bwindow\s*\.\s*__NUXT__\b/g,
        'window-nuxt-global',
        'error',
        '`window.__NUXT__` is removed after hydration in Nuxt 4.',
        'Use `useNuxtApp().payload` instead.',
        'Removal of window.__NUXT__ object',
      ),
    );

    if (path.basename(abs) === 'error.vue') {
      findings.push(
        ...regexFindings(
          content,
          file,
          /JSON\s*\.\s*parse\s*\(\s*(?:props\s*\.\s*)?error\s*\.\s*data\s*\)/g,
          'error-data-parsed',
          'warning',
          'Nuxt 4 parses `error.data` before it reaches error.vue, so JSON.parse is now applied twice.',
          'Use `error.data` directly (or `props.error.data`).',
          'Parsed error.data',
        ),
      );
    }
  }

  // Singleton data layer: the same explicit key must not have conflicting
  // options or fetchers.
  const byKey = new Map<string, Array<{ file: string; call: FetchCall }>>();
  for (const entry of sharedKeyCalls) {
    if (!entry.call.key) continue;
    const list = byKey.get(entry.call.key) ?? [];
    list.push(entry);
    byKey.set(entry.call.key, list);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    for (const entry of group) {
      const signature = conflictSignature(entry.call);
      const other = group.find(
        (candidate) => candidate !== entry && conflictSignature(candidate.call) !== signature,
      );
      if (!other) continue;
      findings.push({
        file: entry.file,
        line: entry.call.line,
        ruleId: 'shared-key-conflict',
        severity: 'warning',
        reason: `Key "${key}" is also used at ${other.file}:${other.call.line} with different options or fetcher. Nuxt 4 shares data/error/status refs per key.`,
        fix: 'Make all calls with the same key use identical options and fetcher, or extract one useAsyncData/useFetch into a composable.',
        guideSection: 'Singleton Data Fetching Layer',
      });
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function checkNuxt4Migration(root: string): Promise<Nuxt4MigrationResult> {
  const notes: string[] = [
    'Static analysis only. Rules are limited to changes documented in the Nuxt 4 upgrade guide.',
    'Structure findings are only reported when srcDir is not app/; leftover root folders next to app/ are not flagged.',
    'Not checked because they are not reliably static: layer module load order, normalized component names, builder:watch paths, directory index scanning, inline styles, TypeScript config splitting, and EJS template compilation.',
  ];
  const dirs = await resolveSourceDirs(root);
  const { version, notes: versionNotes } = await readNuxtVersion(root);
  notes.push(...versionNotes);
  const major = parseNuxtMajor(version);
  const usesAppDir = path.resolve(dirs.srcDir) === path.resolve(root, 'app');

  const configPath = findConfigFile(root);
  let configSource = '';
  let configBody: string | null = null;
  let compatibilityVersion: number | null = null;
  const findings: Nuxt4MigrationFinding[] = [];

  if (configPath) {
    configSource = await fs.readFile(configPath, 'utf8').catch(() => '');
    configBody = configSource ? extractConfigBody(configSource) : null;
    if (configBody) {
      const configResult = configFindings(root, configPath, configSource, configBody, notes);
      findings.push(...configResult.findings);
      compatibilityVersion = configResult.compatibilityVersion;
    } else if (configSource) {
      notes.push('Could not locate defineNuxtConfig({...}) in nuxt.config.');
    }
  } else {
    notes.push('No nuxt.config file found; config-based rules were skipped.');
  }

  findings.push(...(await structureFindings(root, dirs, usesAppDir)));

  findings.push(...(await sourceFindings(root, dirs)));

  findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );

  const error = findings.filter((finding) => finding.severity === 'error').length;
  const warning = findings.filter((finding) => finding.severity === 'warning').length;
  const byRule: Record<string, number> = {};
  for (const finding of findings) {
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }

  if (major !== null && major < 4) {
    notes.push(`package.json declares Nuxt ${version}; upgrading to nuxt@^4 is the first migration step.`);
  }
  if (compatibilityVersion !== null) {
    notes.push(`future.compatibilityVersion is ${compatibilityVersion}.`);
  }
  if (usesAppDir) {
    notes.push('Project already uses the app/ directory.');
  }

  const readiness = error > 0 ? 'blocked' : warning > 0 ? 'needs-attention' : 'ready';

  return {
    project: {
      nuxtVersion: version,
      nuxtMajor: major,
      usesAppDir,
      compatibilityVersion,
      migrated: usesAppDir || (compatibilityVersion !== null && compatibilityVersion >= 4),
      configFile: configPath ? path.basename(configPath) : null,
    },
    readiness,
    findings,
    summary: { total: findings.length, error, warning, byRule },
    notes,
  };
}
