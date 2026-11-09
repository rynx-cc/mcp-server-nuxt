import { describe, expect, it } from 'vitest';
import {
  appendModule,
  extractConfigBody,
  getConfigValue,
  parseConfigSource,
  setConfigValue,
} from '../src/utils/config-reader.js';

describe('extractConfigBody', () => {
  it('extracts the defineNuxtConfig object', () => {
    const source = "export default defineNuxtConfig({\n  ssr: true,\n})";
    expect(extractConfigBody(source)).toContain('ssr: true');
  });

  it('falls back to export default object', () => {
    const source = 'export default { ssr: false }';
    expect(extractConfigBody(source)).toBe(' ssr: false ');
  });

  it('returns null when no config object is present', () => {
    expect(extractConfigBody('const x = 1')).toBeNull();
  });
});

describe('parseConfigSource', () => {
  it('parses top-level key/value pairs', () => {
    const source = "export default defineNuxtConfig({ ssr: true, app: { head: { title: 'X' } } })";
    const parsed = parseConfigSource(source);
    expect(parsed['ssr']).toBe(true);
    expect(parsed['app']).toMatchObject({ __raw: expect.stringContaining('head') });
  });
});

describe('getConfigValue', () => {
  const config = { ssr: true, runtimeConfig: { public: { apiBase: 'https://x' } } };

  it('returns the whole config when key is empty', () => {
    expect(getConfigValue(config, undefined)).toBe(config);
    expect(getConfigValue(config, '')).toBe(config);
  });

  it('reads nested keys by dot-notation', () => {
    expect(getConfigValue(config, 'runtimeConfig.public.apiBase')).toBe('https://x');
    expect(getConfigValue(config, 'ssr')).toBe(true);
  });

  it('returns undefined for missing keys', () => {
    expect(getConfigValue(config, 'runtimeConfig.missing')).toBeUndefined();
  });
});

describe('setConfigValue', () => {
  const source = [
    "export default defineNuxtConfig({",
    "  modules: ['@nuxtjs/tailwindcss'],",
    "  ssr: true,",
    "  runtimeConfig: { public: { apiBase: 'https://api.example.com' } },",
    '})',
  ].join('\n');

  it('updates an existing top-level key', () => {
    const { newSource } = setConfigValue(source, 'ssr', false);
    expect(newSource).toContain('  ssr: false,');
    expect(newSource).not.toContain('ssr: true');
  });

  it('updates a nested key and preserves surrounding formatting', () => {
    const { newSource } = setConfigValue(source, 'runtimeConfig.public.apiBase', 'https://staging.example.com');
    expect(newSource).toContain('apiBase: "https://staging.example.com"');
    expect(newSource).toContain('  runtimeConfig: { public: { apiBase:');
  });

  it('inserts a missing top-level key', () => {
    const { newSource } = setConfigValue(source, 'nitro', { preset: 'node' });
    expect(newSource).toContain('nitro:');
    expect(newSource).toContain('preset');
  });
});

describe('appendModule', () => {
  const source = [
    "export default defineNuxtConfig({",
    "  modules: ['@nuxtjs/tailwindcss'],",
    "  ssr: true,",
    '})',
  ].join('\n');

  it('appends a string module to an existing modules array', () => {
    const { newSource } = appendModule(source, '@nuxtjs/i18n');
    expect(newSource).toContain("modules: ['@nuxtjs/tailwindcss', \"@nuxtjs/i18n\"]");
    expect(newSource).toContain('  ssr: true,');
  });

  it('appends a module with options as a tuple', () => {
    const { newSource } = appendModule(source, '@nuxtjs/i18n', { locales: ['en', 'fr'] });
    expect(newSource).toContain('["@nuxtjs/i18n",');
    expect(newSource).toContain('"locales"');
    expect(newSource).toContain('"en"');
  });

  it('inserts a modules array when none exists', () => {
    const bare = 'export default defineNuxtConfig({\n  ssr: true,\n})';
    const { newSource } = appendModule(bare, '@nuxtjs/tailwindcss');
    expect(newSource).toContain('  modules: ["@nuxtjs/tailwindcss"],');
    expect(newSource).toContain('  ssr: true,');
    expect(newSource).toContain('\n})');
  });
});
