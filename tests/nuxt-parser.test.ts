import { describe, expect, it } from 'vitest';
import {
  componentAutoImportName,
  extractPageMeta,
  fileToRoutePath,
} from '../src/utils/nuxt-parser.js';

describe('fileToRoutePath', () => {
  it('maps static segments', () => {
    expect(fileToRoutePath('index.vue')).toEqual({ path: '/', params: [] });
    expect(fileToRoutePath('about.vue')).toEqual({ path: '/about', params: [] });
    expect(fileToRoutePath('users/index.vue')).toEqual({ path: '/users', params: [] });
  });

  it('maps dynamic segments', () => {
    expect(fileToRoutePath('users/[id].vue')).toEqual({
      path: '/users/:id',
      params: [{ name: 'id', optional: false, catchAll: false }],
    });
  });

  it('maps optional segments', () => {
    expect(fileToRoutePath('users/[[id]].vue')).toEqual({
      path: '/users/:id?',
      params: [{ name: 'id', optional: true, catchAll: false }],
    });
  });

  it('maps catch-all segments', () => {
    expect(fileToRoutePath('docs/[...slug].vue')).toEqual({
      path: '/docs/:slug(.*)*',
      params: [{ name: 'slug', optional: false, catchAll: true }],
    });
  });
});

describe('extractPageMeta', () => {
  it('extracts middleware and layout', () => {
    const content = "definePageMeta({ layout: 'dashboard', middleware: ['auth', 'analytics'] })";
    expect(extractPageMeta(content)).toMatchObject({
      middleware: ['auth', 'analytics'],
      layout: 'dashboard',
    });
  });

  it('handles a string middleware', () => {
    expect(extractPageMeta("definePageMeta({ middleware: 'auth' })").middleware).toEqual(['auth']);
  });

  it('returns empty defaults when no definePageMeta', () => {
    expect(extractPageMeta('<template><h1>Hi</h1></template>')).toEqual({
      meta: {},
      middleware: [],
      layout: undefined,
    });
  });
});

describe('componentAutoImportName', () => {
  it('pascal-cases nested component paths', () => {
    expect(componentAutoImportName('BaseButton.vue')).toBe('BaseButton');
    expect(componentAutoImportName('base/Card/BaseCard.vue')).toBe('BaseCardBaseCard');
    expect(componentAutoImportName('ui/form-input.vue')).toBe('UiFormInput');
  });
});
