import { Argument, Command, Flag } from "effect/unstable/cli"
import { BunServices, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option } from "effect"
import { McpClient } from "./mcp-client.ts"
import { runCommand } from "./commands.ts"
import { ensureServer } from "./daemon.ts"
import { formatPlain } from "./format.ts"
import { toToon } from "./toon.ts"

const DEFAULT_PORT = 39100
const DEFAULT_URL = (port: number) => `http://localhost:${port}/mcp`

export type OutputFormat = "plain" | "json" | "toon"

// ---------------------------------------------------------------------------
// Shared flags
// ---------------------------------------------------------------------------

const port = Flag.integer("port").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("MCP server port"),
  Flag.withDefault(DEFAULT_PORT),
)

const json = Flag.boolean("json").pipe(
  Flag.withDescription("Output raw JSON"),
)

const toon = Flag.boolean("toon").pipe(
  Flag.withDescription("Output in TOON format"),
)

const depth = Flag.integer("depth").pipe(
  Flag.withAlias("d"),
  Flag.withDescription("Type expansion depth"),
  Flag.optional,
)

const detailed = Flag.boolean("detailed").pipe(
  Flag.withDescription("Include detailed diagnostic objects"),
)

const symbolFlag = Flag.string("symbol").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Resolve position by symbol name (e.g. 'getUser' or 'MyClass.method')"),
  Flag.optional,
)

const formatFlags = { json, toon }

const resolveFormat = (flags: { json: boolean; toon: boolean }): OutputFormat =>
  flags.json ? "json" : flags.toon ? "toon" : "plain"

// ---------------------------------------------------------------------------
// Position argument — file:line:col or file line col
// ---------------------------------------------------------------------------

const position = Argument.string("position").pipe(
  Argument.withDescription("file:line:col or file path"),
)

const lineArg = Argument.integer("line").pipe(
  Argument.withDescription("Line number"),
  Argument.optional,
)

