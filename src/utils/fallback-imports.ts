/**
 * Fallback auto-imports registry when Nuxt types cannot be generated
 * (no local `nuxt` install / kit failure).
 */
import type { AutoImportInfo } from '../types.js';
import type { ComponentInfo, ComposableInfo } from '../types.js';

/** Common Nuxt / Vue auto-imports agents expect even without `.nuxt/imports.d.ts`. */
export const BUILTIN_NUXT_IMPORTS: ReadonlyArray<{ name: string; source: string; kind: AutoImportInfo['kind'] }> = [
  { name: 'useState', source: '#app', kind: 'function' },
  { name: 'useFetch', source: '#app', kind: 'function' },
  { name: 'useAsyncData', source: '#app', kind: 'function' },
  { name: 'useLazyAsyncData', source: '#app', kind: 'function' },
  { name: 'useLazyFetch', source: '#app', kind: 'function' },
  { name: 'useRoute', source: '#vue-router', kind: 'function' },
  { name: 'useRouter', source: '#vue-router', kind: 'function' },
  { name: 'useRuntimeConfig', source: '#app', kind: 'function' },
  { name: 'useAppConfig', source: '#app', kind: 'function' },
  { name: 'useHead', source: '#app', kind: 'function' },
  { name: 'useSeoMeta', source: '#app', kind: 'function' },
  { name: 'navigateTo', source: '#app', kind: 'function' },
  { name: 'abortNavigation', source: '#app', kind: 'function' },
  { name: 'useCookie', source: '#app', kind: 'function' },
  { name: 'useRequestHeaders', source: '#app', kind: 'function' },
  { name: 'useRequestEvent', source: '#app', kind: 'function' },
  { name: 'useRequestURL', source: '#app', kind: 'function' },
  { name: 'useNuxtApp', source: '#app', kind: 'function' },
  { name: 'useError', source: '#app', kind: 'function' },
  { name: 'clearError', source: '#app', kind: 'function' },
  { name: 'showError', source: '#app', kind: 'function' },
  { name: 'createError', source: '#app', kind: 'function' },
  { name: 'refreshNuxtData', source: '#app', kind: 'function' },
  { name: 'clearNuxtData', source: '#app', kind: 'function' },
  { name: 'preloadRouteComponents', source: '#app', kind: 'function' },
  { name: 'prefetchComponents', source: '#app', kind: 'function' },
  { name: 'defineNuxtPlugin', source: '#app', kind: 'function' },
  { name: 'definePageMeta', source: '#app', kind: 'function' },
  { name: 'defineNuxtComponent', source: '#app', kind: 'function' },
  { name: 'defineNuxtRouteMiddleware', source: '#app', kind: 'function' },
  { name: 'ref', source: 'vue', kind: 'function' },
  { name: 'computed', source: 'vue', kind: 'function' },
  { name: 'watch', source: 'vue', kind: 'function' },
  { name: 'watchEffect', source: 'vue', kind: 'function' },
  { name: 'reactive', source: 'vue', kind: 'function' },
  { name: 'onMounted', source: 'vue', kind: 'function' },
  { name: 'onBeforeUnmount', source: 'vue', kind: 'function' },
  { name: 'nextTick', source: 'vue', kind: 'function' },
];

export function buildFallbackAutoImports(
  components: ComponentInfo[],
  composables: ComposableInfo[],
): AutoImportInfo[] {
  const seen = new Set<string>();
  const out: AutoImportInfo[] = [];

  const push = (item: AutoImportInfo): void => {
    if (!item.name || seen.has(item.name)) return;
    seen.add(item.name);
    out.push(item);
  };

  for (const builtin of BUILTIN_NUXT_IMPORTS) {
    push({ name: builtin.name, source: builtin.source, kind: builtin.kind });
  }

  for (const c of composables) {
    push({
      name: c.name,
      source: c.file || c.absolutePath,
      kind: 'function',
      signature: c.returnType ? `() => ${c.returnType}` : undefined,
    });
  }

  for (const c of components) {
    push({
      name: c.name,
      source: c.file || c.absolutePath,
      kind: 'component',
    });
  }

  return out;
}
