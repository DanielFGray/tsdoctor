import { Effect, Schema } from "effect"
import * as ts from "typescript"
import { Tool, Toolkit } from "effect/unstable/ai"
import { LanguageServiceManager } from "./LanguageServiceManager.ts"
import {
  resolveFileContext,
  resolveFileContextForRange,
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

const TypeResultSchema = Schema.Struct({
  flat: Schema.String,
  tree: Schema.Unknown,
  position: PositionResult,
  warning: Schema.NullOr(Schema.String),
})

const makeDepthParam = (defaultDepth: number) =>
  Schema.Finite.check(
    Schema.isBetween({ minimum: 0, maximum: 10 }),
  ).pipe(
    Schema.optionalKey,
    Schema.withDecodingDefaultKey(() => defaultDepth),
  )

const GetTypeAtPosition = Tool.make("get_type_at_position", {
  description:
    "Resolve the TypeScript type of the expression at a position. " +
    "Returns a machine-readable type tree and flat string. " +
    "Use this to understand what type a variable, parameter, or expression resolves to. " +
    "For human-readable hover info with docs, use get_quickinfo instead. " +
    "depth controls type alias expansion (default 1 = overview, increase for nested detail). " +
    "Use startLine/startCol + endLine/endCol to get the type of a range (e.g. a whole pipe chain).",
  parameters: Schema.Struct({
    ...PositionParams,
    depth: makeDepthParam(1),
    startLine: Schema.optionalKey(Schema.Finite),
    startCol: Schema.optionalKey(Schema.Finite),
    endLine: Schema.optionalKey(Schema.Finite),
    endCol: Schema.optionalKey(Schema.Finite),
  }),
  success: TypeResultSchema,
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetQuickInfo = Tool.make("get_quickinfo", {
  description:
    "Get hover-equivalent info: display string, documentation, and JSDoc tags. " +
    "Use this to see what an editor would show on hover — includes @param, @returns, @example tags. " +
    "For machine-readable type structure, use get_type_at_position instead.",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    displayString: Schema.String,
    documentation: Schema.String,
    tags: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        text: Schema.String,
      }),
    ),
    kind: Schema.String,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetCompletions = Tool.make("get_completions", {
  description:
    "Discover available members, properties, or in-scope symbols at a position. " +
    "Use this to answer 'what methods does X have?' or 'what's available here?'. " +
    "Use prefix to filter by name (e.g. prefix='get' for getter methods). " +
    "Default limit 50; set higher if needed.",
  parameters: Schema.Struct({
    ...PositionParams,
    prefix: Schema.optionalKey(Schema.String),
    limit: Schema.Finite.pipe(
      Schema.optionalKey,
      Schema.withDecodingDefaultKey(() => 50),
    ),
  }),
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
    "Get type errors with full (non-truncated) diagnostic messages and code snippets. " +
    "By default checks a single file. Set projectWide: true to check all files in the project. " +
    "Use startLine/endLine to scope to recently edited lines.",
  parameters: Schema.Struct({
    file: Schema.String,
    projectWide: Schema.optionalKey(Schema.Boolean),
    suggestions: Schema.optionalKey(Schema.Boolean),
    startLine: Schema.optionalKey(Schema.Finite),
    endLine: Schema.optionalKey(Schema.Finite),
  }),
  success: Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        file: Schema.optionalKey(Schema.String),
        message: Schema.String,
        category: Schema.String,
        code: Schema.Finite,
        snippet: Schema.optionalKey(Schema.String),
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
    count: Schema.Finite,
    summary: Schema.String,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const Typecheck = Tool.make("typecheck", {
  description:
    "Quick project-wide type check. Returns pass/fail, error count, and tsc-style summary. " +
    "The fastest way to answer 'does this project typecheck?'. " +
    "Pass any file in the project to identify which tsconfig to use.",
  parameters: Schema.Struct({
    file: Schema.String,
  }),
  success: Schema.Struct({
    pass: Schema.Boolean,
    errorCount: Schema.Finite,
    summary: Schema.String,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const ExpandType = Tool.make("expand_type", {
  description:
    "Deep-expand a type at a position (default depth 3). " +
    "Use when get_type_at_position returned a reference you need to drill into, " +
    "or to understand complex generics, union types, and nested structures.",
  parameters: Schema.Struct({
    ...PositionParams,
    depth: makeDepthParam(3),
  }),
  success: TypeResultSchema,
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetSignatureHelp = Tool.make("get_signature_help", {
  description:
    "Get parameter info for a function call at a position. " +
    "Cursor must be inside call parentheses. " +
    "Returns expected parameters with types, which parameter is active, and overload signatures. " +
    "Use this to answer 'what arguments does this function expect?'.",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    signatures: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        parameters: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            type: Schema.String,
            isOptional: Schema.Boolean,
          }),
        ),
        documentation: Schema.String,
      }),
    ),
    activeSignature: Schema.Finite,
    activeParameter: Schema.Finite,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetDefinition = Tool.make("get_definition", {
  description:
    "Go to the definition of a symbol. " +
    "Resolves through re-exports, barrel files, and generic instantiations. " +
    "Returns the file, line, and col where the symbol is defined.",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    definitions: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.Finite,
        col: Schema.Finite,
        name: Schema.String,
        kind: Schema.String,
      }),
    ),
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetReferences = Tool.make("get_references", {
  description:
    "Find all semantic references to a symbol (more precise than grep). " +
    "Returns every file and position where the symbol is used, plus whether each is a definition. " +
    "Use to understand impact of a change or find all callers.",
  parameters: Schema.Struct(PositionParams),
  success: Schema.Struct({
    references: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.Finite,
        col: Schema.Finite,
        isDefinition: Schema.Boolean,
      }),
    ),
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const RenameSymbol = Tool.make("rename_symbol", {
  description:
    "Rename a symbol across the entire project. " +
    "By default returns a dry-run list of edits. Set apply: true to write changes to disk. " +
    "Each edit shows file, position, oldText, and newText. " +
    "Handles imports, re-exports, and type references.",
  parameters: Schema.Struct({
    ...PositionParams,
    newName: Schema.String,
    apply: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    canRename: Schema.Boolean,
    reason: Schema.optionalKey(Schema.String),
    edits: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.Finite,
        col: Schema.Finite,
        oldText: Schema.String,
        newText: Schema.String,
      }),
    ),
    applied: Schema.Boolean,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
})

const GetCodeFixes = Tool.make("get_code_fixes", {
  description:
    "Get suggested code fixes for a diagnostic at a position. " +
    "Pass the error code(s) from get_diagnostics. Returns fix descriptions and text edits. " +
    "Covers auto-import, add missing property, convert types, etc. " +
    "Set apply: true to write the first fix to disk.",
  parameters: Schema.Struct({
    ...PositionParams,
    errorCodes: Schema.Array(Schema.Finite),
    apply: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    fixes: Schema.Array(
      Schema.Struct({
        fixName: Schema.String,
        description: Schema.String,
        changes: Schema.Array(
          Schema.Struct({
            file: Schema.String,
            isNewFile: Schema.Boolean,
            edits: Schema.Array(
              Schema.Struct({
                offset: Schema.Finite,
                length: Schema.Finite,
                newText: Schema.String,
              }),
            ),
          }),
        ),
      }),
    ),
    applied: Schema.Boolean,
    position: PositionResult,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
})

const GetModuleExports = Tool.make("get_module_exports", {
  description:
    "List all exports from a module. Pass a file (context for resolution) and a module specifier " +
    "(e.g. 'effect', './foo'). Returns export names, kinds, and type strings. " +
    "Use to answer 'what's available from this module?'.",
  parameters: Schema.Struct({
    file: Schema.String,
    moduleSpecifier: Schema.String,
  }),
  success: Schema.Struct({
    exports: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        kind: Schema.String,
        type: Schema.String,
      }),
    ),
    resolvedFile: Schema.optionalKey(Schema.String),
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetFileOutline = Tool.make("get_file_outline", {
  description:
    "Get a structured symbol outline for a file. " +
    "Returns a tree of all declarations (classes, functions, variables, interfaces) with line numbers. " +
    "Faster than reading the whole file when you just need to know what's defined.",
  parameters: Schema.Struct({
    file: Schema.String,
  }),
  success: Schema.Struct({
    symbols: Schema.Unknown,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const GetFileReferences = Tool.make("get_file_references", {
  description:
    "Find all files that import or reference a given file. " +
    "Useful before renaming, moving, or deleting a file to understand impact.",
  parameters: Schema.Struct({
    file: Schema.String,
  }),
  success: Schema.Struct({
    references: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.Finite,
        col: Schema.Finite,
      }),
    ),
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
}).annotate(Tool.Readonly, true)

const Invalidate = Tool.make("invalidate", {
  description:
    "Drop all cached TypeScript language services and rebuild from scratch on next query. " +
    "Use after external builds (tsc, bundler), npm install, or when types seem stale. " +
    "This is cheap — the next tool call will recreate the service lazily.",
  parameters: Schema.Struct({}),
  success: Schema.Struct({
    message: Schema.String,
  }),
})

const OrganizeImports = Tool.make("organize_imports", {
  description:
    "Clean up imports: sort, remove unused, combine. " +
    "Returns edits by default (dry run). Set apply: true to write changes.",
  parameters: Schema.Struct({
    file: Schema.String,
    apply: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    changes: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        edits: Schema.Array(
          Schema.Struct({
            offset: Schema.Finite,
            length: Schema.Finite,
            newText: Schema.String,
          }),
        ),
      }),
    ),
    applied: Schema.Boolean,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
})

const FixAll = Tool.make("fix_all", {
  description:
    "Apply a code fix across an entire file (e.g. add all missing imports at once). " +
    "Pass a fixId from get_code_fixes results. Returns edits by default (dry run). " +
    "Set apply: true to write changes.",
  parameters: Schema.Struct({
    file: Schema.String,
    fixId: Schema.String,
    apply: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    changes: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        isNewFile: Schema.Boolean,
        edits: Schema.Array(
          Schema.Struct({
            offset: Schema.Finite,
            length: Schema.Finite,
            newText: Schema.String,
          }),
        ),
      }),
    ),
    applied: Schema.Boolean,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
})

const Refactor = Tool.make("refactor", {
  description:
    "List or apply refactors at a position or range. " +
    "Without actionName: lists available refactors (extract function, extract constant, move to file, etc.). " +
    "With refactorName + actionName: returns the edits for that refactor. " +
    "Set apply: true to write changes. Use startLine/startCol + endLine/endCol for range-based refactors.",
  parameters: Schema.Struct({
    file: Schema.String,
    line: Schema.optionalKey(Schema.Finite),
    col: Schema.optionalKey(Schema.Finite),
    offset: Schema.optionalKey(Schema.Finite),
    startLine: Schema.optionalKey(Schema.Finite),
    startCol: Schema.optionalKey(Schema.Finite),
    endLine: Schema.optionalKey(Schema.Finite),
    endCol: Schema.optionalKey(Schema.Finite),
    refactorName: Schema.optionalKey(Schema.String),
    actionName: Schema.optionalKey(Schema.String),
    apply: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    refactors: Schema.optionalKey(Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String,
        actions: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            description: Schema.String,
          }),
        ),
      }),
    )),
    changes: Schema.optionalKey(Schema.Array(
      Schema.Struct({
        file: Schema.String,
        edits: Schema.Array(
          Schema.Struct({
            offset: Schema.Finite,
            length: Schema.Finite,
            newText: Schema.String,
          }),
        ),
      }),
    )),
    applied: Schema.Boolean,
    warning: Schema.NullOr(Schema.String),
  }),
  ...toolDefaults,
})

// -----------------------------------------------------------------------------
// Toolkit
// -----------------------------------------------------------------------------

export const IntrospectionToolkit = Toolkit.make(
  GetTypeAtPosition,
  GetQuickInfo,
  GetCompletions,
  GetDiagnostics,
  Typecheck,
  ExpandType,
  GetSignatureHelp,
  GetDefinition,
  GetReferences,
  RenameSymbol,
  GetCodeFixes,
  GetModuleExports,
  GetFileOutline,
  GetFileReferences,
  Invalidate,
  OrganizeImports,
  FixAll,
  Refactor,
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

/** Format a diagnostic as a tsc-style one-liner: file(line,col): category TScode: message */
const formatDiagnosticLine = (d: ts.Diagnostic): string => {
  const message = flattenDiagnosticMessageText(d.messageText)
  const category = categoryName(d.category)
  if (d.file && d.start !== undefined) {
    const lc = offsetToLineCol(d.file, d.start)
    const fileName = d.file.fileName.replace(process.cwd() + "/", "")
    return `${fileName}(${lc.line},${lc.col}): ${category} TS${d.code}: ${message}`
  }
  return `${category} TS${d.code}: ${message}`
}

/** Apply FileTextChanges to disk — shared by organize_imports, fix_all, refactor */
const applyFileChanges = (
  service: ts.LanguageService,
  fileChanges: readonly ts.FileTextChanges[],
) =>
  Effect.forEach(
    fileChanges,
    (fc) =>
      Effect.sync(() => {
        if (fc.isNewFile) {
          ts.sys.writeFile(fc.fileName, fc.textChanges.map((tc) => tc.newText).join(""))
          return
        }
        const sf = service.getProgram()?.getSourceFile(fc.fileName)
        if (!sf) return
        let content = sf.getFullText()
        const sorted = [...fc.textChanges].sort((a, b) => b.span.start - a.span.start)
        sorted.forEach((tc) => {
          content =
            content.slice(0, tc.span.start) +
            tc.newText +
            content.slice(tc.span.start + tc.span.length)
        })
        ts.sys.writeFile(fc.fileName, content)
      }),
    { concurrency: 1 },
  )

const positionOf = (ctx: { position: { lineCol: { line: number; col: number }; offset: number } }) => ({
  line: ctx.position.lineCol.line,
  col: ctx.position.lineCol.col,
  offset: ctx.position.offset,
})

const getSnippet = (file: ts.SourceFile, start: number, contextLines = 1): string => {
  const lc = offsetToLineCol(file, start)
  const lineStarts = file.getLineStarts()
  const startLine = Math.max(0, lc.line - 1 - contextLines)
  const endLine = Math.min(lineStarts.length - 1, lc.line - 1 + contextLines)
  const text = file.getFullText()

  const lines: string[] = []
  for (let i = startLine; i <= endLine; i++) {
    const lineStart = lineStarts[i]!
    const lineEnd = i + 1 < lineStarts.length ? lineStarts[i + 1]! : text.length
    const lineText = text.slice(lineStart, lineEnd).replace(/\n$/, "")
    const marker = i === lc.line - 1 ? ">" : " "
    lines.push(`${marker} ${i + 1} | ${lineText}`)
  }
  return lines.join("\n")
}

const formatDiagnostic = (d: ts.Diagnostic) => {
  const position = d.file && d.start !== undefined
    ? (() => {
      const lc = offsetToLineCol(d.file, d.start)
      return { line: lc.line, col: lc.col, offset: d.start }
    })()
    : undefined

  const snippet = d.file && d.start !== undefined
    ? getSnippet(d.file, d.start)
    : undefined

  const relatedInformation = d.relatedInformation?.map((ri) => {
    if (ri.file && ri.start !== undefined) {
      const lc = offsetToLineCol(ri.file, ri.start)
      return { message: flattenDiagnosticMessageText(ri.messageText), position: { line: lc.line, col: lc.col, offset: ri.start } }
    }
    return { message: flattenDiagnosticMessageText(ri.messageText) }
  })

  const base = d.file
    ? {
      file: d.file.fileName,
      message: flattenDiagnosticMessageText(d.messageText),
      category: categoryName(d.category),
      code: d.code,
    }
    : {
      message: flattenDiagnosticMessageText(d.messageText),
      category: categoryName(d.category),
      code: d.code,
    }

  // Build result, omitting undefined optional fields (exactOptionalPropertyTypes)
  const withSnippet = snippet ? { ...base, snippet } : base
  if (position && relatedInformation) return { ...withSnippet, position, relatedInformation }
  if (position) return { ...withSnippet, position }
  if (relatedInformation) return { ...withSnippet, relatedInformation }
  return withSnippet
}

// -----------------------------------------------------------------------------
// Handler layer
// -----------------------------------------------------------------------------

export const IntrospectionHandlers = IntrospectionToolkit.toLayer(
  Effect.gen(function* () {
    const lsm = yield* LanguageServiceManager

    const typeAtPosition = ({ file, line, col, offset, depth, startLine, startCol, endLine, endCol }: {
      readonly file: string
      readonly line?: number; readonly col?: number; readonly offset?: number
      readonly depth?: number
      readonly startLine?: number; readonly startCol?: number
      readonly endLine?: number; readonly endCol?: number
    }) =>
      Effect.gen(function* () {
        const hasRange = startLine !== undefined && startCol !== undefined
          && endLine !== undefined && endCol !== undefined
        const ctx = hasRange
          ? yield* resolveFileContextForRange(lsm, file, { startLine, startCol, endLine, endCol })
          : yield* resolveFileContext(lsm, file, { line, col, offset })
        const type = ctx.checker.getTypeAtLocation(ctx.node)

        return {
          flat: typeToString(ctx.checker, type, ctx.node),
          tree: typeToTree(ctx.checker, type, depth) as unknown,
          position: positionOf(ctx),
          warning: ctx.warning,
        }
      })

    return {
      get_type_at_position: typeAtPosition,

      get_quickinfo: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const info = ctx.service.getQuickInfoAtPosition(file, ctx.offset)

          return {
            displayString: info?.displayParts?.map((p) => p.text).join("") ?? "",
            documentation: info?.documentation?.map((p) => p.text).join("") ?? "",
            tags: (info?.tags ?? []).map((t) => ({
              name: t.name,
              text: t.text?.map((p) => p.text).join("") ?? "",
            })),
            kind: info?.kind ?? "unknown",
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_completions: ({ file, line, col, offset, prefix, limit }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const completions = ctx.service.getCompletionsAtPosition(file, ctx.offset, undefined)

          const allEntries = (completions?.entries ?? [])
          const filtered = prefix
            ? allEntries.filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
            : allEntries

          return {
            entries: filtered.slice(0, limit).map((e) => ({
              name: e.name,
              kind: e.kind,
              sortText: e.sortText,
            })),
            isGlobalCompletion: completions?.isGlobalCompletion ?? false,
            isMemberCompletion: completions?.isMemberCompletion ?? false,
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_diagnostics: ({ file, projectWide, suggestions, startLine, endLine }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const program = ctx.service.getProgram()
          const semanticDiags = projectWide && program
            ? [...ts.getPreEmitDiagnostics(program)]
            : [...ctx.service.getSemanticDiagnostics(file)]

          const includeSuggestions = suggestions !== false
          const suggestionDiags = includeSuggestions
            ? ctx.service.getSuggestionDiagnostics(file)
            : []

          const allDiagnostics = [...semanticDiags, ...suggestionDiags]

          const filtered = (startLine !== undefined || endLine !== undefined)
            ? allDiagnostics.filter((d) => {
              if (!d.file || d.start === undefined) return false
              const lc = offsetToLineCol(d.file, d.start)
              if (startLine !== undefined && lc.line < startLine) return false
              if (endLine !== undefined && lc.line > endLine) return false
              return true
            })
            : allDiagnostics

          const summary = filtered.map(formatDiagnosticLine).join("\n")

          return {
            diagnostics: filtered.map(formatDiagnostic),
            count: filtered.length,
            summary: filtered.length > 0
              ? summary + `\n\nFound ${filtered.length} error(s).`
              : "No errors found.",
            warning: ctx.warning,
          }
        }),

      typecheck: ({ file }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const program = ctx.service.getProgram()
          const diagnostics = program
            ? ts.getPreEmitDiagnostics(program)
            : ctx.service.getSemanticDiagnostics(file)

          const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
          const maxLines = 30
          const lines = errors.map(formatDiagnosticLine)
          const truncated = lines.length > maxLines
          const shown = truncated ? lines.slice(0, maxLines) : lines
          const summary = errors.length > 0
            ? shown.join("\n")
              + (truncated ? `\n... and ${lines.length - maxLines} more` : "")
              + `\n\nFound ${errors.length} error(s).`
            : "No errors found."

          return {
            pass: errors.length === 0,
            errorCount: errors.length,
            summary,
            warning: ctx.warning,
          }
        }),

      expand_type: typeAtPosition,

      get_signature_help: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const help = ctx.service.getSignatureHelpItems(file, ctx.offset, undefined)

          return {
            signatures: (help?.items ?? []).map((item) => ({
              label: [
                ...item.prefixDisplayParts,
                ...item.parameters.flatMap((p, i) => [
                  ...(i > 0 ? item.separatorDisplayParts : []),
                  ...p.displayParts,
                ]),
                ...item.suffixDisplayParts,
              ].map((p) => p.text).join(""),
              parameters: item.parameters.map((p) => ({
                name: p.name,
                type: p.displayParts.map((dp) => dp.text).join(""),
                isOptional: p.isOptional,
              })),
              documentation: item.documentation.map((d) => d.text).join(""),
            })),
            activeSignature: help?.selectedItemIndex ?? 0,
            activeParameter: help?.argumentIndex ?? 0,
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_definition: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const defs = ctx.service.getDefinitionAtPosition(file, ctx.offset)

          return {
            definitions: (defs ?? []).map((d) => {
              const sourceFile = ctx.service.getProgram()?.getSourceFile(d.fileName)
              const lc = sourceFile
                ? offsetToLineCol(sourceFile, d.textSpan.start)
                : { line: 0, col: 0 }
              return {
                file: d.fileName,
                line: lc.line,
                col: lc.col,
                name: d.name ?? "",
                kind: d.kind,
              }
            }),
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_references: ({ file, line, col, offset }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const refs = ctx.service.findReferences(file, ctx.offset)

          return {
            references: (refs ?? []).flatMap((symbol) =>
              symbol.references.map((ref) => {
                const sourceFile = ctx.service.getProgram()?.getSourceFile(ref.fileName)
                const lc = sourceFile
                  ? offsetToLineCol(sourceFile, ref.textSpan.start)
                  : { line: 0, col: 0 }
                return {
                  file: ref.fileName,
                  line: lc.line,
                  col: lc.col,
                  isDefinition: ref.isDefinition ?? false,
                }
              }),
            ),
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      rename_symbol: ({ file, line, col, offset, newName, apply }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const renameInfo = ctx.service.getRenameInfo(file, ctx.offset, {})

          if (!renameInfo.canRename) {
            return {
              canRename: false,
              reason: renameInfo.localizedErrorMessage,
              edits: [],
              applied: false,
              position: positionOf(ctx),
              warning: ctx.warning,
            }
          }

          const locations = ctx.service.findRenameLocations(
            file, ctx.offset, false, false, { providePrefixAndSuffixTextForRename: true },
          ) ?? []

          const edits = locations.map((loc) => {
            const sourceFile = ctx.service.getProgram()?.getSourceFile(loc.fileName)
            const lc = sourceFile
              ? offsetToLineCol(sourceFile, loc.textSpan.start)
              : { line: 0, col: 0 }
            const oldText = sourceFile
              ? sourceFile.getFullText().slice(loc.textSpan.start, loc.textSpan.start + loc.textSpan.length)
              : ""
            return {
              file: loc.fileName,
              line: lc.line,
              col: lc.col,
              oldText,
              newText: (loc.prefixText ?? "") + newName + (loc.suffixText ?? ""),
            }
          })

          if (apply) {
            // Group edits by file, apply in reverse offset order to preserve positions
            const byFile = new Map<string, typeof edits>()
            edits.forEach((e) => {
              const existing = byFile.get(e.file) ?? []
              existing.push(e)
              byFile.set(e.file, existing)
            })

            yield* Effect.forEach(
              [...byFile.entries()],
              ([filePath, fileEdits]) =>
                Effect.sync(() => {
                  const sourceFile = ctx.service.getProgram()?.getSourceFile(filePath)
                  if (!sourceFile) return
                  let content = sourceFile.getFullText()

                  // Find the corresponding locations sorted by offset descending
                  const locsForFile = locations
                    .filter((l) => l.fileName === filePath)
                    .sort((a, b) => b.textSpan.start - a.textSpan.start)

                  locsForFile.forEach((loc) => {
                    const replacement = (loc.prefixText ?? "") + newName + (loc.suffixText ?? "")
                    content =
                      content.slice(0, loc.textSpan.start) +
                      replacement +
                      content.slice(loc.textSpan.start + loc.textSpan.length)
                  })

                  ts.sys.writeFile(filePath, content)
                }),
              { concurrency: 1 },
            )
          }

          return {
            canRename: true,
            edits,
            applied: apply ?? false,
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_code_fixes: ({ file, line, col, offset, errorCodes, apply }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveServiceContext(lsm, file, { line, col, offset })
          const program = ctx.service.getProgram()

          // Use the offset as both start and end for point diagnostics
          const codeFixes = ctx.service.getCodeFixesAtPosition(
            file, ctx.offset, ctx.offset + 1, errorCodes, {}, {},
          )

          const fixes = codeFixes.map((fix) => ({
            fixName: fix.fixName,
            description: fix.description,
            changes: fix.changes.map((change) => ({
              file: change.fileName,
              isNewFile: change.isNewFile ?? false,
              edits: change.textChanges.map((tc) => ({
                offset: tc.span.start,
                length: tc.span.length,
                newText: tc.newText,
              })),
            })),
          }))

          if (apply && fixes.length > 0) {
            const firstFix = fixes[0]!
            yield* Effect.forEach(
              firstFix.changes,
              (change) =>
                Effect.sync(() => {
                  if (change.isNewFile) {
                    ts.sys.writeFile(change.file, change.edits.map((e) => e.newText).join(""))
                    return
                  }
                  const sf = program?.getSourceFile(change.file)
                  if (!sf) return
                  let content = sf.getFullText()

                  // Apply edits in reverse order to preserve offsets
                  const sorted = [...change.edits].sort((a, b) => b.offset - a.offset)
                  sorted.forEach((edit) => {
                    content =
                      content.slice(0, edit.offset) +
                      edit.newText +
                      content.slice(edit.offset + edit.length)
                  })

                  ts.sys.writeFile(change.file, content)
                }),
              { concurrency: 1 },
            )
          }

          return {
            fixes,
            applied: (apply && fixes.length > 0) ?? false,
            position: positionOf(ctx),
            warning: ctx.warning,
          }
        }),

      get_module_exports: ({ file, moduleSpecifier }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const program = ctx.service.getProgram()

          if (!program) {
            return yield* new ProgramCreateError({ file })
          }

          const checker = program.getTypeChecker()
          const sourceFile = program.getSourceFile(file)

          if (!sourceFile) {
            return yield* new FileNotInProgramError({ file })
          }

          const resolved = ts.resolveModuleName(
            moduleSpecifier,
            file,
            program.getCompilerOptions(),
            ts.sys,
          )

          const resolvedFile = resolved.resolvedModule?.resolvedFileName
          if (!resolvedFile) {
            return {
              exports: [],
              warning: `Could not resolve module '${moduleSpecifier}' from ${file}`,
            }
          }

          const resolvedSourceFile = program.getSourceFile(resolvedFile)
          if (!resolvedSourceFile) {
            return {
              exports: [],
              resolvedFile,
              warning: `Module resolved to ${resolvedFile} but source file not in program`,
            }
          }

          const moduleSymbol = checker.getSymbolAtLocation(resolvedSourceFile)
          if (!moduleSymbol) {
            return {
              exports: [],
              resolvedFile,
              warning: `No symbol found for module ${resolvedFile}`,
            }
          }

          const exportSymbols = checker.getExportsOfModule(moduleSymbol)
          const exports = exportSymbols.map((sym) => {
            const type = checker.getTypeOfSymbol(sym)
            const kind = ts.SymbolFlags[sym.flags & ~ts.SymbolFlags.Transient] ?? "unknown"
            return {
              name: sym.getName(),
              kind,
              type: checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
            }
          })

          return {
            exports,
            resolvedFile,
            warning: ctx.warning,
          }
        }),

      get_file_outline: ({ file }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const tree = ctx.service.getNavigationTree(file)

          const flattenTree = (node: ts.NavigationTree, depth = 0): Array<{
            name: string
            kind: string
            line: number
            col: number
            depth: number
            children?: Array<{ name: string; kind: string; line: number; col: number }>
          }> => {
            // Skip the top-level module node
            if (node.kind === ts.ScriptElementKind.moduleElement && depth === 0) {
              return (node.childItems ?? []).flatMap((child) => flattenTree(child, depth))
            }

            const sourceFile = ctx.service.getProgram()?.getSourceFile(file)
            const span = node.spans[0]
            const lc = sourceFile && span
              ? offsetToLineCol(sourceFile, span.start)
              : { line: 0, col: 0 }

            const children = (node.childItems ?? []).map((child) => {
              const childSpan = child.spans[0]
              const childLc = sourceFile && childSpan
                ? offsetToLineCol(sourceFile, childSpan.start)
                : { line: 0, col: 0 }
              return { name: child.text, kind: child.kind, line: childLc.line, col: childLc.col }
            })

            const entry = children.length > 0
              ? { name: node.text, kind: node.kind, line: lc.line, col: lc.col, depth, children }
              : { name: node.text, kind: node.kind, line: lc.line, col: lc.col, depth }

            return [entry]
          }

          return {
            symbols: flattenTree(tree) as unknown,
            warning: ctx.warning,
          }
        }),

      get_file_references: ({ file }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const refs = ctx.service.getFileReferences(file)

          return {
            references: refs.map((ref) => {
              const sourceFile = ctx.service.getProgram()?.getSourceFile(ref.fileName)
              const lc = sourceFile
                ? offsetToLineCol(sourceFile, ref.textSpan.start)
                : { line: 0, col: 0 }
              return { file: ref.fileName, line: lc.line, col: lc.col }
            }),
            warning: ctx.warning,
          }
        }),

      invalidate: () =>
        Effect.gen(function* () {
          yield* lsm.invalidate()
          return { message: "All language services invalidated. Next query will rebuild from scratch." }
        }),

      organize_imports: ({ file, apply }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const fileChanges = ctx.service.organizeImports(
            { type: "file", fileName: file },
            {},
            {},
          )

          const changes = fileChanges.map((fc) => ({
            file: fc.fileName,
            edits: fc.textChanges.map((tc) => ({
              offset: tc.span.start,
              length: tc.span.length,
              newText: tc.newText,
            })),
          }))

          if (apply && changes.length > 0) {
            yield* applyFileChanges(ctx.service, fileChanges)
          }

          return {
            changes,
            applied: (apply && changes.length > 0) ?? false,
            warning: ctx.warning,
          }
        }),

      fix_all: ({ file, fixId, apply }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const combined = ctx.service.getCombinedCodeFix(
            { type: "file", fileName: file },
            fixId,
            {},
            {},
          )

          const changes = combined.changes.map((fc) => ({
            file: fc.fileName,
            isNewFile: fc.isNewFile ?? false,
            edits: fc.textChanges.map((tc) => ({
              offset: tc.span.start,
              length: tc.span.length,
              newText: tc.newText,
            })),
          }))

          if (apply && changes.length > 0) {
            yield* applyFileChanges(ctx.service, combined.changes)
          }

          return {
            changes,
            applied: (apply && changes.length > 0) ?? false,
            warning: ctx.warning,
          }
        }),

      refactor: ({ file, line, col, offset, startLine, startCol, endLine, endCol, refactorName, actionName, apply }) =>
        Effect.gen(function* () {
          const ctx = yield* resolveFileOnly(lsm, file)
          const sourceFile = ctx.service.getProgram()?.getSourceFile(file)

          if (!sourceFile) {
            return yield* new FileNotInProgramError({ file })
          }

          // Determine position or range
          const hasRange = startLine !== undefined && startCol !== undefined
            && endLine !== undefined && endCol !== undefined
          const positionOrRange = hasRange
            ? {
              pos: ts.getPositionOfLineAndCharacter(sourceFile, startLine - 1, startCol - 1),
              end: ts.getPositionOfLineAndCharacter(sourceFile, endLine - 1, endCol - 1),
            }
            : offset !== undefined
              ? offset
              : line !== undefined && col !== undefined
                ? ts.getPositionOfLineAndCharacter(sourceFile, line - 1, col - 1)
                : 0

          // If no action specified, list available refactors
          if (!refactorName || !actionName) {
            const refactors = ctx.service.getApplicableRefactors(file, positionOrRange, {})
            return {
              refactors: refactors.map((r) => ({
                name: r.name,
                description: r.description,
                actions: r.actions
                  .filter((a) => !a.notApplicableReason)
                  .map((a) => ({ name: a.name, description: a.description })),
              })),
              applied: false,
              warning: ctx.warning,
            }
          }

          // Apply specific refactor
          const editInfo = ctx.service.getEditsForRefactor(
            file, {}, positionOrRange, refactorName, actionName, {},
          )

          if (!editInfo) {
            return {
              changes: [],
              applied: false,
              warning: `Refactor '${refactorName}/${actionName}' returned no edits`,
            }
          }

          const changes = editInfo.edits.map((fc) => ({
            file: fc.fileName,
            edits: fc.textChanges.map((tc) => ({
              offset: tc.span.start,
              length: tc.span.length,
              newText: tc.newText,
            })),
          }))

          if (apply && changes.length > 0) {
            yield* applyFileChanges(ctx.service, editInfo.edits)
          }

          return {
            changes,
            applied: (apply && changes.length > 0) ?? false,
            warning: ctx.warning,
          }
        }),
    }
  }),
)
