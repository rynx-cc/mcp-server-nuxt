/**
 * Parse the Nuxt auto-imports registry from `.nuxt/imports.d.ts`
 * (and its fallback location `.nuxt/types/imports.d.ts`).
 *
 * Handles the common declaration shapes Nuxt emits across versions:
 *   export { ref, computed } from 'vue'
 *   export { default as BaseButton } from '/abs/components/BaseButton.vue'
 *   const useFoo: typeof import('/abs/composables/useFoo')['useFoo']
 *   export const useFoo: typeof import('/abs/composables/useFoo')['useFoo']
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AutoImportInfo, AutoImportKind } from '../types.js';

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function classify(name: string, source: string): AutoImportKind {
  if (source.endsWith('.vue') || source.includes('/components/')) return 'component';
  if (/^use[A-Z]/.test(name)) return 'function';
  if (/^[A-Z]/.test(name)) return 'value';
  return 'function';
}

function sourceFromType(type: string): string | undefined {
  const m = type.match(/typeof\s+import\(['"]([^'"]+)['"]\)/);
  return m?.[1];
}

/** Parse an `imports.d.ts` source into a deduplicated registry. */
export function parseImportsDts(content: string): AutoImportInfo[] {
  const result: AutoImportInfo[] = [];
  const seen = new Set<string>();

  const push = (name: string, source: string, signature?: string): void => {
    if (!name || name.startsWith('_')) return;
    if (seen.has(name)) return;
    seen.add(name);
    result.push({ name, source, kind: classify(name, source), signature });
  };

  for (const line of content.split('\n')) {
    // export { a, b as c } from 'source'
    const exportFrom = line.match(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/);
    if (exportFrom) {
      const source = exportFrom[2]!;
      for (const raw of exportFrom[1]!.split(',')) {
        const item = raw.trim();
        if (!item) continue;
        const as = item.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        if (as) push(as[2]!, source);
        else if (item === 'default') continue;
        else push(item, source);
      }
      continue;
    }

    // export const X: typeof import('source')['X']
    const exportConst = line.match(/export\s+const\s+([\w$]+)\s*:\s*([^\n;]+)/);
    if (exportConst) {
      const name = exportConst[1]!;
      const type = exportConst[2]!.trim();
      push(name, sourceFromType(type) ?? '#imports', type);
      continue;
    }

    // const X: typeof import('source')['X']  (inside declare global)
    const constDecl = line.match(/^\s*const\s+([\w$]+)\s*:\s*([^\n;]+)/);
    if (constDecl) {
      const name = constDecl[1]!;
      const type = constDecl[2]!.trim();
      push(name, sourceFromType(type) ?? '#imports', type);
      continue;
    }
  }

  return result;
}

/**
 * Read auto-imports from a Nuxt buildDir (`typesRoot`), or from `<project>/.nuxt` when
 * `typesRoot` is omitted (legacy).
 */
export async function readAutoImports(
  typesRootOrProjectRoot: string,
): Promise<{ built: boolean; imports: AutoImportInfo[] }> {
  const candidates = [
    path.join(typesRootOrProjectRoot, 'imports.d.ts'),
    path.join(typesRootOrProjectRoot, 'types', 'imports.d.ts'),
    // Legacy: callers passed the project root before types auto-generation existed.
    path.join(typesRootOrProjectRoot, '.nuxt', 'imports.d.ts'),
    path.join(typesRootOrProjectRoot, '.nuxt', 'types', 'imports.d.ts'),
  ];
  for (const file of candidates) {
    const content = await readIfExists(file);
    if (content) return { built: true, imports: parseImportsDts(content) };
  }
  return { built: false, imports: [] };
}
