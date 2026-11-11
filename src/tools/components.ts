/**
 * Component tools: list_components, inspect_component, generate_component.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { prepareWrite } from '../utils/write-path.js';

export function registerComponentTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_components',
    'List all Vue components with their auto-imported names, file paths, props, emits and slots. Use this to discover existing UI building blocks before writing new code.',
    {
      name: z.string().optional().describe('Optional substring filter on component name'),
      directory: z.string().optional().describe('Optional directory filter (e.g. components)'),
    },
    safe(async ({ name, directory }) => {
      const { components } = await ctx.snapshot();
      let filtered = components;
      if (name) filtered = filtered.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
      if (directory) filtered = filtered.filter((c) => c.directory === directory);
      return jsonResult({ count: filtered.length, total: components.length, components: filtered });
    }),
  );

  server.tool(
    'inspect_component',
    'Get detailed information about a single component by its auto-imported name (e.g. BaseButton): props types, slots, emits, and script setup details.',
    {
      name: z.string().describe('Auto-imported component name, e.g. BaseButton'),
    },
    safe(async ({ name }) => {
      const { components } = await ctx.snapshot();
      const component = components.find((c) => c.name === name);
      if (!component) {
        return jsonResult({
          found: false,
          name,
          suggestions: components
            .filter((c) => c.name.toLowerCase().includes(name.toLowerCase()))
            .slice(0, 10)
            .map((c) => c.name),
        });
      }
      return jsonResult({ found: true, component });
    }),
  );

  server.tool(
    'generate_component',
    'Generate a new Vue SFC under the project components directory (honoring srcDir) with typed defineProps/defineEmits and slots.',
    {
      name: z.string().describe('Component name, e.g. BaseButton or ui/BaseButton'),
      props: z.record(z.string(), z.string()).optional().describe('Prop name -> type, e.g. { "label": "string", "count": "number" }'),
      emits: z.array(z.string()).optional().describe('Event names to declare with defineEmits'),
      slots: z.array(z.string()).optional().describe('Slot names (default slot is always included)'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned file without writing'),
    },
    safe(async ({ name, props, emits, slots, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const dirs = await ctx.sourceDirs();
      const clean = name.replace(/\.vue$/i, '').replace(/\\/g, '/');
      const { file, exists: alreadyExists } = await prepareWrite(
        ctx.root,
        dirs.componentsDir,
        path.resolve(dirs.componentsDir, `${clean}.vue`),
      );
      const propsBlock =
        props && Object.keys(props).length > 0
          ? `\nconst props = defineProps<{\n${Object.entries(props)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n')}\n}>()`
          : '';
      const emitsBlock =
        emits && emits.length > 0
          ? `\nconst emit = defineEmits<{\n${emits.map((e) => `  ${e}: []`).join('\n')}\n}>()`
          : '';
      const slotNodes =
        slots && slots.length > 0 ? slots.map((s) => `    <slot name="${s}" />`).join('\n') : '    <slot />';
      const content = `<script setup lang="ts">${propsBlock}${emitsBlock}\n</script>\n\n<template>\n${slotNodes}\n</template>\n`;

      if (dryRun ?? true) return jsonResult({ written: false, dryRun: true, exists: alreadyExists, path: file, content });
      if (alreadyExists) {
        return jsonResult({ ok: false, written: false, exists: true, path: file, error: `Refusing to overwrite existing file: ${file}` });
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
      return jsonResult({ written: true, path: file });
    }),
  );
}
