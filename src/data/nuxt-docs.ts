/**
 * Curated offline Nuxt documentation snippets. Kept small and deterministic so
 * agents get reliable guidance without network access.
 */
export interface NuxtDocsEntry {
  topic: string;
  title: string;
  body: string;
  related: string[];
}

const DOCS: NuxtDocsEntry[] = [
  {
    topic: 'routing',
    title: 'File-based Routing',
    body: 'Nuxt maps files under pages/ to routes. `pages/index.vue` -> `/`, `pages/about.vue` -> `/about`, `pages/users/[id].vue` -> `/users/:id` (dynamic), `pages/users/[[id]].vue` -> `/users/:id?` (optional), and `pages/docs/[...slug].vue` -> `/docs/:slug(.*)*` (catch-all). Nested routes use a parent file with a same-named directory plus child pages. Use definePageMeta({ layout, middleware, ... }) to attach layout, middleware and route meta.',
    related: ['components', 'layers'],
  },
  {
    topic: 'nitro',
    title: 'Nitro Server Engine',
    body: 'Files under server/api/ become Nitro API endpoints. `server/api/hello.get.ts` handles GET `/api/hello`; the method suffix (get/post/put/patch/delete) is stripped from the URL. `server/middleware/` runs before every request, and `server/plugins/` run once at server startup. Handlers use H3: `defineEventHandler(event)`, `readBody(event)`, `readValidatedBody(event, schema.safeParse)`, and `createError({ statusCode, statusMessage })`.',
    related: ['routing'],
  },
  {
    topic: 'modules',
    title: 'Nuxt Modules',
    body: 'Modules are added via the `modules` array in nuxt.config, e.g. `modules: [\'@nuxtjs/i18n\']` or `[\'@nuxtjs/i18n\', { locales: [\'en\'] }]`. They run at build time and can register components, composables, plugins, and config. Keep Nuxt modules in devDependencies, not dependencies. Local modules can be functions: `modules: [function () { ... }]`.',
    related: ['config'],
  },
  {
    topic: 'layers',
    title: 'Nuxt Layers (extends)',
    body: '`extends: [\'../layer-a\', \'../layer-b\']` composes multiple Nuxt projects into one app. Later entries override earlier ones, and the local project overrides all layers. Components, pages, composables, and config resolve across layers by priority; auto-imports and assets follow the same override chain. Use layers to share UI kits or split a monolith.',
    related: ['routing', 'components', 'config'],
  },
  {
    topic: 'composables',
    title: 'Composables & Auto-imports',
    body: 'Files in composables/ (and utils/) are auto-imported when they export a `useXxx` function. `composables/useFoo.ts` exports `useFoo` and is usable anywhere without an import statement. Nuxt also auto-imports Vue APIs (ref, computed, watch) and lifecycle hooks. The registry lives in `.nuxt/imports.d.ts` after `nuxi prepare`.',
    related: ['components'],
  },
  {
    topic: 'config',
    title: 'Nuxt Configuration',
    body: 'nuxt.config.ts exports `defineNuxtConfig({ ... })`. Common keys: `ssr`, `modules`, `extends`, `runtimeConfig.public` (exposed to the client), `nitro`, `app.head`, and `css`. Runtime config is read with `useRuntimeConfig()`. Prefer `runtimeConfig` over hard-coded env access so values are typed and overridable.',
    related: ['modules', 'layers'],
  },
  {
    topic: 'components',
    title: 'Vue Components',
    body: 'Files in components/ are auto-imported by their PascalCase path, e.g. `components/base/BaseButton.vue` -> `<BaseButton>`. Use `<script setup lang="ts">` with `defineProps<{...}>()` for typed props and `defineEmits<{...}>()` for events. Slots are declared with `<slot name="...">`; the unnamed slot is the default slot.',
    related: ['composables'],
  },
];

export function getNuxtDocs(topic: string): NuxtDocsEntry | null {
  const t = topic.trim().toLowerCase();
  return DOCS.find((d) => d.topic === t || d.title.toLowerCase().includes(t)) ?? null;
}

export function listNuxtDocsTopics(): string[] {
  return DOCS.map((d) => d.topic);
}
