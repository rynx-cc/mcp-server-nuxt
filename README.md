<div align="center"> 
<h1>mcp-server-nuxt</h1>

A production-ready Model Context Protocol server that gives LLMs a structured view of a Nuxt project.

[![npm version](https://img.shields.io/npm/v/mcp-server-nuxt?style=flat-square&color=00DC82&label=npm)](https://www.npmjs.com/package/mcp-server-nuxt)
[![license](https://img.shields.io/npm/l/mcp-server-nuxt?style=flat-square&color=gray)](./LICENSE)
[![node](https://img.shields.io/node/v/mcp-server-nuxt?style=flat-square&color=blue)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)

Generic LLMs get file-based routing, auto-imports, `extends` layers, and Nitro wrong more often than anything else in Nuxt.

</div>

---

## Why an MCP server for Nuxt?

A generic AI agent looking at a Nuxt repo sees a directory tree. It does not see:

- `pages/users/[id].vue` maps to `/users/:id`, or the `definePageMeta` middleware and layout contract.
- `components/base/BaseButton.vue` is available as `<BaseButton>` with no import statement.
- `composables/useFoo.ts` exports `useFoo()`, typed and callable anywhere.
- `extends: ['../ui-kit']` layers an override chain of components, pages, and config over the app.
- `server/api/hello.get.ts` registers `GET /api/hello` in the Nitro runtime.

Without that context the model guesses. It invents import paths, misnames auto-imported components, and misreads layer precedence. The gap is between the source tree and Nuxt's resolved runtime state.

`mcp-server-nuxt` exposes that picture through **22 tools** and **7 read-only resources** over MCP. What it reads depends on the tool:

- **Config** calls `@nuxt/kit`'s `loadNuxtConfig` when that optional dependency loads, and otherwise parses `nuxt.config` from source.
- **Auto-imports** read `.nuxt/imports.d.ts`, then `.nuxt/types/imports.d.ts`. **Generated types** return the raw `.nuxt/imports.d.ts` text, the `.nuxt/types/**/*.d.ts` file list, and `.nuxt/schema/nuxt.schema.json` when those files exist. **`check_type_errors`** runs `tsc --noEmit` against `.nuxt/tsconfig.json`, then the project `tsconfig.json`.
- **`list_routes`, `list_components`, `list_composables`, and `list_server_routes`** scan source by convention under the resolved `srcDir` (`pages/`, `components/`, `composables/`, `utils/`) and `serverDir` (`server/{api,routes,middleware,plugins}`). An explicit `srcDir` and Nuxt 4's `app/` directory are included. Pages, components, composables, and server routes also scan `extends` layers. None of these read Nuxt's resolved route table or `.nuxt/components.d.ts`.

### Design principles

| Principle | What it means in code |
| --- | --- |
| Config via Nuxt Kit | `read_config` calls `loadNuxtConfig()` when `@nuxt/kit` loads, and parses `nuxt.config` from source when it does not |
| Layer-aware scans | Resolves the `extends` graph and tags each scanned page route, component, composable, and server route with its origin layer |
| Auto-imports registry | Parses `.nuxt/imports.d.ts`, then `.nuxt/types/imports.d.ts`. Does not read `.nuxt/components.d.ts` |
| Write protection | Mutation tools default to `dryRun: true`. A real write also needs writes enabled (`--allow-writes` or `MCP_NUXT_ALLOW_WRITES=1`) and `dryRun: false` |
| Strict TypeScript | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` |

### FAQ

**Q: How does that compare to the Nuxt DevTools MCP server?**

**A:** Standalone vs Runtime.

DevTools-style MCPs (for example `nuxt-mcp-dev`) attach to the Nuxt DevServer. The AI only sees live project context while that server is up. If the repo was just cloned, dependencies are missing, or nobody has run `npm run dev`, the agent is effectively blind.

`mcp-server-nuxt` is a standalone CLI (`npx mcp-server-nuxt /path`). It has no DevServer prerequisite. The agent can inspect the project from source, and from `.nuxt/` when that output exists, before the app is started.

**Q: What is it good for?**

**A:** Giving an agent a structured view of a Nuxt project: convention-scanned route and Nitro maps, `extends` layer precedence, auto-imports and types when `.nuxt/` exists, module status, and (optionally) dry-run scaffolding for pages, components, and server handlers — without requiring `npm run dev`.

---

## Quick start

Prerequisites: Node.js 18 or newer. Works with npm, pnpm, or bun.

```bash
# one-shot (no install)
npx -y mcp-server-nuxt@latest /absolute/path/to/your/nuxt/app
pnpm dlx mcp-server-nuxt@latest /absolute/path/to/your/nuxt/app
bunx mcp-server-nuxt@latest /absolute/path/to/your/nuxt/app

# or install globally
npm install -g mcp-server-nuxt
# pnpm add -g mcp-server-nuxt
# bun add -g mcp-server-nuxt
mcp-server-nuxt /absolute/path/to/your/nuxt/app
```

The server speaks MCP over `stdio`; it is not a web service. MCP clients should pass an **absolute** project path (their working directory is often undefined).

To run from a local checkout:

```bash
git clone https://github.com/rynx-cc/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run build
node dist/index.js /absolute/path/to/your/nuxt/app
```

The project path is optional and may appear before or after flags. When it is omitted, the current working directory is used:

```bash
mcp-server-nuxt /absolute/path/to/your/nuxt/app --allow-writes
mcp-server-nuxt --allow-writes /absolute/path/to/your/nuxt/app
```

`--allow-writes` and `MCP_NUXT_ALLOW_WRITES=1` only authorize real writes. Mutation tools still default to `dryRun: true` until the caller passes `dryRun: false`. See [Write protection](#write-protection).

---

## Nuxt compatibility

`@nuxt/kit` is an optional dependency pinned to `^3.14.0` (`>=3.14.0 <4.0.0`). Config reads use that package's `loadNuxtConfig` when it loads. Kit 4 is outside the range, so a Nuxt 4 app falls back to the source parser when Kit 3 cannot load the config.

Scans honor an explicit `srcDir` and `serverDir`, and Nuxt 4's default `app/` directory (including Nuxt 3 with `future.compatibilityVersion: 4`). A Nuxt 3 app keeps the root layout unless that option or `srcDir` says otherwise. An `app/` directory that only contains `router.options.ts` or `spa-loading-template.html` does not become `srcDir` while the root still has `pages/`, `app.vue`, or the other v3 directories. Custom `components.dirs` are still not scanned.

---

## Client configuration

Replace `/absolute/path/to/your/nuxt/app` with the real absolute path to the Nuxt project you want the agent to inspect.

Start **without** write access. `MCP_NUXT_ALLOW_WRITES=1` only authorizes real writes. Mutation tools still default to `dryRun: true` until the caller passes `dryRun: false`. See [Write protection](#write-protection).

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["-y", "mcp-server-nuxt@latest", "/absolute/path/to/your/nuxt/app"]
    }
  }
}
```

Optional writes:

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["-y", "mcp-server-nuxt@latest", "/absolute/path/to/your/nuxt/app"],
      "env": {
        "MCP_NUXT_ALLOW_WRITES": "1"
      }
    }
  }
}
```

### Claude Desktop

Config file locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop expects **strict JSON** (no comments).

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["-y", "mcp-server-nuxt@latest", "/absolute/path/to/your/nuxt/app"]
    }
  }
}
```

On Windows, if `npx` fails with `spawn npx ENOENT`, wrap it:

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "mcp-server-nuxt@latest",
        "C:/absolute/path/to/your/nuxt/app"
      ]
    }
  }
}
```

Restart Claude Desktop after saving. Prefer forward slashes in Windows paths inside JSON.

---

## Core architecture and resources

The server exposes read-only resources (`resources/*`) for large, cacheable datasets, and tools (`tools/call`) for targeted queries and mutations. Resources carry the bulk context so the agent does not re-scan files each turn.

```
                      ┌─────────────────────────────────────────┐
                      │           mcp-server-nuxt               │
                      │                                         │
  MCP client ───────► │  ┌──────────────┐   ┌───────────────┐   │
  (Claude / Cursor)   │  │  22 Tools    │   │  7 Resources  │   │
                      │  └──────┬───────┘   └───────┬───────┘   │
                      │         │                   │           │
                      │         ▼                   ▼           │
                      │  NuxtProjectContext (cached snapshot)   │
                      └─────────┬───────────────────┬───────────┘
                                │                   │
                    @nuxt/kit loadNuxtConfig    .nuxt/imports.d.ts
                    extends resolution         .nuxt/tsconfig.json
```

Config, auto-imports, generated types, and `tsc` use `@nuxt/kit` and `.nuxt/` as shown. Route, component, composable, and server listings are separate globs of source files.

### Resources

| URI | Content |
| --- | --- |
| `nuxt://project/overview` | Project summary: Nuxt version, layers, directories, and route/component/composable/module counts |
| `nuxt://project/routes` | Page routes from the resolved pages directory in the project and `extends` layers: file, params, `definePageMeta` middleware and layout, children |
| `nuxt://project/config` | Resolved `nuxt.config` object via `loadNuxtConfig`, with a source-level fallback |
| `nuxt://project/modules` | Installed modules with status, source, and configuration |
| `nuxt://project/layers` | `extends` hierarchy with override priority order and per-layer config |
| `nuxt://project/auto-imports` | Symbols parsed from `.nuxt/imports.d.ts` or `.nuxt/types/imports.d.ts` (not `.nuxt/components.d.ts`) |
| `nuxt://project/types` | Raw generated types (`.nuxt/imports.d.ts`, `.nuxt/types`, schema) |

### Layers and auto-imports

`nuxt://project/layers` resolves the `extends` graph and orders it by precedence (`project > later extends > earlier extends`). Relative paths and installed npm packages are resolved; missing entries are omitted. Page, component, composable, and server scans tag each file with its origin layer. They keep every match, so two layers that both define `components/BaseButton.vue` both appear.

`nuxt://project/auto-imports` reads `.nuxt/imports.d.ts`, then `.nuxt/types/imports.d.ts` if the first file is missing. It returns symbols declared there, such as `ref`, `computed`, and `useFoo`, with their file origins and type signatures. It does not read `.nuxt/components.d.ts`, which is where component auto-imports usually live, so a component such as `BaseButton` is included only when that same symbol is also declared in `imports.d.ts`.

`nuxt://project/auto-imports` needs the app to have been prepared or built (`nuxi prepare` or `nuxi build`) so one of those `imports.d.ts` files exists. Other tools still work from source-level parsing when `.nuxt/` is missing.

---

## Tools reference

Aligned with the published `0.2.0` surface (22 tools).

### Project and core

| Tool | Description |
| --- | --- |
| `get_project_overview` | Summary: Nuxt version, layers, module/route/component counts, directories |
| `read_config` | Read the resolved `nuxt.config`, with dot-notation key filtering |
| `update_config` | Update a config value, keep comments and formatting, return a diff |
| `list_modules` | Active and inactive Nuxt modules with version, source, and config |
| `add_nuxt_module` | Add a module to the `modules` array, with optional options |
| `inspect_layers` | Resolve and return the full `extends` hierarchy |

### Routing and architecture

| Tool | Description |
| --- | --- |
| `list_routes` | File-based routes from the resolved pages directory in the project and `extends` layers, including dynamic, optional, catch-all, route groups, and nested routes |
| `get_route` | One route by path, e.g. `/users/:id` |
| `add_route` | Scaffold a page under the resolved pages directory (`pages/` or `app/pages/`) |
| `inspect_route_meta` | `definePageMeta`, layout, middleware, and props/emits/slots for a page |
| `list_server_routes` | `server/api`, `server/routes`, `server/middleware`, and `server/plugins` in the app and in `extends` layers (honoring `serverDir`). `type: "api"` includes both API and `server/routes` handlers. Every API and route entry gets the same list of that layer's `server/middleware/*` filenames, not a per-handler chain |
| `scaffold_nitro_api` | Generate an H3 handler with optional Zod body validation |

### Components, composables, and auto-imports

| Tool | Description |
| --- | --- |
| `list_components` | `components/**/*.vue` under the resolved `srcDir` in the project and `extends` layers. Names follow Nuxt's prefix rule (`base/BaseButton.vue` → `BaseButton`). Skips `.nuxt/components.d.ts`, module-injected components (such as Nuxt UI), and custom `components.dirs` |
| `inspect_component` | Props types, emits, slots, and `<script setup>` details |
| `generate_component` | Generate a typed Vue SFC |
| `list_composables` | Named exports under `composables/` and `utils/` in the resolved `srcDir`, including `extends` layers. Named exports are marked auto-imported; this does not read the `.nuxt` registry |
| `get_auto_imports` | Symbols from `.nuxt/imports.d.ts` or `.nuxt/types/imports.d.ts`, with source paths and signatures. Does not read `.nuxt/components.d.ts` |
| `get_type_info` | Raw generated type info (`.nuxt/types`, schema) |

### Quality and diagnostics

| Tool | Description |
| --- | --- |
| `check_type_errors` | Run `vue-tsc` (or `tsc`) `--noEmit` against `.nuxt/tsconfig.json`, falling back to the project `tsconfig.json`. Solution-style configs are expanded to their project references. If neither binary is installed, or no tsconfig exists, returns `{ ran: false, diagnostics: [], reason }` — check `ran` before treating an empty `diagnostics` array as a clean result |
| `analyze_bundle_deps` | Classify Nuxt modules vs runtime/dev deps, flag missing or misplaced ones |
| `search_code` | Search the codebase with line numbers and context lines |
| `get_nuxt_docs` | Offline Nuxt guidance for routing, nitro, modules, layers |

---

## Write protection

`update_config`, `add_route`, `add_nuxt_module`, `scaffold_nitro_api`, and `generate_component` all follow the same contract:

1. `dryRun` is `true` by default. The tool returns the planned file or a diff without writing to disk.
2. A real write needs `dryRun: false` and a server started with writes enabled:

```bash
# CLI flag, before or after the path
mcp-server-nuxt /absolute/path/to/app --allow-writes

# or environment variable
MCP_NUXT_ALLOW_WRITES=1 mcp-server-nuxt /absolute/path/to/app
```

```json
{
  "env": {
    "MCP_NUXT_ALLOW_WRITES": "1"
  }
}
```

3. Scaffolded files stay inside the project (`pages`, `components`, or `server/api` after `srcDir` / `serverDir` resolution). Paths that escape that directory are rejected, and an existing file is not overwritten.
4. Config edits touch only the affected lines. Comments and unrelated keys stay, and every change returns a diff you can review.

Dry-run first, check the diff, then enable writes.

---

## Contributing

Pull requests are welcome.

```bash
git clone https://github.com/rynx-cc/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # tsup
```

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`).
- Add tests for new tools and resources under `tests/`.
- Keep `@nuxt/kit` an optional dependency; each integration needs a fallback.
- Write tools default to `dry-run` and go through `WriteGuard`.

## License

[MIT](./LICENSE) © 2026 mcp-server-nuxt contributors.
