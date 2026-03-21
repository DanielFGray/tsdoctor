import { Effect } from "effect"
import * as ts from "typescript"
import {
  FileNotInProgramError,
  NodeNotFoundError,
  ProgramCreateError,
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

const toPositionInput = (input: PositionInput) =>
  input.offset !== undefined
    ? { offset: input.offset }
    : { line: input.line ?? 1, col: input.col ?? 1 }

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
    const { program, sourceFile, warning } = yield* resolveProgram(lsm, file)
    const position = yield* resolvePosition(sourceFile, toPositionInput(positionInput))

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
