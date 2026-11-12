# mcp-server-nuxt 0.3.0 — standalone MCP for Nuxt

Hi Nuxt folks — `mcp-server-nuxt@0.3.0` is on npm.

## What it is

A **standalone** Model Context Protocol server for Nuxt projects. It exposes routes, components, composables, layers, auto-imports, Nitro endpoints, modules, and config to AI agents (Claude, Cursor, VS Code) **without** requiring `nuxt dev` / DevTools.

Compared to DevTools-attached MCPs: those only see a live DevServer. This CLI works on a fresh clone, an unprepared app, or a monorepo subpackage — with graceful fallbacks when `.nuxt/` is missing.

## Quick try

```bash
npx -y mcp-server-nuxt@0.3.0 /absolute/path/to/your/nuxt/app
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["-y", "mcp-server-nuxt@0.3.0", "/absolute/path/to/your/nuxt/app"]
    }
  }
}
```

Then ask: “What routes does this project have?” — you should get the resolved route map (paths, files, params), not a guessed file tree.

## Highlights in 0.3.0

- **24 tools / 7 resources** (core MVP 15 / 5; see `docs/SPEC_MATRIX.md`)
- CLI: `--version`, `--help`, `--project`
- `generate_composable`, `analyze_project`
- Pagination on large list tools
- Structured errors (no stack leakage)
- Write sandbox + dry-run by default (`--allow-writes` / `MCP_NUXT_ALLOW_WRITES`)
- Fixtures for Nuxt 3, Nuxt 4 `app/`, layers, bare projects

## Links

- npm: https://www.npmjs.com/package/mcp-server-nuxt
- GitHub: https://github.com/rynx-cc/mcp-server-nuxt
- Changelog: https://github.com/rynx-cc/mcp-server-nuxt/blob/main/CHANGELOG.md

Feedback and issues welcome. Thanks!
