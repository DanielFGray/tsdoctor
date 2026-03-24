import { Effect } from "effect"
import type { McpClient } from "./mcp-client.ts"
import { parsePositionArgs } from "./position.ts"
import { MissingArgumentError, UnknownCommandError } from "./errors.ts"

interface CommandOptions {
  readonly position: string
  readonly symbol?: string | undefined
  readonly depth?: number | undefined
  readonly detailed?: boolean | undefined
  readonly moduleSpecifier?: string | undefined
  readonly newName?: string | undefined
  readonly apply?: boolean | undefined
  readonly prefix?: string | undefined
  readonly limit?: number | undefined
  readonly direction?: "incoming" | "outgoing" | undefined
  readonly errorCodes?: ReadonlyArray<number> | undefined
  readonly fixId?: string | undefined
  readonly refactorName?: string | undefined
  readonly actionName?: string | undefined
  readonly member?: string | undefined
}

const extractContent = (result: { content: ReadonlyArray<{ text: string }> }): string =>
  result.content.map((c) => c.text).join("\n")

/** Map a CLI subcommand name + options to an MCP tool call and return formatted output */
export const runCommand = (
  client: McpClient,
  command: string,
  opts: CommandOptions,
): Effect.Effect<string, MissingArgumentError | UnknownCommandError> => {
  const parsed = parsePositionArgs(opts.position)

  const positionArgs: Record<string, unknown> = { file: parsed.file }
  if (parsed.line !== undefined) positionArgs.line = parsed.line
  if (parsed.col !== undefined) positionArgs.col = parsed.col
  if (parsed.offset !== undefined) positionArgs.offset = parsed.offset
  if (opts.symbol !== undefined) positionArgs.symbol = opts.symbol

  switch (command) {
    case "type":
      return client
        .callTool("get_type_at_position", {
          ...positionArgs,
          ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "quickinfo":
      return client
        .callTool("get_quickinfo", positionArgs)
        .pipe(Effect.map(extractContent))

    case "diagnostics":
      return client
        .callTool("get_diagnostics", {
          file: parsed.file,
          ...(opts.detailed ? { detailed: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "typecheck":
      return client
        .callTool("typecheck", {
          file: parsed.file,
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "expand":
      return client
        .callTool("expand_type", {
          ...positionArgs,
          ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "definition":
      return client
        .callTool("get_definition", positionArgs)
        .pipe(Effect.map(extractContent))

    case "references":
      return client
        .callTool("get_references", positionArgs)
        .pipe(Effect.map(extractContent))

    case "exports":
      return client
        .callTool("get_module_exports", {
          file: parsed.file,
          moduleSpecifier: opts.moduleSpecifier ?? "",
        })
        .pipe(Effect.map(extractContent))

    case "outline":
      return client
        .callTool("get_file_outline", { file: parsed.file })
        .pipe(Effect.map(extractContent))

    case "explain":
      return client
        .callTool("explain_error", positionArgs)
        .pipe(Effect.map(extractContent))

    case "rename":
      if (!opts.newName) return Effect.fail(new MissingArgumentError({ command: "rename", argument: "--new-name" }))
      return client
        .callTool("rename_symbol", {
          ...positionArgs,
          newName: opts.newName,
          ...(opts.apply ? { apply: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "completions":
      return client
        .callTool("get_completions", {
          ...positionArgs,
          ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "signature":
      return client
        .callTool("get_signature_help", positionArgs)
        .pipe(Effect.map(extractContent))

    case "file-references":
      return client
        .callTool("get_file_references", { file: parsed.file })
        .pipe(Effect.map(extractContent))

    case "call-hierarchy":
      return client
        .callTool("get_call_hierarchy", {
          ...positionArgs,
          direction: opts.direction ?? "incoming",
        })
        .pipe(Effect.map(extractContent))

    case "code-fixes":
      return client
        .callTool("get_code_fixes", {
          ...positionArgs,
          errorCodes: opts.errorCodes ?? [],
          ...(opts.apply ? { apply: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "organize-imports":
      return client
        .callTool("organize_imports", {
          file: parsed.file,
          ...(opts.apply ? { apply: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "fix-all":
      return client
        .callTool("fix_all", {
          file: parsed.file,
          fixId: opts.fixId ?? "",
          ...(opts.apply ? { apply: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "refactor":
      return client
        .callTool("refactor", {
          file: parsed.file,
          ...(parsed.line !== undefined ? { line: parsed.line } : {}),
          ...(parsed.col !== undefined ? { col: parsed.col } : {}),
          ...(parsed.offset !== undefined ? { offset: parsed.offset } : {}),
          ...(opts.refactorName !== undefined ? { refactorName: opts.refactorName } : {}),
          ...(opts.actionName !== undefined ? { actionName: opts.actionName } : {}),
          ...(opts.apply ? { apply: true } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "explore":
      return client
        .callTool("explore_module", {
          file: parsed.file,
          module: opts.moduleSpecifier ?? "",
          ...(opts.member !== undefined ? { member: opts.member } : {}),
        })
        .pipe(Effect.map(extractContent))

    case "invalidate":
      return client
        .callTool("invalidate", parsed.file ? { file: parsed.file } : {})
        .pipe(Effect.map(extractContent))

    default:
      return Effect.fail(new UnknownCommandError({ command }))
  }
}
