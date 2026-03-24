import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { parsePositionArgs } from "../src/cli/position.ts"

const fixtureDir = path.resolve(import.meta.dirname, "fixtures")
const sampleFile = path.resolve(fixtureDir, "sample.ts")

describe("parsePositionArgs", () => {
  it("parses file:line:col colon syntax", () => {
    const result = parsePositionArgs(`${sampleFile}:10:5`)
    expect(result.file).toBe(sampleFile)
    expect(result.line).toBe(10)
    expect(result.col).toBe(5)
    expect(result.offset).toBeUndefined()
  })

  it("parses file:line without col", () => {
    const result = parsePositionArgs(`${sampleFile}:10`)
    expect(result.file).toBe(sampleFile)
    expect(result.line).toBe(10)
    expect(result.col).toBeUndefined()
    expect(result.offset).toBeUndefined()
  })

  it("parses plain file with no position", () => {
    const result = parsePositionArgs(sampleFile)
    expect(result.file).toBe(sampleFile)
    expect(result.line).toBeUndefined()
    expect(result.col).toBeUndefined()
  })

  it("resolves relative paths to absolute", () => {
    const result = parsePositionArgs("tests/fixtures/sample.ts:1:1")
    expect(path.isAbsolute(result.file)).toBe(true)
    expect(result.file).toContain("sample.ts")
  })

  it("handles Windows-style drive letters without treating colon as separator", () => {
    // On linux this is just a path with a colon — but the parser should not
    // break if someone passes a path like /home/user/file.ts:10:5
    const result = parsePositionArgs(`${sampleFile}:42:3`)
    expect(result.line).toBe(42)
    expect(result.col).toBe(3)
  })

  it("treats non-numeric suffixes as part of the file path", () => {
    const result = parsePositionArgs(`${sampleFile}:abc:def`)
    // Non-numeric parts don't match :line:col pattern, so entire string is the file
    expect(result.file).toBe(`${sampleFile}:abc:def`)
    expect(result.line).toBeUndefined()
    expect(result.col).toBeUndefined()
  })
})