const colArg = Argument.integer("col").pipe(
  Argument.withDescription("Column number"),
  Argument.optional,
)

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const typeCmd = Command.make(
  "type",
  { position, line: lineArg, col: colArg, port, depth, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, depth, symbol, json, toon }) =>
    run(port, "type", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      depth: Option.getOrUndefined(depth),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get the TypeScript type at a position"))

const quickinfoCmd = Command.make(
  "quickinfo",
  { position, line: lineArg, col: colArg, port, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, symbol, json, toon }) =>
    run(port, "quickinfo", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get hover-equivalent info at a position"))

const diagnosticsCmd = Command.make(
  "diagnostics",
  { position, port, detailed, ...formatFlags },
  ({ position, port, detailed, json, toon }) =>
    run(port, "diagnostics", position, {
      detailed,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get diagnostics for a file"))

const typecheckCmd = Command.make(
  "typecheck",
  {
    position, port,
    limit: Flag.integer("limit").pipe(
      Flag.withAlias("l"),
      Flag.withDescription("Max diagnostic lines in summary"),
      Flag.optional,
    ),
    ...formatFlags,
  },
  ({ position, port, limit, json, toon }) =>
    run(port, "typecheck", position, {
      limit: Option.getOrUndefined(limit),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Typecheck a file and its dependencies"))

const expandCmd = Command.make(
  "expand",
  { position, line: lineArg, col: colArg, port, depth, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, depth, symbol, json, toon }) =>
    run(port, "expand", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      depth: Option.getOrUndefined(depth),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Expand a type alias to its full definition"))

const definitionCmd = Command.make(
  "definition",
  { position, line: lineArg, col: colArg, port, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, symbol, json, toon }) =>
    run(port, "definition", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Go to definition"))

const referencesCmd = Command.make(
  "references",
  { position, line: lineArg, col: colArg, port, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, symbol, json, toon }) =>
    run(port, "references", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Find all references"))

const outlineCmd = Command.make(
  "outline",
  { position, port, ...formatFlags },
  ({ position, port, json, toon }) =>
    run(port, "outline", position, { format: resolveFormat({ json, toon }) }),
).pipe(Command.withDescription("Get file outline/symbol list"))

const explainCmd = Command.make(
  "explain",
  { position, line: lineArg, col: colArg, port, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, symbol, json, toon }) =>
    run(port, "explain", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Explain a type error with full mismatch details"))

const completionsCmd = Command.make(
  "completions",
  {
    position, line: lineArg, col: colArg, port,
    symbol: symbolFlag,
    prefix: Flag.string("prefix").pipe(Flag.withDescription("Filter completions by prefix"), Flag.optional),
    limit: Flag.integer("limit").pipe(Flag.withAlias("l"), Flag.withDescription("Max completions to return"), Flag.optional),
    ...formatFlags,
  },
  ({ position, line, col, port, symbol, prefix, limit, json, toon }) =>
    run(port, "completions", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      prefix: Option.getOrUndefined(prefix),
      limit: Option.getOrUndefined(limit),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get completions at a position"))

const signatureCmd = Command.make(
  "signature",
  { position, line: lineArg, col: colArg, port, symbol: symbolFlag, ...formatFlags },
  ({ position, line, col, port, symbol, json, toon }) =>
    run(port, "signature", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get function signature help at a position"))

const renameCmd = Command.make(
  "rename",
  {
    position, line: lineArg, col: colArg, port,
    symbol: symbolFlag,
    newName: Flag.string("new-name").pipe(Flag.withAlias("n"), Flag.withDescription("New name for the symbol")),
    apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply changes to disk")),
    ...formatFlags,
  },
  ({ position, line, col, port, symbol, newName, apply, json, toon }) =>
    run(port, "rename", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      newName,
      apply,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Rename a symbol across the project"))

const exportsCmd = Command.make(
  "exports",
  {
    position: Argument.string("file").pipe(Argument.withDescription("Context file for module resolution")),
    moduleSpecifier: Argument.string("module").pipe(Argument.withDescription("Module specifier (e.g. 'effect', './foo')")),
    port,
    ...formatFlags,
  },
  ({ position, moduleSpecifier, port, json, toon }) =>
    run(port, "exports", position, {
      moduleSpecifier,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("List exports from a module"))

const fileReferencesCmd = Command.make(
  "file-references",
  { position, port, ...formatFlags },
  ({ position, port, json, toon }) =>
    run(port, "file-references", position, { format: resolveFormat({ json, toon }) }),
).pipe(Command.withDescription("Find all files that import a given file"))

const callHierarchyCmd = Command.make(
  "call-hierarchy",
  {
    position, line: lineArg, col: colArg, port,
    symbol: symbolFlag,
    direction: Flag.string("direction").pipe(
      Flag.withDescription("Call direction: incoming, outgoing"),
      Flag.withDefault("incoming"),
    ),
    ...formatFlags,
  },
  ({ position, line, col, port, symbol, direction, json, toon }) =>
    run(port, "call-hierarchy", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      direction: direction as "incoming" | "outgoing",
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get incoming or outgoing call hierarchy"))

const codeFixesCmd = Command.make(
  "code-fixes",
  {
    position, line: lineArg, col: colArg, port,
    symbol: symbolFlag,
    errorCodes: Flag.string("error-codes").pipe(Flag.withAlias("e"), Flag.withDescription("Comma-separated error codes")),
    apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply the first fix to disk")),
    ...formatFlags,
  },
  ({ position, line, col, port, symbol, errorCodes, apply, json, toon }) =>
    run(port, "code-fixes", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      errorCodes: errorCodes.split(",").map(Number),
      apply,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Get suggested code fixes for diagnostics"))

const organizeImportsCmd = Command.make(
  "organize-imports",
  {
    position, port,
    apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply changes to disk")),
    ...formatFlags,
  },
  ({ position, port, apply, json, toon }) =>
    run(port, "organize-imports", position, {
      apply,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Organize imports in a file"))

const fixAllCmd = Command.make(
  "fix-all",
  {
    position, port,
    fixId: Flag.string("fix-id").pipe(Flag.withAlias("f"), Flag.withDescription("Fix ID from get_code_fixes")),
    apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply changes to disk")),
    ...formatFlags,
  },
  ({ position, port, fixId, apply, json, toon }) =>
    run(port, "fix-all", position, {
      fixId,
      apply,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Apply a code fix across an entire file"))

const refactorCmd = Command.make(
  "refactor",
  {
    position, line: lineArg, col: colArg, port,
    symbol: symbolFlag,
    refactorName: Flag.string("refactor-name").pipe(Flag.withAlias("r"), Flag.withDescription("Refactor name"), Flag.optional),
    actionName: Flag.string("action-name").pipe(Flag.withAlias("a"), Flag.withDescription("Action name"), Flag.optional),
    apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply changes to disk")),
    ...formatFlags,
  },
  ({ position, line, col, port, symbol, refactorName, actionName, apply, json, toon }) =>
    run(port, "refactor", mergePos(position, line, col), {
      symbol: Option.getOrUndefined(symbol),
      refactorName: Option.getOrUndefined(refactorName),
      actionName: Option.getOrUndefined(actionName),
      apply,
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("List or apply refactors at a position"))

const exploreCmd = Command.make(
  "explore",
  {
    position: Argument.string("file").pipe(Argument.withDescription("Context file for module resolution")),
    moduleSpecifier: Argument.string("module").pipe(Argument.withDescription("Module specifier (e.g. 'effect', './foo')")),
    member: Argument.string("member").pipe(
      Argument.withDescription("Member path (e.g. 'Effect', 'Schema.Struct')"),
      Argument.optional,
    ),
    port,
    ...formatFlags,
  },
  ({ position, moduleSpecifier, member, port, json, toon }) =>
    run(port, "explore", position, {
      moduleSpecifier,
      member: Option.getOrUndefined(member),
      format: resolveFormat({ json, toon }),
    }),
).pipe(Command.withDescription("Discover module APIs and type signatures"))

const invalidateCmd = Command.make(
  "invalidate",
  { position: Argument.string("file").pipe(Argument.withDefault("")), port },
  ({ position, port }) => run(port, "invalidate", position),
).pipe(Command.withDescription("Invalidate cached type information"))

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const app = Command.make("tsdoctor", {}).pipe(
  Command.withDescription("TypeScript compiler introspection CLI"),
  Command.withSubcommands([
    typeCmd,
    quickinfoCmd,
    diagnosticsCmd,
    typecheckCmd,
    expandCmd,
    definitionCmd,
    referencesCmd,
    outlineCmd,
    explainCmd,
    completionsCmd,
    signatureCmd,
    renameCmd,
    exportsCmd,
    fileReferencesCmd,
    callHierarchyCmd,
    codeFixesCmd,
    organizeImportsCmd,
    fixAllCmd,
    refactorCmd,
    exploreCmd,
    invalidateCmd,
  ]),
)

// ---------------------------------------------------------------------------
// Position merging — supports both file:line:col and file line col
// ---------------------------------------------------------------------------

const mergePos = (
  position: string,
  line: Option.Option<number>,
  col: Option.Option<number>,
): string => {
  // If position already has :line:col, use as-is
  if (position.match(/:\d+(?::\d+)?$/)) return position
  // Otherwise append line/col from separate args
  if (Option.isSome(line)) {
    return Option.isSome(col)
      ? `${position}:${line.value}:${col.value}`
      : `${position}:${line.value}`
  }
  return position
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const formatOutput = (command: string, raw: string, format: OutputFormat): string => {
  switch (format) {
    case "json":
      return raw
    case "toon": {
      try {
        return toToon(JSON.parse(raw))
      } catch {
        return raw
      }
    }
    case "plain":
      return formatPlain(command, raw)
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const run = (
  port: number,
  command: string,
  position: string,
  opts?: {
    symbol?: string | undefined
    depth?: number | undefined
    detailed?: boolean | undefined
    format?: OutputFormat | undefined
    moduleSpecifier?: string | undefined
    newName?: string | undefined
    apply?: boolean | undefined
    prefix?: string | undefined
    limit?: number | undefined
    direction?: "incoming" | "outgoing" | undefined
    errorCodes?: ReadonlyArray<number> | undefined
    fixId?: string | undefined
    refactorName?: string | undefined
    actionName?: string | undefined
    member?: string | undefined
  },
) =>
  Effect.gen(function* () {
    yield* ensureServer(port)
    const client = McpClient.fromUrl(DEFAULT_URL(port))
    yield* client.initialize()
    const raw = yield* runCommand(client, command, {
      position,
      symbol: opts?.symbol,
      depth: opts?.depth,
      detailed: opts?.detailed,
      moduleSpecifier: opts?.moduleSpecifier,
      newName: opts?.newName,
      apply: opts?.apply,
      prefix: opts?.prefix,
      limit: opts?.limit,
      direction: opts?.direction,
      errorCodes: opts?.errorCodes,
      fixId: opts?.fixId,
      refactorName: opts?.refactorName,
      actionName: opts?.actionName,
      member: opts?.member,
    })
    const output = formatOutput(command, raw, opts?.format ?? "plain")
    yield* Console.log(output)
  })

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

Command.run(app, {
  version: "0.1.0",
}).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
