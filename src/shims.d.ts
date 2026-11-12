// Ambient type declarations for optional dependencies so the project still
// typechecks when they are not installed. When the real package is present,
// TypeScript resolves its bundled types instead.
declare module '@nuxt/kit' {
  export function loadNuxtConfig(
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  export function loadNuxt(options?: Record<string, unknown>): Promise<{
    apps?: Record<string, { pages?: unknown[] }>;
    options: { buildDir: string; typesDir?: string; rootDir: string };
    close?: () => Promise<void>;
  }>;

  export function buildNuxt(nuxt: unknown): Promise<unknown>;

  export function writeTypes(nuxt: unknown): Promise<void>;
}
