/**
 * Resolve the directories Nuxt scans for pages, components, composables, and
 * Nitro handlers.
 *
 * Explicit `srcDir` / `serverDir` / `dir.pages` win. Otherwise this follows
 * Nuxt's folder rules: Nuxt 3 stays at the project root, and Nuxt 4 (or
 * `compatibilityVersion: 4`) uses `app/` when that directory actually holds
 * source files. A v3-style `app/` that only contains `router.options.*` or
 * `spa-loading-template.html` does not become `srcDir` when the root still
 * has `pages/`, `app.vue`, and the other v3 directories.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findConfigFile, parseConfigSource } from './config-reader.js';

export interface SourceDirs {
  root: string;
  srcDir: string;
  serverDir: string;
  pagesDir: string;
  componentsDir: string;
  composablesDir: string;
  utilsDir: string;
  layoutsDir: string;
  middlewareDir: string;
  pluginsDir: string;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function quotedString(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`\\b${key}\\s*:\\s*(['"])([^'"]+)\\1`));
  return match?.[2];
}

function stringOption(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function dirOption(source: string, value: Record<string, unknown>, key: string, fallback: string): string {
  const dir = value['dir'];
  if (dir && typeof dir === 'object' && !Array.isArray(dir)) {
    const record = dir as Record<string, unknown>;
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    if (typeof record['__raw'] === 'string') {
      const fromRaw = quotedString(record['__raw'], key);
      if (fromRaw) return fromRaw;
    }
  }
  const block = source.match(/\bdir\s*:\s*\{([^{}]*)\}/);
  if (block) {
    const fromBlock = quotedString(block[1]!, key);
    if (fromBlock) return fromBlock;
  }
  return fallback;
}

function compatibilityVersion(source: string, value: Record<string, unknown>): 3 | 4 | undefined {
  const top = value['compatibilityVersion'];
  if (top === 3 || top === 4) return top;
  const future = value['future'];
  if (future && typeof future === 'object' && !Array.isArray(future)) {
    const record = future as Record<string, unknown>;
    if (record['compatibilityVersion'] === 3 || record['compatibilityVersion'] === 4) {
      return record['compatibilityVersion'];
    }
    if (typeof record['__raw'] === 'string') {
      const match = record['__raw'].match(/compatibilityVersion\s*:\s*['"]?([34])['"]?/);
      if (match) return Number(match[1]) as 3 | 4;
    }
  }
  const match = source.match(/compatibilityVersion\s*:\s*['"]?([34])['"]?/);
  return match ? (Number(match[1]) as 3 | 4) : undefined;
}

async function nuxtMajor(root: string): Promise<number | undefined> {
  const candidates = [path.join(root, 'node_modules', 'nuxt', 'package.json'), path.join(root, 'package.json')];
  for (const file of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      let version: string | undefined;
      if (file.includes(`${path.sep}nuxt${path.sep}package.json`) && typeof pkg.version === 'string') {
        version = pkg.version;
      } else {
        const deps = {
          ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
          ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
        };
        version = deps['nuxt'] ?? deps['nuxt-edge'];
      }
      const match = version?.match(/(\d+)\./);
      if (match) return Number(match[1]);
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

/**
 * Nuxt 4 srcDir detection. Returns `<root>/app` when that directory contains
 * anything other than the v3 router-options files, otherwise `<root>` when
 * the v3 tree is still present.
 */
export async function detectV4SrcDir(root: string): Promise<string> {
  const appDir = path.join(root, 'app');
  if (!(await exists(appDir))) return root;

  let names: string[] = [];
  try {
    names = await fs.readdir(appDir);
  } catch {
    return root;
  }

  const meaningful = names.filter((file) => file !== 'spa-loading-template.html' && !file.startsWith('router.options'));
  if (meaningful.length === 0) {
    for (const file of ['app.vue', 'App.vue']) {
      if (await exists(path.join(root, file))) return root;
    }
    for (const dir of ['assets', 'layouts', 'middleware', 'pages', 'plugins']) {
      if (await exists(path.join(root, dir))) return root;
    }
  }
  return appDir;
}

export async function resolveSourceDirs(projectRoot: string): Promise<SourceDirs> {
  const root = path.resolve(projectRoot);
  const configPath = findConfigFile(root);
  let source = '';
  if (configPath) {
    try {
      source = await fs.readFile(configPath, 'utf8');
    } catch {
      source = '';
    }
  }
  const value = source ? parseConfigSource(source) : {};
  const explicitSrc = stringOption(value, 'srcDir') ?? (source ? quotedString(source, 'srcDir') : undefined);
  const explicitServer = stringOption(value, 'serverDir') ?? (source ? quotedString(source, 'serverDir') : undefined);

  let srcDir: string;
  if (explicitSrc) {
    srcDir = path.resolve(root, explicitSrc);
  } else {
    const compat = compatibilityVersion(source, value);
    const major = await nuxtMajor(root);
    const v4 = compat === 4 || (compat !== 3 && (major === undefined || major >= 4));
    srcDir = v4 ? await detectV4SrcDir(root) : root;
  }

  const serverDir = explicitServer ? path.resolve(root, explicitServer) : path.join(root, 'server');
  const pagesName = dirOption(source, value, 'pages', 'pages');
  const layoutsName = dirOption(source, value, 'layouts', 'layouts');
  const middlewareName = dirOption(source, value, 'middleware', 'middleware');
  const pluginsName = dirOption(source, value, 'plugins', 'plugins');

  return {
    root,
    srcDir,
    serverDir,
    pagesDir: path.join(srcDir, pagesName),
    componentsDir: path.join(srcDir, 'components'),
    composablesDir: path.join(srcDir, 'composables'),
    utilsDir: path.join(srcDir, 'utils'),
    layoutsDir: path.join(srcDir, layoutsName),
    middlewareDir: path.join(srcDir, middlewareName),
    pluginsDir: path.join(srcDir, pluginsName),
  };
}
