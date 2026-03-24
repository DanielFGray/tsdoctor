import { describe, expect, it } from "@effect/vitest"
import { formatPlain } from "../src/cli/format.ts"

describe("formatPlain", () => {
  it("type — shows flat type string", () => {
    const json = JSON.stringify({ flat: '"hello"', tree: {}, position: {}, warning: null })
    expect(formatPlain("type", json)).toBe('"hello"')
  })

  it("quickinfo — shows display string", () => {
    const json = JSON.stringify({
      displayString: 'const x: number',
      documentation: "Some docs",
      tags: [{ name: "param", text: "n - the number" }],
      kind: "const",
      position: {},
      warning: null,
    })
    const result = formatPlain("quickinfo", json)
    expect(result).toContain("const x: number")
    expect(result).toContain("Some docs")
    expect(result).toContain("@param n - the number")
  })

  it("quickinfo — skips empty documentation", () => {
    const json = JSON.stringify({
      displayString: 'const x: number',
      documentation: "",
      tags: [],
      kind: "const",
      position: {},
      warning: null,
    })
    expect(formatPlain("quickinfo", json)).toBe("const x: number")
  })

  it("diagnostics — shows summary when errors exist", () => {
    const json = JSON.stringify({
      diagnostics: [],
      count: 1,
      summary: "file.ts(1,1): error TS2322: ...\n\nFound 1 error(s).",
      warning: null,
    })
    expect(formatPlain("diagnostics", json)).toContain("error TS2322")
  })

  it("diagnostics — shows 'No errors.' when clean", () => {
    const json = JSON.stringify({
      diagnostics: [],
      count: 0,
      summary: "",
      warning: null,
    })
    expect(formatPlain("diagnostics", json)).toBe("No errors.")
  })

  it("explain — shows diff tree", () => {
    const json = JSON.stringify({
      expected: "Expected",
      actual: "Actual",
      diff: {
        status: "object",
        properties: [
          { name: "age", diff: { status: "mismatch", expected: "number", actual: "string" } },
        ],
      },
      position: {},
      warning: null,
    })
    const result = formatPlain("explain", json)
    expect(result).toContain("Expected: Expected")
    expect(result).toContain("Actual:   Actual")
    expect(result).toContain("age:")
    expect(result).toContain("expected number, got string")
  })

  it("definition — shows file:line:col with kind", () => {
    const json = JSON.stringify({
      definitions: [{ file: "/foo.ts", line: 10, col: 5, name: "bar", kind: "const" }],
      position: {},
      warning: null,
    })
    expect(formatPlain("definition", json)).toBe("/foo.ts:10:5 (const bar)")
  })

  it("references — shows locations", () => {
    const json = JSON.stringify({
      references: [
        { file: "/foo.ts", line: 1, col: 1, isDefinition: true },
        { file: "/foo.ts", line: 5, col: 3, isDefinition: false },
      ],
      position: {},
      warning: null,
    })
    const result = formatPlain("references", json)
    expect(result).toContain("/foo.ts:1:1 (definition)")
    expect(result).toContain("/foo.ts:5:3")
    expect(result).not.toContain("/foo.ts:5:3 (definition)")
  })

  it("outline — shows indented symbol tree", () => {
    const json = JSON.stringify({
      symbols: [
        {
          name: "User",
          kind: "interface",
          line: 1,
          col: 1,
          depth: 0,
          children: [
            { name: "name", kind: "property", line: 2, col: 3 },
          ],
        },
      ],
      warning: null,
    })
    const result = formatPlain("outline", json)
    expect(result).toContain("interface User (1:1)")
    expect(result).toContain("  property name (2:3)")
  })

  it("passes through non-JSON text unchanged", () => {
    expect(formatPlain("type", "not json")).toBe("not json")
  })
})
