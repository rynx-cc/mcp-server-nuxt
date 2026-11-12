/**
 * Auto-generate Nuxt type artifacts when `<root>/.nuxt` is missing.
 *
 * Mirrors `nuxi prepare`: loadNuxt({ _prepare: true }) → buildNuxt → writeTypes → close.
 * Writes to a cache directory (not the project `.nuxt`) unless writes are allowed.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findConfigFile } from './config-reader.js';
import { installNode18ImportMetaPaths } from './node18-import-meta.js';

export type TypesSource = 'project' | 'cache' | 'generated' | 'fallback' | 'none';

export interface TypesArtifacts {
  /** Absolute directory that contains imports.d.ts / tsconfig.json (buildDir). */
  typesDir: string | null;
  source: TypesSource;
  /** Wall-clock ms for generation, when this call generated. */
  generatedMs?: number;
  /** Human-readable failure reason (does not throw). */
  error?: string;
  hint?: string;
}

interface TypesMeta {
  fingerprint: string;
  projectRoot: string;
  generatedAt: string;
}

interface NuxtKitLike {
  loadNuxt: (opts: Record<string, unknown>) => Promise<{
    options: { buildDir: string; typesDir?: string; rootDir: string };
    close?: () => Promise<void>;
  }>;
  buildNuxt: (nuxt: unknown) => Promise<unknown>;
  writeTypes: (nuxt: unknown) => Promise<void>;
}

const META_FILE = '.mcp-nuxt-types-meta.json';
const inFlight = new Map<string, Promise<TypesArtifacts>>();

function projectHasNuxt(root: string): boolean {
  return existsSync(path.join(root, 'node_modules', 'nuxt', 'package.json'));
}

function projectTypesReady(root: string): boolean {
  const nuxtDir = path.join(root, '.nuxt');
  return (
    existsSync(path.join(nuxtDir, 'tsconfig.json')) ||
    existsSync(path.join(nuxtDir, 'tsconfig.app.json')) ||
    existsSync(path.join(nuxtDir, 'imports.d.ts'))
  );
}

function cacheTypesReady(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'tsconfig.json')) ||
    existsSync(path.join(dir, 'tsconfig.app.json')) ||
    existsSync(path.join(dir, 'imports.d.ts'))
  );
}

async function hashFile(hash: ReturnType<typeof createHash>, file: string, label: string): Promise<void> {
  hash.update(label).update('\0').update(file).update('\0');
  try {
    const st = await fs.stat(file);
    hash.update(String(st.mtimeMs)).update(String(st.size));
    hash.update(await fs.readFile(file, 'utf8'));
  } catch {
    hash.update(`missing:${label}`);
  }
}

/** Fingerprint of nuxt.config.* + package.json so dep/config edits invalidate the cache. */
export async function configFingerprint(projectRoot: string): Promise<string> {
  const hash = createHash('sha1').update(projectRoot).update('\0');
  const configPath = findConfigFile(projectRoot);
  if (configPath) await hashFile(hash, configPath, 'nuxt.config');
  else hash.update('no-config');
  await hashFile(hash, path.join(projectRoot, 'package.json'), 'package.json');
  return hash.digest('hex');
}

export function resolveTypesCacheDir(projectRoot: string): string {
  const slug = createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 16);
  const nm = path.join(projectRoot, 'node_modules');
  if (existsSync(nm)) {
    return path.join(nm, '.cache', 'mcp-server-nuxt', 'types', slug);
  }
  return path.join(os.tmpdir(), 'mcp-server-nuxt', 'types', slug);
}

async function readMeta(dir: string): Promise<TypesMeta | null> {
  try {
    const raw = await fs.readFile(path.join(dir, META_FILE), 'utf8');
    return JSON.parse(raw) as TypesMeta;
  } catch {
    return null;
  }
}

async function writeMeta(dir: string, meta: TypesMeta): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf8');
}

