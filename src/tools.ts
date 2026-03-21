import { Effect, Schema } from "effect"
import * as ts from "typescript"
import { Tool, Toolkit } from "effect/unstable/ai"
import { LanguageServiceManager } from "./LanguageServiceManager.ts"
import {
  resolveFileContext,
  resolveFileOnly,
  resolveServiceContext,
} from "./fileContext.ts"
import {
  FileNotInProgramError,
  NodeNotFoundError,
  PositionOutOfRangeError,
  ProgramCreateError,
} from "./errors.ts"
import { typeToString, typeToTree } from "./typeFormat.ts"
import { offsetToLineCol } from "./position.ts"

// -----------------------------------------------------------------------------
// Shared schemas
// -----------------------------------------------------------------------------

const PositionParams = {
  file: Schema.String,
  line: Schema.optionalKey(Schema.Finite),
  col: Schema.optionalKey(Schema.Finite),
  offset: Schema.optionalKey(Schema.Finite),
}

const PositionResult = Schema.Struct({
  line: Schema.Finite,
  col: Schema.Finite,
  offset: Schema.Finite,
})

const IntrospectionFailure = Schema.Union([
  ProgramCreateError,
  FileNotInProgramError,
  NodeNotFoundError,
  PositionOutOfRangeError,
])

const toolDefaults = {
  failure: IntrospectionFailure,
  failureMode: "return" as const,
}

// -----------------------------------------------------------------------------
// Tool definitions
// -----------------------------------------------------------------------------

