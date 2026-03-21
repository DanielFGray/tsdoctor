import { describe, expect, it } from "@effect/vitest"
import * as ts from "typescript"
import * as path from "node:path"
import { typeToString, typeToTree } from "../src/typeFormat.ts"
import { lineColToOffset } from "../src/position.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const fixtureConfig = path.resolve(import.meta.dirname, "fixtures/tsconfig.json")

const getCheckerAndFile = () => {
  const configFile = ts.readConfigFile(fixtureConfig, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(fixtureConfig),
  )
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(fixtureFile)!
  return { checker, sourceFile, program }
}

const getTypeAt = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  line: number,
  col: number,
) => {
  const offset = lineColToOffset(sourceFile, { line, col })
  const node = ts.forEachChild(sourceFile, function find(n): ts.Node | undefined {
    if (offset >= n.getStart(sourceFile) && offset < n.getEnd()) {
      return ts.forEachChild(n, find) ?? n
    }
    return undefined
  })!
  return { type: checker.getTypeAtLocation(node), node }
}

describe("typeToString", () => {
  it("formats a string literal type", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `greeting` on line 1 col 14
    const { type, node } = getTypeAt(checker, sourceFile, 1, 14)
    const result = typeToString(checker, type, node)
    expect(result).toBe('"hello"')
  })

  it("formats a number type", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `count` on line 3 col 14
    const { type, node } = getTypeAt(checker, sourceFile, 3, 14)
    const result = typeToString(checker, type, node)
    expect(result).toBe("42")
  })
})

describe("typeToTree", () => {
  it("returns primitive for string literal", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    const { type } = getTypeAt(checker, sourceFile, 1, 14)
    const tree = typeToTree(checker, type)
    expect(tree).toEqual({ kind: "literal", value: "hello" })
  })

  it("returns object with properties for User", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `alice` on line 11 col 14
    const { type } = getTypeAt(checker, sourceFile, 11, 14)
    const tree = typeToTree(checker, type, 2)

    expect(tree.kind).toBe("object")
    if (tree.kind === "object") {
      const names = tree.properties.map((p) => p.name)
      expect(names).toContain("name")
      expect(names).toContain("age")
      expect(names).toContain("email")

      const emailProp = tree.properties.find((p) => p.name === "email")
      expect(emailProp?.optional).toBe(true)
    }
  })

  it("returns union for Status type", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `Status` type alias — find it via the type declaration on line 13
    // We need to find the type of the Status identifier
    const offset = lineColToOffset(sourceFile, { line: 13, col: 13 })
    const node = ts.forEachChild(sourceFile, function find(n): ts.Node | undefined {
      if (offset >= n.getStart(sourceFile) && offset < n.getEnd()) {
        return ts.forEachChild(n, find) ?? n
      }
      return undefined
    })!
    const type = checker.getTypeAtLocation(node)
    const tree = typeToTree(checker, type, 2)

    expect(tree.kind).toBe("union")
    if (tree.kind === "union") {
      expect(tree.members).toHaveLength(3)
      expect(tree.members.every((m) => m.kind === "literal")).toBe(true)
    }
  })

  it("respects depth limit", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // At depth 0, User should be a reference
    const { type } = getTypeAt(checker, sourceFile, 11, 14)
    const shallow = typeToTree(checker, type, 0)
    expect(shallow.kind).toBe("reference")
  })

  it("returns function signature", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `getUser` on line 15 col 14
    const { type } = getTypeAt(checker, sourceFile, 15, 14)
    const tree = typeToTree(checker, type, 2)

    expect(tree.kind).toBe("function")
    if (tree.kind === "function") {
      expect(tree.signatures).toHaveLength(1)
      expect(tree.signatures[0].parameters).toHaveLength(1)
      expect(tree.signatures[0].parameters[0].name).toBe("id")
    }
  })

  it("returns reference for type alias (Pair)", () => {
    const { checker, sourceFile } = getCheckerAndFile()
    // `pair` on line 22 col 14 — typed as Pair<string, number>
    const { type } = getTypeAt(checker, sourceFile, 22, 14)
    const tree = typeToTree(checker, type, 2)

    // Pair is a generic type alias reference
    expect(tree.kind).toBe("reference")
    if (tree.kind === "reference") {
      expect(tree.name).toContain("Pair")
    }
  })
})
