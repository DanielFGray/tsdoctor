import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveServiceContext } from "../src/fileContext.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("get_quickinfo", () => {
  it.live("returns display string and documentation for a variable", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `greeting` at line 1 col 14
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 1,
        col: 14,
        offset: undefined,
      })

      const info = ctx.service.getQuickInfoAtPosition(fixtureFile, ctx.offset)

      expect(info).toBeDefined()
      expect(info!.displayParts).toBeDefined()
      const displayText = info!.displayParts!.map((p) => p.text).join("")
      expect(displayText).toContain("greeting")
      // greeting is const "hello" (string literal type)
      expect(displayText).toContain("hello")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("returns kind information", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `getUser` function at line 15 col 14
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 15,
        col: 14,
        offset: undefined,
      })

      const info = ctx.service.getQuickInfoAtPosition(fixtureFile, ctx.offset)

      expect(info).toBeDefined()
      expect(info!.kind).toBe("const")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("returns interface member info", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `name` inside User interface at line 6 col 12
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 6,
        col: 12,
        offset: undefined,
      })

      const info = ctx.service.getQuickInfoAtPosition(fixtureFile, ctx.offset)

      expect(info).toBeDefined()
      const displayText = info!.displayParts!.map((p) => p.text).join("")
      expect(displayText).toContain("name")
      expect(displayText).toContain("string")
    }).pipe(Effect.provide(testLayer)),
  )
})
