/**
 * Static usage analysis for components and composables.
 *
 * Resolves a component name / file path or composable name, then scans the app
 * source for references: explicit imports, Nuxt auto-imports (PascalCase
 * components, nested names, `Lazy` prefix, kebab-case templates) and composable
 * call sites. Without a target it reports components/composables that are never
 * referenced. No DevServer, no nuxi prepare.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ComponentInfo, ComposableInfo } from '../types.js';
import { exists, findFiles, listComposables, relativePath } from './nuxt-parser.js';
import { listComponents } from './component-scan.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';

export type UsageKind = 'component' | 'composable';

export interface UsageTarget {
  kind: UsageKind;
  name: string;
  file: string;
}

export interface UsageMatch {
  file: string;
  line: number;
  name: string;
  via: 'import' | 'auto-import' | 'template';
}

export interface UnusedItem {
  kind: UsageKind;
  name: string;
  file: string;
}

export interface FindUsagesResult {
  target: UsageTarget | null;
  usages: UsageMatch[];
  unused: UnusedItem[];
  summary: string;
  notes: string[];
}

interface Candidate {
  kind: UsageKind;
  name: string;
  file: string;
  absolutePath: string;
  aliases: string[];
}

interface UsageIndex {
  byAlias: Map<string, Candidate>;
  byFile: Map<string, Candidate>;
}

const EXCLUDED_DIRS = ['pages/', 'layouts/', 'plugins/'];

function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function aliasesFor(kind: UsageKind, name: string): string[] {
  if (kind === 'composable') return [name];
  const kebab = kebabCase(name);
  return [name, `Lazy${name}`, kebab, `lazy-${kebab}`];
}

/** Entry-point files are not "unused" candidates. */
function isExcludedCandidate(file: string): boolean {
  let normalized = file.replace(/\\/g, '/');
  if (normalized.startsWith('app/')) normalized = normalized.slice('app/'.length);
  if (EXCLUDED_DIRS.some((dir) => normalized.startsWith(dir))) return true;
  const base = normalized.split('/').pop() ?? '';
  return base === 'app.vue' || base === 'error.vue';
}

function buildCandidates(
  components: ComponentInfo[],
  composables: ComposableInfo[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const component of components) {
    if (isExcludedCandidate(component.file)) continue;
    candidates.push({
      kind: 'component',
      name: component.name,
      file: component.file,
      absolutePath: component.absolutePath,
      aliases: aliasesFor('component', component.name),
    });
  }
  for (const composable of composables) {
    if (isExcludedCandidate(composable.file)) continue;
    candidates.push({
      kind: 'composable',
      name: composable.name,
      file: composable.file,
      absolutePath: composable.absolutePath,
      aliases: aliasesFor('composable', composable.name),
    });
  }
  return candidates;
}

function buildIndex(candidates: Candidate[]): UsageIndex {
  const byAlias = new Map<string, Candidate>();
  const byFile = new Map<string, Candidate>();
  for (const candidate of candidates) {
    for (const alias of candidate.aliases) {
      if (!byAlias.has(alias)) byAlias.set(alias, candidate);
    }
    if (!byFile.has(candidate.file)) byFile.set(candidate.file, candidate);
  }
  return { byAlias, byFile };
}

function posixDirname(file: string): string {
  const dir = path.posix.dirname(file);
  return dir === '.' ? '' : dir;
}

/** Match an import specifier (`~/...`, `@/...`, `../...`) against a candidate file. */
function matchSpecifier(specifier: string, importFileRel: string, index: UsageIndex): Candidate | null {
  const spec = specifier.replace(/\\/g, '/');
  const stripped = spec.replace(/^[@~]{1,2}\//, '').replace(/^\/+/, '');
  const direct = index.byFile.get(stripped);
  if (direct) return direct;

  if (spec.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(posixDirname(importFileRel), spec));
    const rel = index.byFile.get(resolved);
    if (rel) return rel;
  }

  for (const [file, candidate] of index.byFile) {
    if (stripped.endsWith(file) || file.endsWith(stripped)) return candidate;
  }
  return null;
}

interface Reference {
  candidate: Candidate;
  name: string;
  via: UsageMatch['via'];
}

function importRefs(line: string, importFileRel: string, index: UsageIndex): Reference[] {
  const match = line.match(/^import (.+) from ['"]([^'"]+)['"]/);
  if (!match) return [];

  const bindings = match[1]!;
  const specifier = match[2]!;
  const refs: Reference[] = [];

  const bySpecifier = matchSpecifier(specifier, importFileRel, index);
  if (bySpecifier) refs.push({ candidate: bySpecifier, name: specifier, via: 'import' });

  const identRe = /[A-Za-z_$][\w$]*/g;
  let identMatch: RegExpExecArray | null;
  while ((identMatch = identRe.exec(bindings))) {
    const candidate = index.byAlias.get(identMatch[0]!);
    if (candidate && !refs.some((ref) => ref.candidate === candidate)) {
      refs.push({ candidate, name: identMatch[0]!, via: 'import' });
    }
  }
  return refs;
}