async function loadKit(projectRoot: string): Promise<NuxtKitLike> {
  await installNode18ImportMetaPaths();
  const require = createRequire(path.join(projectRoot, 'package.json'));
  try {
    const kitPath = require.resolve('@nuxt/kit');
    return (await import(pathToFileURL(kitPath).href)) as NuxtKitLike;
  } catch {
    // Fall back to the optional dependency shipped with mcp-server-nuxt.
    return (await import('@nuxt/kit')) as NuxtKitLike;
  }
}

async function generateTypes(
  projectRoot: string,
  buildDir: string,
): Promise<{ generatedMs: number }> {
  if (!projectHasNuxt(projectRoot)) {
    throw new Error(
      `No local nuxt install in ${projectRoot}. Install nuxt in the project so types can be generated.`,
    );
  }

  const kit = await loadKit(projectRoot);
  if (typeof kit.loadNuxt !== 'function' || typeof kit.writeTypes !== 'function') {
    throw new Error('@nuxt/kit does not export loadNuxt/writeTypes');
  }

  await fs.mkdir(buildDir, { recursive: true });
  const t0 = Date.now();
  const prevNodeEnv = process.env.NODE_ENV;
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

  let nuxt: Awaited<ReturnType<NuxtKitLike['loadNuxt']>> | undefined;
  try {
    nuxt = await kit.loadNuxt({
      cwd: projectRoot,
      ready: true,
      dev: false,
      overrides: {
        _prepare: true,
        buildDir,
        typesDir: buildDir,
      },
    });
    if (typeof kit.buildNuxt === 'function') {
      await kit.buildNuxt(nuxt);
    }
    await kit.writeTypes(nuxt);
  } finally {
    try {
      if (nuxt?.close) await nuxt.close();
    } catch {
      /* ignore close errors */
    }
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }

  if (!cacheTypesReady(buildDir)) {
    throw new Error(`Types generation finished but ${buildDir} has no tsconfig/imports artifacts`);
  }

  return { generatedMs: Date.now() - t0 };
}

/**
 * Resolve a usable types directory for the project, generating into cache when needed.
 * Never throws — failures are returned on the result object.
 */
export async function ensureNuxtTypes(
  projectRoot: string,
  options: { allowWrites?: boolean; force?: boolean } = {},
): Promise<TypesArtifacts> {
  const root = path.resolve(projectRoot);
  const key = root;

  if (!options.force) {
    const existing = inFlight.get(key);
    if (existing) return existing;
  }

  const run = (async (): Promise<TypesArtifacts> => {
    try {
      if (!options.force && projectTypesReady(root)) {
        return { typesDir: path.join(root, '.nuxt'), source: 'project' };
      }

      const fingerprint = await configFingerprint(root);
      const cacheDir = resolveTypesCacheDir(root);

      if (!options.force && cacheTypesReady(cacheDir)) {
        const meta = await readMeta(cacheDir);
        if (meta?.fingerprint === fingerprint) {
          return { typesDir: cacheDir, source: 'cache' };
        }
      }

      const targetDir = options.allowWrites ? path.join(root, '.nuxt') : cacheDir;

      const { generatedMs } = await generateTypes(root, targetDir);
      await writeMeta(targetDir, {
        fingerprint,
        projectRoot: root,
        generatedAt: new Date().toISOString(),
      });

      return {
        typesDir: targetDir,
        source: 'generated',
        generatedMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        typesDir: null,
        source: 'none',
        error: message,
        hint:
          'Install nuxt in the target project (and ensure @nuxt/kit can resolve it). Types are generated via loadNuxt → buildNuxt → writeTypes into a cache directory, not into project .nuxt unless MCP_NUXT_ALLOW_WRITES is set.',
      };
    }
  })();

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

/** Drop in-flight / allow next call to regenerate after config changes. */
export function clearTypesGeneratorState(projectRoot?: string): void {
  if (projectRoot) inFlight.delete(path.resolve(projectRoot));
  else inFlight.clear();
}
