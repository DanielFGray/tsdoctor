import { Effect } from "effect"
import * as ts from "typescript"
import {
  FileNotInProgramError,
  NodeNotFoundError,
  ProgramCreateError,
  SymbolNotFoundError,
} from "./errors.ts"
import { findNodeAtPosition, findNodeForRange, resolvePosition, type Position } from "./position.ts"

export interface FileContext {
  readonly checker: ts.TypeChecker
  readonly sourceFile: ts.SourceFile
  readonly program: ts.Program
  readonly position: Position
  readonly node: ts.Node
  readonly warning: string | null
}

export interface PositionInput {
  readonly line: number | undefined
  readonly col: number | undefined
  readonly offset: number | undefined
  readonly symbol?: string | undefined
}

interface FileProvider {
  readonly getForFile: (filePath: string) => Effect.Effect<{
    readonly service: ts.LanguageService
    readonly warning: string | null
  }>
}

const resolveProgram = (lsm: FileProvider, file: string) =>
  Effect.gen(function* () {
    const { service, warning } = yield* lsm.getForFile(file)
    const program = service.getProgram()

    if (!program) {
      return yield* new ProgramCreateError({ file })
    }

    const sourceFile = program.getSourceFile(file)
    if (!sourceFile) {
      return yield* new FileNotInProgramError({ file })
    }

    return { service, program, sourceFile, warning }
  })

const hasExplicitPosition = (input: PositionInput): boolean =>
  input.offset !== undefined || input.line !== undefined

const toPositionInput = (input: PositionInput) =>
  input.offset !== undefined
    ? { offset: input.offset }
    : { line: input.line ?? 1, col: input.col ?? 1 }

/**
 * Resolve a symbol name to an offset using the language service's navigation items.
 * Supports dot notation: "ClassName.methodName" resolves to the method within the class.
 */
const resolveSymbolToOffset = (
  service: ts.LanguageService,
  file: string,
  symbol: string,
): Effect.Effect<number, SymbolNotFoundError> => {
  const parts = symbol.split(".")
  const searchName = parts[parts.length - 1]!
  const containerPath = parts.slice(0, -1)

  const items = service.getNavigateToItems(searchName, 100, file, false)

  // Filter to items in this file with an exact name match
  const inFile = items.filter((item) =>
    item.fileName === file && item.name === searchName,
  )

  // If dot notation, filter by container chain
  const matched = containerPath.length > 0
    ? inFile.filter((item) => {
        // For "A.B.method", container should be "B" and its container "A"
        // getNavigateToItems gives us containerName for one level
        return item.containerName === containerPath[containerPath.length - 1]
      })
    : inFile

  const target = matched[0] ?? inFile[0]
  if (!target) {
    return Effect.fail(new SymbolNotFoundError({ file, symbol }))
  }

  return Effect.succeed(target.textSpan.start)
}

/**
 * Light preamble for tools that operate at the LanguageService level.
 * Resolves file → service → sourceFile → offset. No checker or AST node.
 */
export const resolveServiceContext = (
  lsm: FileProvider,
  file: string,
  positionInput: PositionInput,
) =>
  Effect.gen(function* () {
    const { service, sourceFile, warning } = yield* resolveProgram(lsm, file)

    // Symbol lookup when no explicit position given
    if (!hasExplicitPosition(positionInput) && positionInput.symbol) {
      const offset = yield* resolveSymbolToOffset(service, file, positionInput.symbol)
      const position = yield* resolvePosition(sourceFile, { offset })
      return { service, sourceFile, offset: position.offset, position, warning }
    }

    const position = yield* resolvePosition(sourceFile, toPositionInput(positionInput))
    return { service, sourceFile, offset: position.offset, position, warning }
  })

/**
 * Full preamble for tools that need the type checker and AST node.
 * Resolves file → program → sourceFile → position → node.
 */
export const resolveFileContext = (
  lsm: FileProvider,
  file: string,
  positionInput: PositionInput,
) =>
  Effect.gen(function* () {
    const { service, program, sourceFile, warning } = yield* resolveProgram(lsm, file)

    // Symbol lookup when no explicit position given
    const position = !hasExplicitPosition(positionInput) && positionInput.symbol
      ? yield* resolveSymbolToOffset(service, file, positionInput.symbol).pipe(
          Effect.flatMap((offset) => resolvePosition(sourceFile, { offset })),
        )
      : yield* resolvePosition(sourceFile, toPositionInput(positionInput))

    const checker = program.getTypeChecker()
    const node = findNodeAtPosition(sourceFile, position.offset)

    if (!node) {
      return yield* new NodeNotFoundError({
        file,
        line: position.lineCol.line,
        col: position.lineCol.col,
      })
    }

    return { checker, sourceFile, program, position, node, warning } satisfies FileContext
  })

export interface RangeInput {
  readonly startLine: number
  readonly startCol: number
  readonly endLine: number
  readonly endCol: number
}

/**
 * Preamble for range-based queries. Finds the smallest AST node that
 * fully contains the given source range.
 */
export const resolveFileContextForRange = (
  lsm: FileProvider,
  file: string,
  range: RangeInput,
) =>
  Effect.gen(function* () {
    const { program, sourceFile, warning } = yield* resolveProgram(lsm, file)
    const startPos = yield* resolvePosition(sourceFile, { line: range.startLine, col: range.startCol })
    const endPos = yield* resolvePosition(sourceFile, { line: range.endLine, col: range.endCol })

    const checker = program.getTypeChecker()
    const node = findNodeForRange(sourceFile, startPos.offset, endPos.offset)

    if (!node) {
      return yield* new NodeNotFoundError({
        file,
        line: range.startLine,
        col: range.startCol,
      })
    }

    return { checker, sourceFile, program, position: startPos, node, warning } satisfies FileContext
  })

/**
 * File-level preamble for tools that don't need a position (e.g. diagnostics).
 */
export const resolveFileOnly = (lsm: FileProvider, file: string) =>
  resolveProgram(lsm, file)
