/**
 * Resolve `@nuxt/kit` for a target Nuxt project.
 *
 * The project's own install wins so Nuxt 3 gets Kit 3 and Nuxt 4 gets Kit 4.
 * The copy bundled with this server (optional dependency, Nuxt 3 range) is only
 * used when the project cannot resolve Kit itself.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installNode18ImportMetaPaths } from './node18-import-meta.js';

export type NuxtKitSource = 'project' | 'bundled';

export interface ImportedNuxtKit<T> {
  kit: T;
  source: NuxtKitSource;
  /** Absolute path, or the bare specifier for the bundled copy. */
  from: string;
}

/** Diagnostic line on stderr. Kit failures must not disappear into an empty catch. */
export function debugKit(message: string): void {
  console.error(`[mcp-server-nuxt] debug: ${message}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Import `@nuxt/kit` from `projectRoot/node_modules` first, then from this
 * package's optional dependency. Returns null when both imports fail.
 * Installs the Node 18 `import.meta.dirname` loader before either import.
 */
export async function importNuxtKit<T = Record<string, unknown>>(
  projectRoot: string,
): Promise<ImportedNuxtKit<T> | null> {
  await installNode18ImportMetaPaths();
  const root = path.resolve(projectRoot);
  let projectError = '';
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const kitPath = require.resolve('@nuxt/kit');
    const kit = (await import(pathToFileURL(kitPath).href)) as T;
    return { kit, source: 'project', from: kitPath };
  } catch (err) {
    projectError = errorMessage(err);
  }

  try {
    const kit = (await import('@nuxt/kit')) as T;
    debugKit(
      `@nuxt/kit was not resolved from ${root} (${projectError}). Using the server's bundled optional copy.`,
    );
    return { kit, source: 'bundled', from: '@nuxt/kit' };
  } catch (err) {
    debugKit(
      `@nuxt/kit was not resolved from ${root} (${projectError}). Bundled optional copy failed (${errorMessage(err)}).`,
    );
    return null;
  }
}
