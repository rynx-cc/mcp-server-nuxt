import { describe, expect, it } from 'vitest';
import { getNuxtDocs, listNuxtDocsTopics } from '../src/data/nuxt-docs.js';

describe('getNuxtDocs', () => {
  it('returns a doc for a known topic', () => {
    const doc = getNuxtDocs('routing');
    expect(doc).not.toBeNull();
    expect(doc!.title.length).toBeGreaterThan(0);
    expect(doc!.body).toContain('pages/');
  });

  it('is case-insensitive and matches titles', () => {
    expect(getNuxtDocs('ROUTING')!.topic).toBe('routing');
    expect(getNuxtDocs('Nitro Server Engine')!.topic).toBe('nitro');
  });

  it('returns null for unknown topics', () => {
    expect(getNuxtDocs('does-not-exist')).toBeNull();
  });

  it('lists all available topics', () => {
    const topics = listNuxtDocsTopics();
    expect(topics).toContain('routing');
    expect(topics).toContain('layers');
    expect(topics).toContain('nitro');
    expect(topics.length).toBeGreaterThanOrEqual(7);
  });
});
