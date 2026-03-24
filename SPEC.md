# tsdoctor

> Working codename. TypeScript compiler introspection server — MCP tools + optional TUI for humans and AI agents.

## Problem

AI agents and terminal users have no access to TypeScript's type intelligence. They can read source and run `tsc --noEmit`, but they can't:

- See the resolved type of an expression (hover-equivalent)
- Get full type expansions when errors truncate with `...`
- Navigate semantically (go-to-definition through generics, re-exports, barrel files)
- Find all references (real references, not grep matches)
- Understand what TypeScript inferred for generic parameters or narrowed types
- Inspect module resolution, path alias resolution, or tsconfig behavior

This is especially painful in codebases that encode significant information in the type system (Effect-ts, fp-ts, Zod, tRPC, Prisma, etc.), but the tool itself is generic — it wraps the TypeScript compiler API and knows nothing about any specific library.

## Decisions

### Architecture: Headless server + optional TUI client

- A long-running daemon process owns the TypeScript language service and exposes MCP tools
- The TUI is a separate process that connects to the server
- Agents use the MCP tools directly — no TUI required
- Server crash doesn't kill the TUI, TUI crash doesn't kill the server

### Implementation stack: Effect-ts

- Effect for server lifecycle, service composition, resource management, MCP layer
- The TypeScript compiler interaction layer may be kept as thin/dependency-free as practical, but Effect is the primary framework

### tsconfig handling: Auto-discover

- On startup (or on first query), scan the project for `tsconfig.json` files
- Create a language service instance per tsconfig project
- Route queries to the correct language service based on which tsconfig owns the queried file
- Handle composite projects / project references

### Type output format: Both structured + flat

- Flat string (via `typeToString` with configurable flags/depth) for quick display and simple answers
- Structured JSON tree (recursive walk of the Type object) for agent traversal and TUI drill-down
- Both returned together; consumers pick what they need

### Language service lifecycle: Lazy-hot

- Don't eagerly create language services on startup
- On first query for a file, find its tsconfig, create the language service, keep it alive
- No active file watching — instead, check file modification times on query and invalidate if stale
- Keeps memory usage proportional to actually-queried projects
- Trade-off: first query for a new project has cold-start latency; subsequent queries are fast

### MVP scope: Incremental, architecture-first

Start with a single tool (`get_type_at_position`) and prove the full architecture works end-to-end:

1. tsconfig discovery
2. Language service creation and caching
3. Position translation (file:line:col → offset)
4. Type resolution and stringification
5. MCP tool registration and serving

Then expand to the full MVP tool set:

| Tool | Description |
|------|-------------|
| `get_type_at_position` | Resolved type of the expression at file:line:col |
| `get_diagnostics` | Semantic diagnostics with full type expansions (not truncated) |
| `get_definition` | Go-to-definition (through re-exports, generics, etc.) |
| `get_quickinfo` | Hover-equivalent: type + documentation + tags |
| `get_references` | Find all references to the symbol at a position |
| `expand_type` | Recursive full expansion of a type (configurable depth) |

### Scope boundaries: What this is NOT

- **Not an LSP server** — editors already have tsserver. This is for terminal/agent contexts.
- **Not a linter** — eslint/biome handle rule enforcement.
- **Not a formatter** — prettier/biome handle formatting.
- **Not a build tool** — tsc/esbuild/swc handle compilation.
- **Not Effect-specific** — no Effect imports, no library-specific heuristics.

## Design Details

### Position Input

All position-based tools accept `file` (absolute path) and either:
- `line` + `col` (1-based, human-friendly)
- `offset` (0-based byte offset, for programmatic use)

The server translates between them using the source file's line map.

### Type Stringification

The flat string output uses `checker.typeToString()` with `TypeFormatFlags`:
- `NoTruncation` — never truncate with `...`
- `WriteArrayAsGenericType` — show `Array<T>` not `T[]` for clarity
- `UseFullyQualifiedType` — avoid ambiguous short names
- Configurable via a `flags` parameter on relevant tools

The structured output recursively walks the `ts.Type` object and produces:
```json
{
  "kind": "union",
  "members": [
    { "kind": "object", "symbol": "User", "properties": [...] },
    { "kind": "literal", "value": "null" }
  ]
}
```

Expansion depth is configurable (default: 3 levels) to prevent blowup on recursive types.

### Diagnostic Enhancement

Standard `tsc` diagnostic output loses information. The enhanced diagnostics tool:
- Includes the full `messageText` chain (TS diagnostics are linked lists)
- Expands the "expected" and "actual" types in assignability errors fully (no truncation)
- Includes `relatedInformation` entries with their own positions
- Groups diagnostics by file, sortable by severity

### MCP Server

- Uses `@effect/ai/McpServer` for MCP protocol
- **HTTP/SSE transport** on a configurable port (default TBD)
- Both agents and TUI connect over HTTP — single transport, no stdio
- All tools annotated as readonly (no mutations)
- Tool parameters use `effect/Schema` for validation

### Project Scope: Per-file, no project root

- The server has **no concept of a project root**
- All tool calls accept **absolute file paths**
- The server discovers the relevant tsconfig by walking up from the queried file
- One server instance can serve files from multiple unrelated projects
- This means MCP client config is simple: just a URL, no per-project setup

### Files Without a tsconfig

When a queried file isn't covered by any discovered `tsconfig.json`:
- Create an inferred program with sensible defaults (`strict: true`, `target: esnext`, `module: esnext`, `noEmit: true`)
- The query works, but the response includes a `warning` field explaining that no tsconfig covers this file
- This handles loose scripts, playground files, and incomplete project setups

### Project Discovery

On query for a file:
1. Walk up from the file looking for `tsconfig.json`
2. If found, check for `references` (composite project) — discover referenced projects too
3. Cache the mapping: `file path → tsconfig path → language service instance`
4. On subsequent queries, look up the cache first

For monorepos with many tsconfigs:
- Only create language services for projects that are actually queried
- Evict idle language services after a configurable timeout (default: 5 minutes)

### Type Alias Handling

Structured type output expands aliases to a configurable depth:
- Default depth: 1 (show the alias's immediate shape, but nested aliases remain as references)
- `depth: 0` — don't expand, return `{ kind: "reference", name: "User" }`
- `depth: 3` — expand three levels deep
- The `expand_type` tool is the primary mechanism for deeper exploration
- This keeps default output readable while supporting deep dives

### Server Lifecycle

```
startup:
  - parse CLI args (port, log level)
  - start MCP HTTP server
  - wait for queries (no eager LS creation)

on query(file, position):
  - resolve file → tsconfig (walk up from file)
  - if no tsconfig found: create inferred program, attach warning
  - if no LS for this tsconfig: create one (cold start)
  - if LS exists: check if source files are stale, update if needed
  - execute query against LS
  - return result

shutdown:
  - dispose all language service instances
  - close MCP server
```

## Open Questions (to resolve during implementation)

- **Staleness detection**: Check mtime on every query? Or use a coarse timer to periodically scan? mtime check per-query is simple but adds I/O.
- **TUI protocol**: Does the TUI connect via MCP (reuses existing tools, simple) or a richer internal protocol (more interactive, streaming updates)?
- **Type tree schema**: Should structured type output mirror TS's internal type kinds (`ObjectType`, `UnionType`, etc.) or use a simplified/normalized set? Start with a small normalized set and expand as needed.
- **Error decomposition in diagnostics**: Should the tool attempt to decompose complex error messages (e.g., extract both sides of a type mismatch), or just return the full message chain? Start with the full chain, add decomposition if agents struggle with it.
