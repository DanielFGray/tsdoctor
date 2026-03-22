import { describe, expect, it } from "@effect/vitest"
import * as ts from "typescript"
import * as path from "node:path"
import { diffTypes, extractMismatchTypes } from "../src/typeDiff.ts"

const mismatchFile = path.resolve(import.meta.dirname, "fixtures/type-mismatch.ts")
const fixtureConfig = path.resolve(import.meta.dirname, "fixtures/tsconfig.json")

const setup = () => {
  const configFile = ts.readConfigFile(fixtureConfig, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(fixtureConfig),
  )
  const program = ts.createProgram([...parsed.fileNames, mismatchFile], parsed.options)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(mismatchFile)!
  const diagnostics = program.getSemanticDiagnostics(sourceFile)
  return { program, checker, sourceFile, diagnostics }
}

describe("extractMismatchTypes", () => {
  it("extracts expected and actual types from a TS2322 diagnostic", () => {
    const { checker, sourceFile, diagnostics } = setup()
    const diag = diagnostics.find((d) => d.code === 2322)!
    expect(diag).toBeDefined()

    const result = extractMismatchTypes(checker, sourceFile, diag)
    expect(result).not.toBeNull()
    expect(checker.typeToString(result!.expected)).toBe("Expected")
    expect(checker.typeToString(result!.actual)).toBe("Actual")
  })
})

describe("diffTypes", () => {
  it("finds all mismatched properties", () => {
    const { checker, sourceFile, diagnostics } = setup()
    const diag = diagnostics.find((d) => d.code === 2322)!
    const types = extractMismatchTypes(checker, sourceFile, diag)!

    const diff = diffTypes(checker, types.expected, types.actual)

    expect(diff.status).toBe("object")
    if (diff.status === "object") {
      const names = diff.properties.map((p) => p.name)
      // Should find both age AND address mismatches (TS only reports the first one)
      expect(names).toContain("age")
      expect(names).toContain("address")
    }
  })

  it("shows the exact mismatch for primitive property", () => {
    const { checker, sourceFile, diagnostics } = setup()
    const diag = diagnostics.find((d) => d.code === 2322)!
    const types = extractMismatchTypes(checker, sourceFile, diag)!

    const diff = diffTypes(checker, types.expected, types.actual)

    if (diff.status === "object") {
      const ageDiff = diff.properties.find((p) => p.name === "age")!
      expect(ageDiff.diff.status).toBe("mismatch")
      if (ageDiff.diff.status === "mismatch") {
        expect(ageDiff.diff.expected).toBe("number")
        expect(ageDiff.diff.actual).toBe("string")
      }
    }
  })

  it("recurses into nested object mismatches", () => {
    const { checker, sourceFile, diagnostics } = setup()
    const diag = diagnostics.find((d) => d.code === 2322)!
    const types = extractMismatchTypes(checker, sourceFile, diag)!

    const diff = diffTypes(checker, types.expected, types.actual)

    if (diff.status === "object") {
      const addressDiff = diff.properties.find((p) => p.name === "address")!
      expect(addressDiff.diff.status).toBe("object")
      if (addressDiff.diff.status === "object") {
        const streetDiff = addressDiff.diff.properties.find((p) => p.name === "street")!
        expect(streetDiff.diff.status).toBe("mismatch")
        if (streetDiff.diff.status === "mismatch") {
          expect(streetDiff.diff.expected).toBe("string")
          expect(streetDiff.diff.actual).toBe("number")
        }
      }
    }
  })

  it("returns match for compatible types", () => {
    const { checker, sourceFile } = setup()
    const stringType = checker.getStringType()
    const diff = diffTypes(checker, stringType, stringType)
    expect(diff.status).toBe("match")
  })
})
