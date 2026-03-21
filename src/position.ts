import { Effect } from "effect"
import * as ts from "typescript"
import { PositionOutOfRangeError } from "./errors.ts"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LineCol {
  /** 1-based line number */
  readonly line: number
  /** 1-based column number */
  readonly col: number
}

export interface Position {
  readonly offset: number
  readonly lineCol: LineCol
}

// -----------------------------------------------------------------------------
// Conversions
// -----------------------------------------------------------------------------

/** Convert 1-based line:col to 0-based byte offset */
export const lineColToOffset = (
  sourceFile: ts.SourceFile,
  { line, col }: LineCol,
): number =>
  ts.getPositionOfLineAndCharacter(sourceFile, line - 1, col - 1)

/** Convert 0-based byte offset to 1-based line:col */
export const offsetToLineCol = (
  sourceFile: ts.SourceFile,
  offset: number,
): LineCol => {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, offset)
  return { line: line + 1, col: character + 1 }
}

/** Get the number of lines in a source file (1-based count) */
const getLineCount = (sourceFile: ts.SourceFile): number =>
  sourceFile.getLineStarts().length

/** Resolve either input format to a full Position, validating bounds */
export const resolvePosition = (
  sourceFile: ts.SourceFile,
  input: { line: number; col: number } | { offset: number },
) => {
  if ("offset" in input) {
    const { offset } = input
    if (offset < 0 || offset >= sourceFile.getEnd()) {
      const lineCol = offsetToLineCol(sourceFile, Math.max(0, Math.min(offset, sourceFile.getEnd() - 1)))
      return Effect.fail(
        new PositionOutOfRangeError({
          file: sourceFile.fileName,
          line: lineCol.line,
          col: lineCol.col,
        }),
      )
    }
    return Effect.succeed({
      offset,
      lineCol: offsetToLineCol(sourceFile, offset),
    } satisfies Position)
  }

  const { line, col } = input
  const lineCount = getLineCount(sourceFile)

  if (line < 1 || line > lineCount || col < 1) {
    return Effect.fail(
      new PositionOutOfRangeError({
        file: sourceFile.fileName,
        line,
        col,
      }),
    )
  }

  const offset = lineColToOffset(sourceFile, { line, col })

  if (offset < 0 || offset >= sourceFile.getEnd()) {
    return Effect.fail(
      new PositionOutOfRangeError({
        file: sourceFile.fileName,
        line,
        col,
      }),
    )
  }

  return Effect.succeed({
    offset,
    lineCol: { line, col },
  } satisfies Position)
}

// -----------------------------------------------------------------------------
// AST node lookup
// -----------------------------------------------------------------------------

/** Find the most specific (deepest) AST node containing the given offset */
export const findNodeAtPosition = (
  sourceFile: ts.SourceFile,
  offset: number,
): ts.Node | undefined => {
  const find = (node: ts.Node): ts.Node | undefined => {
    if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
      return ts.forEachChild(node, find) ?? node
    }
    return undefined
  }
  return ts.forEachChild(sourceFile, find)
}

/** Find the smallest AST node that fully contains the given range */
export const findNodeForRange = (
  sourceFile: ts.SourceFile,
  startOffset: number,
  endOffset: number,
): ts.Node | undefined => {
  let best: ts.Node | undefined
  const find = (node: ts.Node): void => {
    const nodeStart = node.getStart(sourceFile)
    const nodeEnd = node.getEnd()
    if (nodeStart <= startOffset && nodeEnd >= endOffset) {
      best = node
      ts.forEachChild(node, find)
    }
  }
  ts.forEachChild(sourceFile, find)
  return best
}
