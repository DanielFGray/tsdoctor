# tsdoctor

TypeScript compiler introspection server — MCP tools for humans and AI agents.

## Runtime

- **Bun** — use `bun` to run files, `bun test` for tests, `bun add` for packages
- `bun run typecheck` — type check with tsc + Effect Language Service

## Stack

- **Effect v4** (beta) — service composition, error handling, resource management
  - Services: `ServiceMap.Service`
  - Schema: `import { Schema } from "effect"`
  - MCP: `import { McpServer, Tool, Toolkit } from "effect/unstable/ai"`
- **@effect/platform-bun** — HTTP server (SSE transport)
- **TypeScript Compiler API** (`typescript`) — language service introspection
- Effect v4 source reference: `~/.local/share/effect-solutions/effect-smol`

## Project Structure

- `src/` — all source code
- `SPEC.md` — project specification and design decisions

## Running the MCP Server

Start: `PORT=39100 bun run src/main.ts`

Do NOT use `bun --hot` — hot reloading invalidates MCP sessions, causing "Mcp-Session-Id does not exist" crashes. This is an upstream issue in Effect's McpServer (it calls `Effect.die` on stale sessions instead of returning a structured error). Restart the server cleanly instead.

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
