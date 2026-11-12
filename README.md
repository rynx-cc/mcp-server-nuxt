<div align="center">
<h1>mcp-server-nuxt</h1>

A production-ready Model Context Protocol server that gives LLMs Nuxt's resolved state.

[![npm version](https://img.shields.io/npm/v/mcp-server-nuxt?style=flat-square&color=00DC82&label=npm)](https://www.npmjs.com/package/mcp-server-nuxt)
[![npm downloads](https://img.shields.io/npm/dm/mcp-server-nuxt?style=flat-square&color=00DC82)](https://www.npmjs.com/package/mcp-server-nuxt)
[![license](https://img.shields.io/npm/l/mcp-server-nuxt?style=flat-square&color=gray)](./LICENSE)
[![CI](https://github.com/rynx-cc/mcp-server-nuxt/actions/workflows/ci.yml/badge.svg)](https://github.com/rynx-cc/mcp-server-nuxt/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/mcp-server-nuxt?style=flat-square&color=blue)](https://nodejs.org)

Generic LLMs get file-based routing, auto-imports, `extends` layers, and Nitro wrong more often than anything else in Nuxt.

</div>

---

## 30-second setup

**Cursor** — add `.cursor/mcp.json` in your Nuxt app (absolute path required):

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

**Claude Desktop** — edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`), same shape:

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

Restart the client, then ask:

> What routes does this project have?

Example reply (shape from `list_routes`):

```json
{
  "count": 4,
  "total": 4,
  "routes": [
    { "path": "/", "file": "app/pages/index.vue", "params": [] },
    { "path": "/about", "file": "app/pages/about.vue", "params": [] },
    { "path": "/users/:id", "file": "app/pages/users/[id].vue", "params": ["id"] },
    { "path": "/blog/:slug?", "file": "app/pages/blog/[...slug].vue", "params": ["slug"] }
  ]
}
```

Writes stay off until you pass `--allow-writes` or set `MCP_NUXT_ALLOW_WRITES=1`. Full client configs (VS Code, Windows `cmd` wrapper) are below.

---

## Why an MCP server for Nuxt?

A generic AI agent looking at a Nuxt repo sees a directory tree. It does not see:

- `pages/users/[id].vue` maps to `/users/:id`, or the `definePageMeta` middleware and layout contract.
- `components/base/BaseButton.vue` is available as `<BaseButton>` with no import statement.
- `composables/useFoo.ts` exports `useFoo()`, typed and callable anywhere.
- `extends: ['../ui-kit']` layers an override chain of components, pages, and config over the app.
- `server/api/hello.get.ts` registers `GET /api/hello` in the Nitro runtime.

Without that context the model guesses. It invents import paths, misnames auto-imported components, and misreads layer precedence. The gap is between the source tree and Nuxt's resolved runtime state.

`mcp-server-nuxt` exposes that resolved state through **24 tools** and **7 read-only resources** over MCP (core MVP: 15 tools / 5 resources — see [docs/SPEC_MATRIX.md](./docs/SPEC_MATRIX.md)). It reads Nuxt's own output (`loadNuxtConfig`, `.nuxt/`) rather than guessing from filenames alone.

### Design principles

| Principle | What it means in code |
| --- | --- |
| Deep Nuxt Kit integration | `loadNuxtConfig()` and `.nuxt/` build outputs first, with a source-level parser as fallback |
| Layer-aware | Resolves the `extends` graph and tags each route, component, and composable with its origin layer |
| Auto-imports registry | Serves the auto-imports index with source paths and TypeScript signatures from `.nuxt/imports.d.ts` |
| Write protection | Mutation tools default to `dry-run` and require `--allow-writes` |
| Strict TypeScript | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` |

### FAQ

**Q: How does that compare to the Nuxt DevTools MCP server?**

**A:** Standalone vs Runtime.

DevTools-style MCPs (for example `nuxt-mcp-dev`) attach to the Nuxt DevServer. The AI only sees live project context while that server is up. If the repo was just cloned, dependencies are missing, or nobody has run `npm run dev`, the agent is effectively blind.

`mcp-server-nuxt` is a standalone CLI (`npx mcp-server-nuxt /path`). It has no DevServer prerequisite. The agent can read the project's resolved fundamentals before the app is started.

**Q: What is it good for?**

**A:** Giving an agent Nuxt's resolved view of a project: route maps, layer precedence, auto-imports with types, Nitro endpoints, module status, and (optionally) dry-run scaffolding for pages, components, and server handlers — without requiring `npm run dev`.

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
node dist/index.js --project /absolute/path/to/your/nuxt/app
```

```bash
mcp-server-nuxt --help
mcp-server-nuxt --version
mcp-server-nuxt --project /absolute/path/to/app --allow-writes
```

Omit the path to use the current directory. Pass `--allow-writes`, or set `MCP_NUXT_ALLOW_WRITES=1`, to enable write tools. See [Write protection](#write-protection).

---

## Client configuration

Replace `/absolute/path/to/your/nuxt/app` with the real absolute path to the Nuxt project you want the agent to inspect.

Start **without** write access. Enable `MCP_NUXT_ALLOW_WRITES` only when you want mutation tools to leave dry-run mode.

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

### VS Code (GitHub Copilot MCP)

In `.vscode/mcp.json` (or user MCP settings):

```json
{
  "servers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["-y", "mcp-server-nuxt@latest", "--project", "/absolute/path/to/your/nuxt/app"]
    }
  }
}
```

### Claude Code

Add an MCP server in Claude Code settings (or project `.mcp.json`):

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

### Windsurf

In Windsurf MCP settings (Cascade → MCP), add:

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

---

## Core architecture and resources

The server exposes read-only resources (`resources/*`) for large, cacheable datasets, and tools (`tools/call`) for targeted queries and mutations. Resources carry the bulk context so the agent does not re-scan files each turn.

```
                      ┌─────────────────────────────────────────┐
                      │           mcp-server-nuxt               │
                      │                                         │
  MCP client ───────► │  ┌──────────────┐   ┌───────────────┐   │
  (Claude / Cursor)   │  │  24 Tools    │   │  7 Resources  │   │
                      │  └──────┬───────┘   └───────┬───────┘   │
                      │         │                   │           │
                      │         ▼                   ▼           │
                      │  NuxtProjectContext (cached snapshot)   │
                      └─────────┬───────────────────┬───────────┘
                                │                   │
                    @nuxt/kit loadNuxtConfig    .nuxt/imports.d.ts
                    extends resolution         .nuxt/tsconfig.json
```

### Resources

| URI | Content |
| --- | --- |
| `nuxt://project/overview` | Project summary: Nuxt version, layers, directories, and route/component/composable/module counts |
| `nuxt://project/routes` | Resolved route map: files, params, middleware, layouts, children |
| `nuxt://project/config` | Resolved `nuxt.config` object via `loadNuxtConfig`, with a source-level fallback |
| `nuxt://project/modules` | Installed modules with status, source, and configuration |
| `nuxt://project/layers` | `extends` hierarchy with override priority order and per-layer config |
| `nuxt://project/auto-imports` | Parsed registry of auto-imported symbols with source paths and TypeScript signatures |
| `nuxt://project/types` | Raw generated types (`.nuxt/imports.d.ts`, `.nuxt/types`, schema) |

### Layers and auto-imports

`nuxt://project/layers` resolves the `extends` graph and orders it by precedence (`project > later extends > earlier extends`), so the agent knows which `BaseButton.vue` wins when several layers define one.

`nuxt://project/auto-imports` reads `.nuxt/imports.d.ts` and returns the registry of auto-imported symbols (`ref`, `useFoo`, `BaseButton`) with their file origins and type signatures.

`nuxt://project/auto-imports` needs the app to have been prepared or built (`nuxi prepare` or `nuxi build`) so `.nuxt/imports.d.ts` exists. Other tools still work from source-level parsing when `.nuxt/` is missing.

---

## Tools reference

Aligned with `0.3.0` (24 tools). Full mapping: [docs/SPEC_MATRIX.md](./docs/SPEC_MATRIX.md).

### Project and core

| Tool | Description |
| --- | --- |
| `get_project_overview` | Summary: Nuxt version, layers, module/route/component counts, directories |
| `analyze_project` | Health analysis with dependency warnings, pagination, and prepare hints |
| `read_config` | Read the resolved `nuxt.config`, with dot-notation key filtering |
| `update_config` | Update a config value, keep comments and formatting, return a diff |
| `list_modules` | Active and inactive Nuxt modules with version, source, and config |
| `add_nuxt_module` | Add a module to the `modules` array, with optional options |
| `inspect_layers` | Resolve and return the full `extends` hierarchy |

### Routing and architecture

| Tool | Description |
| --- | --- |
| `list_routes` | File-based, dynamic, optional, catch-all, and nested routes |
| `get_route` | One route by path, e.g. `/users/:id` |
| `add_route` | Scaffold a page under `pages/` following Nuxt conventions |
| `inspect_route_meta` | `definePageMeta`, layout, middleware, and props/emits/slots for a page |
| `list_server_routes` | Nitro endpoints, middleware, and plugins with method and middleware chain |
| `scaffold_nitro_api` | Generate an H3 handler with optional Zod body validation |

### Components, composables, and auto-imports

| Tool | Description |
| --- | --- |
| `list_components` | All components, including those injected by layers and modules |
| `inspect_component` | Props types, emits, slots, and `<script setup>` details |
| `generate_component` | Generate a typed Vue SFC |
| `list_composables` | User-defined and auto-imported composables |
| `generate_composable` | Scaffold a typed `useXxx` composable under `composables/` |
| `get_auto_imports` | The `.nuxt/imports.d.ts` registry with source paths and signatures |
| `get_type_info` | Raw generated type info (`.nuxt/types`, schema) |

### Quality and diagnostics

| Tool | Description |
| --- | --- |
| `check_type_errors` | Run `tsc --noEmit` against `.nuxt/tsconfig.json` |
| `analyze_bundle_deps` | Classify Nuxt modules vs runtime/dev deps, flag missing or misplaced ones |
| `search_code` | Search the codebase with line numbers and context lines |
| `get_nuxt_docs` | Offline Nuxt guidance for routing, nitro, modules, layers |

---

## Write protection

`update_config`, `add_route`, `add_nuxt_module`, `scaffold_nitro_api`, and `generate_component` all follow the same contract:

1. `dryRun` is `true` by default. The tool returns the planned file or a diff without writing to disk.
2. A real write needs `dryRun: false` and a server started with writes enabled:

```bash
# CLI flag (path first, then flag)
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

3. Config edits touch only the affected lines. Comments and unrelated keys stay, and every change returns a diff you can review.

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