const GetTypeAtPosition = Tool.make("get_type_at_position", {
  description:
    "Get the resolved type of the expression at a given position in a TypeScript file. " +
    "Returns both a flat string representation and a structured JSON type tree. " +
    "Provide either line+col (1-based) or offset (0-based).",
  parameters: Schema.Struct({
    ...PositionParams,
    depth: Schema.Finite.check(
      Schema.isBetween({ minimum: 0, maximum: 10 }),
    ).pipe(
      Schema.optionalKey,
      Schema.withDecodingDefaultKey(() => 1),
    ),
  }),
  success: Schema.Struct({
    flat: Schema.String,
    tree: Schema.Unknown,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetQuickInfo = Tool.make("get_quickinfo", {
  description:
    "Get hover-equivalent information at a position: type, documentation, JSDoc tags. " +
    "Provide either line+col (1-based) or offset (0-based).",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    displayString: Schema.String,
    documentation: Schema.String,
    kind: Schema.String,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetCompletions = Tool.make("get_completions", {
  description:
    "Get available completions at a position in a TypeScript file. " +
    "Returns member names, kinds, and sort text. " +
    "Provide either line+col (1-based) or offset (0-based).",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        kind: Schema.String,
        sortText: Schema.String,
      }),
    ),
    isGlobalCompletion: Schema.Boolean,
    isMemberCompletion: Schema.Boolean,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetDiagnostics = Tool.make("get_diagnostics", {
  description:
    "Get semantic diagnostics for a TypeScript file with full type expansions. " +
    "Returns all type errors, their positions, and the full diagnostic message chain.",
  parameters: Schema.Struct({
    file: Schema.String,
  }),
  success: Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        message: Schema.String,
        category: Schema.String,
        code: Schema.Finite,
        position: Schema.optionalKey(PositionResult),
        relatedInformation: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              message: Schema.String,
              position: Schema.optionalKey(PositionResult),
            }),
          ),
        ),
      }),
    ),
    count: Schema.Number,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const ExpandType = Tool.make("expand_type", {
  description:
    "Recursively expand a type at a position to the specified depth. " +
    "Returns a structured JSON type tree. Use higher depth to see nested type details. " +
    "Provide either line+col (1-based) or offset (0-based).",
  parameters: Schema.Struct({
    ...PositionParams,
    depth: Schema.Finite.check(
      Schema.isBetween({ minimum: 0, maximum: 10 }),
    ).pipe(
      Schema.optionalKey,
      Schema.withDecodingDefaultKey(() => 3),
    ),
  }),
  success: Schema.Struct({
    flat: Schema.String,
    tree: Schema.Unknown,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

// -----------------------------------------------------------------------------
// Toolkit
// -----------------------------------------------------------------------------

export const IntrospectionToolkit = Toolkit.make(
  GetTypeAtPosition,
  GetQuickInfo,
  GetCompletions,
  GetDiagnostics,
  ExpandType,
)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const flattenDiagnosticMessageText = (
  messageText: string | ts.DiagnosticMessageChain,
): string =>
  typeof messageText === "string"
    ? messageText
    : ts.flattenDiagnosticMessageText(messageText, "\n")

const categoryName = (category: ts.DiagnosticCategory): string => {
  switch (category) {
    case ts.DiagnosticCategory.Error: return "error"
    case ts.DiagnosticCategory.Warning: return "warning"
    case ts.DiagnosticCategory.Suggestion: return "suggestion"
    case ts.DiagnosticCategory.Message: return "message"
  }
}

// -----------------------------------------------------------------------------
// Handler layer
// -----------------------------------------------------------------------------

export const IntrospectionHandlers = IntrospectionToolkit.toLayer(
  Effect.gen(function* () {
    const lsm = yield* LanguageServiceManager

    return {
      get_type_at_position: ({ file, line, col, offset, depth }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileContext(lsm, file, { line, col, offset })
          const type = ctx.checker.getTypeAtLocation(ctx.node)

          return {
            flat: typeToString(ctx.checker, type, ctx.node),
            tree: typeToTree(ctx.checker, type, depth) as unknown,
            position: {
              line: ctx.position.lineCol.line,
              col: ctx.position.lineCol.col,
              offset: ctx.position.offset,
            },
            warning: ctx.warning,
          }
        }),

      get_quickinfo: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const info = ctx.service.getQuickInfoAtPosition(file, ctx.offset)

          return {
            displayString: info?.displayParts?.map((p) => p.text).join("") ?? "",
            documentation: info?.documentation?.map((p) => p.text).join("") ?? "",
            kind: info?.kind ?? "unknown",
            position: {
              line: ctx.position.lineCol.line,
              col: ctx.position.lineCol.col,
              offset: ctx.position.offset,
            },
            warning: ctx.warning,
          }
        }),

      get_completions: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const completions = ctx.service.getCompletionsAtPosition(file, ctx.offset, undefined)

          return {
            entries: (completions?.entries ?? []).map((e) => ({
              name: e.name,
              kind: e.kind,
              sortText: e.sortText,
            })),
            isGlobalCompletion: completions?.isGlobalCompletion ?? false,
            isMemberCompletion: completions?.isMemberCompletion ?? false,
            position: {
              line: ctx.position.lineCol.line,
              col: ctx.position.lineCol.col,
              offset: ctx.position.offset,
            },
            warning: ctx.warning,
          }
        }),

      get_diagnostics: ({ file }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const diagnostics = ctx.service.getSemanticDiagnostics(file)

          return {
            diagnostics: diagnostics.map((d) => {
              const position = d.file && d.start !== undefined
                ? (() => {
                  const lc = offsetToLineCol(d.file, d.start)
                  return { line: lc.line, col: lc.col, offset: d.start }
                })()
                : undefined

              const relatedInformation = d.relatedInformation?.map((ri) => {
                if (ri.file && ri.start !== undefined) {
                  const lc = offsetToLineCol(ri.file, ri.start)
                  return { message: flattenDiagnosticMessageText(ri.messageText), position: { line: lc.line, col: lc.col, offset: ri.start } }
                }
                return { message: flattenDiagnosticMessageText(ri.messageText) }
              })

              const base = {
                message: flattenDiagnosticMessageText(d.messageText),
                category: categoryName(d.category),
                code: d.code,
              }

              if (position && relatedInformation) {
                return { ...base, position, relatedInformation }
              }
              if (position) {
                return { ...base, position }
              }
              if (relatedInformation) {
                return { ...base, relatedInformation }
              }
              return base
            }),
            count: diagnostics.length,
            warning: ctx.warning,
          }
        }),

      expand_type: ({ file, line, col, offset, depth }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileContext(lsm, file, { line, col, offset })
          const type = ctx.checker.getTypeAtLocation(ctx.node)

          return {
            flat: typeToString(ctx.checker, type, ctx.node),
            tree: typeToTree(ctx.checker, type, depth) as unknown,
            position: {
              line: ctx.position.lineCol.line,
              col: ctx.position.lineCol.col,
              offset: ctx.position.offset,
            },
            warning: ctx.warning,
          }
        }),
    }
  }),
)
