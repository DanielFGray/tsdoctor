# tsdoctor

TypeScript compiler introspection for AI agents and humans. Wraps the TypeScript language service as an MCP server and CLI, giving you access to hover types, diagnostics, go-to-definition, refactors, and more — without an IDE.

## Why

AI agents and terminal users can read source and run `tsc`, but they can't:

- See the resolved type of an expression
- Get full (non-truncated) type error details
- Navigate semantically through generics, re-exports, and barrel files
- Find all references, rename symbols, or apply code fixes
- Discover what APIs a module provides

This is especially painful in type-heavy codebases (Effect, Zod, tRPC, Prisma), but tsdoctor is generic — it wraps the TypeScript compiler API and knows nothing about any specific library.

## Install

```sh
bun add -g tsdoctor
```

Requires [Bun](https://bun.sh).

## CLI

```sh
# Get the type at a position
tsdoctor type src/foo.ts:10:5

# Or resolve by symbol name
tsdoctor type src/foo.ts --symbol getUser

# Typecheck the whole project
tsdoctor typecheck src/foo.ts

# Get diagnostics for a file
tsdoctor diagnostics src/foo.ts

# Go to definition
tsdoctor definition src/foo.ts --symbol MyType

# Find all references
tsdoctor references src/foo.ts:10:5

# Explore a module's API
tsdoctor explore src/foo.ts effect
tsdoctor explore src/foo.ts effect Effect
tsdoctor explore src/foo.ts effect Schema.Struct

# Explain a type error in detail
tsdoctor explain src/foo.ts:10:5

# Rename a symbol across the project
tsdoctor rename src/foo.ts --symbol oldName --new-name newName --apply

# See all commands
tsdoctor --help
```

The CLI auto-starts a background daemon server on first use. Subsequent commands reuse it for fast responses.

### Output formats

- `--json` — raw JSON (for piping/scripting)
- `--toon` — TOON format (for LLM context)
- default — human-readable plain text

## MCP Server

Start the server directly:

```sh
PORT=39100 bun run tsdoctor/src/main.ts
```

Or add to your MCP client config:

```json
{
  "mcpServers": {
    "tsdoctor": {
      "command": "tsdoctor",
      "args": ["serve"],
      "env": { "PORT": "39100" }
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `get_type_at_position` | Resolved type at a position (with configurable expansion depth) |
| `get_quickinfo` | Hover-equivalent: type + documentation + tags |
| `get_diagnostics` | Type errors with full messages, snippets, and positions |
| `typecheck` | Project-wide pass/fail with per-file and per-error-code breakdowns |
| `expand_type` | Deep-expand a type alias (default depth 3) |
| `get_definition` | Go to definition (through re-exports, generics, etc.) |
| `get_references` | Find all references to a symbol |
| `get_completions` | Completions at a position |
| `get_signature_help` | Function parameter info at a call site |
| `explain_error` | Type mismatch explainer with structural diff |
| `rename_symbol` | Rename across the project (preview or apply) |
| `get_code_fixes` | Suggested fixes for diagnostics |
| `get_module_exports` | List all exports from a module |
| `explore_module` | Browse module APIs with type signatures |
| `get_file_outline` | Symbol tree for a file |
| `get_file_references` | Find all files that import a given file |
| `get_call_hierarchy` | Incoming/outgoing call hierarchy |
| `organize_imports` | Sort and clean up imports |
| `fix_all` | Apply a code fix across an entire file |
| `refactor` | List or apply refactors at a position |
| `invalidate` | Clear cached type information |

All position-based tools support `symbol` for name-based lookup instead of line/col.

## Features

- **No IDE required** — full language service access from the terminal or any MCP client
- **Symbol lookup** — resolve by name (`--symbol getUser`) instead of line:col positions
- **Plugin support** — loads TS language service plugins (e.g. `@effect/language-service`) from your tsconfig
- **File watching** — automatic invalidation when source files change
- **Auto-discovery** — finds the right tsconfig by walking up from the queried file
- **Multi-project** — one server handles files from multiple tsconfig projects
- **Non-truncated output** — full type expansions, never `...`

## Development

```sh
bun install
bun test
bun run typecheck
```

## License

MIT