const TAG_RE = /<\/?\s*([A-Za-z][\w-]*)/g;
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

function tagRefs(line: string, index: UsageIndex): Reference[] {
  const refs: Reference[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(line))) {
    const tag = match[1]!;
    const candidate = index.byAlias.get(tag);
    if (candidate) refs.push({ candidate, name: tag, via: 'template' });
  }
  return refs;
}

function identifierRefs(line: string, index: UsageIndex): Reference[] {
  const refs: Reference[] = [];
  IDENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENT_RE.exec(line))) {
    const word = match[0]!;
    const candidate = index.byAlias.get(word);
    if (candidate) refs.push({ candidate, name: word, via: 'auto-import' });
  }
  return refs;
}

function lineReferences(line: string, importFileRel: string, index: UsageIndex): Reference[] {
  const refs = [
    ...importRefs(line, importFileRel, index),
    ...tagRefs(line, index),
    ...identifierRefs(line, index),
  ];
  const seen = new Set<Candidate>();
  const deduped: Reference[] = [];
  for (const ref of refs) {
    if (seen.has(ref.candidate)) continue;
    seen.add(ref.candidate);
    deduped.push(ref);
  }
  return deduped;
}

function resolveTarget(target: string, candidates: Candidate[]): Candidate | null {
  const trimmed = target.trim();
  const looksLikeFile =
    /\.(?:vue|ts|js|mts|mjs)$/.test(trimmed) ||
    trimmed.includes('components/') ||
    trimmed.includes('composables/') ||
    trimmed.includes('utils/') ||
    path.isAbsolute(trimmed);

  if (looksLikeFile) {
    const normalized = trimmed.replace(/\\/g, '/');
    const abs = path.isAbsolute(normalized) ? path.resolve(normalized) : null;
    return (
      candidates.find(
        (candidate) =>
          candidate.file === normalized ||
          (abs !== null && candidate.absolutePath === abs) ||
          normalized.endsWith(candidate.file) ||
          candidate.file.endsWith(normalized),
      ) ?? null
    );
  }

  let match = candidates.find((candidate) => candidate.name === trimmed);
  if (match) return match;
  match = candidates.find((candidate) => candidate.aliases.includes(trimmed));
  if (match) return match;
  const kebab = kebabCase(trimmed);
  match = candidates.find((candidate) => candidate.name === kebab || candidate.aliases.includes(kebab));
  return match ?? null;
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

export async function findUsages(
  root: string,
  target?: string,
  options: { components?: ComponentInfo[]; composables?: ComposableInfo[] } = {},
): Promise<FindUsagesResult> {
  const notes: string[] = [];
  const components = options.components ?? (await listComponents(root));
  const composables = options.composables ?? (await listComposables(root));
  const candidates = buildCandidates(components, composables);
  const index = buildIndex(candidates);
  const dirs = await resolveSourceDirs(root);
  const files = await collectScanFiles(root, dirs);

  if (target && target.trim() !== '') {
    const resolved = resolveTarget(target, candidates);
    if (!resolved) {
      const needle = target.toLowerCase();
      const suggestions = candidates
        .filter(
          (candidate) =>
            candidate.name.toLowerCase().includes(needle) ||
            candidate.file.toLowerCase().includes(needle),
        )
        .slice(0, 5)
        .map((candidate) => `${candidate.name} (${candidate.file})`);
      return {
        target: null,
        usages: [],
        unused: [],
        summary: `Could not resolve "${target}" to a component or composable.`,
        notes: suggestions.length > 0 ? [`Did you mean ${suggestions.join(', ')}?`] : [],
      };
    }

    const usages: UsageMatch[] = [];
    for (const file of files) {
      const fileRel = relativePath(root, file);
      if (fileRel === resolved.file) continue;
      const content = await fs.readFile(file, 'utf8').catch(() => '');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const ref of lineReferences(lines[i]!, fileRel, index)) {
          if (ref.candidate === resolved) {
            usages.push({ file: fileRel, line: i + 1, name: ref.name, via: ref.via });
          }
        }
      }
    }

    usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return {
      target: { kind: resolved.kind, name: resolved.name, file: resolved.file },
      usages,
      unused: [],
      summary: `Found ${usages.length} usage(s) of ${resolved.name} (${resolved.kind}).`,
      notes,
    };
  }

  // No target: report every component/composable that is never referenced.
  const used = new Set<Candidate>();
  for (const file of files) {
    const fileRel = relativePath(root, file);
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const ref of lineReferences(lines[i]!, fileRel, index)) {
        if (ref.candidate.absolutePath === file) continue;
        used.add(ref.candidate);
      }
    }
  }

  const unused = candidates
    .filter((candidate) => !used.has(candidate))
    .map((candidate) => ({ kind: candidate.kind, name: candidate.name, file: candidate.file }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return {
    target: null,
    usages: [],
    unused,
    summary: `Found ${unused.length} unused component(s)/composable(s) out of ${candidates.length}.`,
    notes,
  };
}
