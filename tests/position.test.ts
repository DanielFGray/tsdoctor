import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as ts from "typescript"
import { PositionOutOfRangeError } from "../src/errors.ts"
import {
  findNodeAtPosition,
  lineColToOffset,
  offsetToLineCol,
  resolvePosition,
} from "../src/position.ts"

const source = `const x = 42
const y = "hello"
function add(a: number, b: number): number {
  return a + b
}
`

const sourceFile = ts.createSourceFile(
  "test.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
)

describe("position", () => {
  it("converts line:col to offset", () => {
    // Line 1, col 7 should be the 'x' in 'const x'
    const offset = lineColToOffset(sourceFile, { line: 1, col: 7 })
    expect(source[offset]).toBe("x")
  })

  it("converts offset to line:col", () => {
    const lineCol = offsetToLineCol(sourceFile, 6)
    expect(lineCol).toEqual({ line: 1, col: 7 })
  })

  it.effect("resolves from line:col input", () =>
    Effect.gen(function* () {
      const pos = yield* resolvePosition(sourceFile, { line: 2, col: 7 })
      expect(pos.lineCol).toEqual({ line: 2, col: 7 })
      expect(source[pos.offset]).toBe("y")
    }),
  )

  it.effect("resolves from offset input", () =>
    Effect.gen(function* () {
      const pos = yield* resolvePosition(sourceFile, { offset: 6 })
      expect(pos.offset).toBe(6)
      expect(pos.lineCol).toEqual({ line: 1, col: 7 })
    }),
  )
})

describe("position out-of-range", () => {
  it.effect("fails for line beyond file length", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { line: 9999, col: 1 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
      expect(result.line).toBe(9999)
      expect(result.col).toBe(1)
    }),
  )

  it.effect("fails for line 0 (below 1-based minimum)", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { line: 0, col: 1 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
      expect(result.line).toBe(0)
    }),
  )

  it.effect("fails for negative line", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { line: -1, col: 1 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
      expect(result.line).toBe(-1)
    }),
  )

  it.effect("fails for col 0 (below 1-based minimum)", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { line: 1, col: 0 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
      expect(result.col).toBe(0)
    }),
  )

  it.effect("fails for negative col", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { line: 1, col: -5 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
      expect(result.col).toBe(-5)
    }),
  )

  it.effect("fails for negative offset", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { offset: -1 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
    }),
  )

  it.effect("fails for offset beyond file length", () =>
    Effect.gen(function* () {
      const result = yield* resolvePosition(sourceFile, { offset: 99999 }).pipe(
        Effect.flip,
      )
      expect(result).toBeInstanceOf(PositionOutOfRangeError)
    }),
  )
})

describe("findNodeAtPosition", () => {
  it("finds the identifier node at a position", () => {
    // 'x' at line 1 col 7
    const offset = lineColToOffset(sourceFile, { line: 1, col: 7 })
    const node = findNodeAtPosition(sourceFile, offset)

    expect(node).toBeDefined()
    expect(node!.kind).toBe(ts.SyntaxKind.Identifier)
    expect(node!.getText(sourceFile)).toBe("x")
  })

  it("finds the string literal", () => {
    // "hello" at line 2 col 11
    const offset = lineColToOffset(sourceFile, { line: 2, col: 11 })
    const node = findNodeAtPosition(sourceFile, offset)

    expect(node).toBeDefined()
    expect(node!.kind).toBe(ts.SyntaxKind.StringLiteral)
  })

  it("finds function name", () => {
    // 'add' at line 3 col 10
    const offset = lineColToOffset(sourceFile, { line: 3, col: 10 })
    const node = findNodeAtPosition(sourceFile, offset)

    expect(node).toBeDefined()
    expect(node!.getText(sourceFile)).toBe("add")
  })
})
