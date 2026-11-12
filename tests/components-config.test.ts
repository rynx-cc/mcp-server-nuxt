/**
 * Custom `components` directories and `.nuxt/components.d.ts` names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerComponentTools } from '../src/tools/components.js';
import { scanComponents } from '../src/utils/component-scan.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-components-config-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

const vue = '<template><div /></template>\n';

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('component directories', () => {
  it('scans the default components directory and names global components without the folder', async () => {
    const root = path.join(base, 'default');
    await write(path.join(root, 'components/base/BaseButton.vue'), vue);
    await write(path.join(root, 'components/global/Icon.vue'), vue);
    await write(path.join(root, 'lib/Skipped.vue'), vue);

    const scan = await scanComponents(root);
    expect(scan.warnings).toEqual([]);
    expect(scan.components.map((component) => component.name).sort()).toEqual(['BaseButton', 'Icon']);
    expect(scan.components.find((component) => component.name === 'Icon')).toMatchObject({ global: true });
  });

  it('honors dirs entries with a custom prefix, extensions, and global', async () => {
    const root = path.join(base, 'prefix');
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        '  components: {',
        '    dirs: [',
        "      { path: '~/components/special', prefix: 'Special', extensions: ['.vue', '.tsx'], global: true },",
        '    ],',
        '  },',
        '})',
        '',
      ].join('\n'),
    );
    await write(path.join(root, 'components/special/Button.vue'), vue);
    await write(path.join(root, 'components/special/Icon.tsx'), 'export default {}\n');
    await write(path.join(root, 'components/Other.vue'), vue);

    const scan = await scanComponents(root);
    expect(scan.warnings).toEqual([]);
    expect(scan.components.map((component) => component.name).sort()).toEqual(['SpecialButton', 'SpecialIcon']);
    expect(scan.components.find((component) => component.name === 'SpecialButton')).toMatchObject({
      global: true,
      file: 'components/special/Button.vue',
    });

    const ctx = new NuxtProjectContext(root);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerComponentTools(server, ctx);
    const listed = await callTool(server, 'list_components');
    expect((listed.components as Array<{ name: string }>).map((component) => component.name).sort()).toEqual([
      'SpecialButton',
      'SpecialIcon',
    ]);
    const inspected = await callTool(server, 'inspect_component', { name: 'SpecialButton' });
    expect(inspected.found).toBe(true);
    expect((inspected.component as { name: string }).name).toBe('SpecialButton');
  });

  it('honors pathPrefix: false on an array entry', async () => {
    const root = path.join(base, 'path-prefix');
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        '  components: [',
        "    { path: '~/widgets', pathPrefix: false },",
        '  ],',
        '})',
        '',
      ].join('\n'),
    );
    await write(path.join(root, 'widgets/base/Button.vue'), vue);
    await write(path.join(root, 'widgets/form/Input.vue'), vue);

    const scan = await scanComponents(root);
    expect(scan.warnings).toEqual([]);
    expect(scan.components.map((component) => component.name).sort()).toEqual(['Button', 'Input']);
  });

  it('resolves a ~/ alias against srcDir, including a Nuxt 4 app/ directory and a layer', async () => {
    const root = path.join(base, 'alias');
    const layer = path.join(base, 'layer');
    await write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'alias-app', dependencies: { nuxt: '^4.2.0' } }),
    );
    await write(
      path.join(root, 'nuxt.config.ts'),
      ["export default defineNuxtConfig({", "  components: ['~/ui'],", '})', ''].join('\n'),
    );
    await write(path.join(root, 'app/ui/Badge.vue'), vue);
    await write(path.join(root, 'ui/RootBadge.vue'), vue);
    await write(path.join(root, 'app/components/Ignored.vue'), vue);

    await write(
      path.join(layer, 'package.json'),
      JSON.stringify({ name: 'alias-layer', dependencies: { nuxt: '^3.16.0' } }),
    );
    await write(
      path.join(layer, 'nuxt.config.ts'),
      ["export default defineNuxtConfig({", "  components: ['~/ui'],", '})', ''].join('\n'),
    );
    await write(path.join(layer, 'ui/LayerBadge.vue'), vue);

    const scan = await scanComponents(root, [{ cwd: layer, name: 'alias-layer' }]);
    expect(scan.warnings).toEqual([]);
    expect(scan.components.map((component) => ({ name: component.name, layer: component.layer }))).toEqual([
      { name: 'Badge', layer: undefined },
      { name: 'LayerBadge', layer: 'alias-layer' },
    ]);
    expect(scan.components.find((component) => component.name === 'Badge')?.file).toBe('app/ui/Badge.vue');
  });

  it('skips entries that cannot be resolved and warns', async () => {
    const root = path.join(base, 'unresolved');
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        '  components: [',
        "    '~/components',",
        "    '#missing/widgets',",
        "    { path: '~/does-not-exist', prefix: 'Nope' },",
        '  ],',
        '})',
        '',
      ].join('\n'),
    );
    await write(path.join(root, 'components/Ok.vue'), vue);

    const scan = await scanComponents(root);
    expect(scan.components.map((component) => component.name)).toEqual(['Ok']);
    expect(scan.warnings.join('\n')).toContain('#missing/widgets');
    expect(scan.warnings.join('\n')).toContain('does-not-exist');
    expect(scan.components.some((component) => component.name.includes('Nope'))).toBe(false);
  });

  it('prefers .nuxt/components.d.ts and skips declarations that do not resolve', async () => {
    const root = path.join(base, 'dts');
    await write(path.join(root, 'lib/UiButton.vue'), vue);
    await write(path.join(root, 'components/Other.vue'), vue);
    await write(
      path.join(root, '.nuxt/components.d.ts'),
      [
        'export const UiButton: typeof import("../lib/UiButton.vue")[\'default\']',
        'export const LazyUiButton: LazyComponent<typeof import("../lib/UiButton.vue")[\'default\']>',
        'export const MissingWidget: typeof import("../missing/MissingWidget.vue")[\'default\']',
        '',
      ].join('\n'),
    );

    const scan = await scanComponents(root);
    expect(scan.components.map((component) => component.name)).toEqual(['UiButton']);
    expect(scan.components[0]?.file).toBe('lib/UiButton.vue');
    expect(scan.warnings.join('\n')).toContain('MissingWidget');
    expect(scan.components.some((component) => component.name === 'Other')).toBe(false);
  });
});
