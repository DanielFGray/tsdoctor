import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileContext, resolveServiceContext } from "../src/fileContext.ts"
import { typeToString } from "../src/typeFormat.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("symbol-based lookup", () => {
  it.live("resolves a top-level variable by name", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "greeting",
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toBe('"hello"')
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves a function by name", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "getUser",
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toContain("User")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves an interface by name", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "User",
      })

      expect(ctx.node).toBeDefined()
      expect(ctx.position.lineCol.line).toBe(5)
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves a class method via dot notation", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "Calculator.add",
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toContain("number")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("returns SymbolNotFoundError for missing symbol", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const result = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "nonExistent",
      }).pipe(Effect.flip)

      expect(result._tag).toBe("SymbolNotFoundError")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("position takes precedence over symbol", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // line 3, col 14 is `count` — should resolve to count even if symbol says "greeting"
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 3,
        col: 14,
        offset: undefined,
        symbol: "greeting",
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toBe("42")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("works with resolveServiceContext too", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: undefined,
        symbol: "getUser",
      })

      // Should resolve to an offset within the getUser function
      expect(ctx.offset).toBeGreaterThan(0)
      expect(ctx.position.lineCol.line).toBe(15)
    }).pipe(Effect.provide(testLayer)),
  )
})
