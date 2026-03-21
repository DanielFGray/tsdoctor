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

describe("get_completions", () => {
  it.live("returns completions at a position", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // End of line 2 (blank line) — trigger completions in statement position
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 2,
        col: 1,
        offset: undefined,
      })

      const completions = ctx.service.getCompletionsAtPosition(
        fixtureFile,
        ctx.offset,
        undefined,
      )

      expect(completions).toBeDefined()
      expect(completions!.entries.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("completions include expected names", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // Position at the start of an empty line or after a keyword
      // to get global completions
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 1,
        col: 1,
        offset: undefined,
      })

      const completions = ctx.service.getCompletionsAtPosition(
        fixtureFile,
        ctx.offset,
        undefined,
      )

      expect(completions).toBeDefined()
      const names = completions!.entries.map((e) => e.name)
      // Should include the file's own exports
      expect(names).toContain("greeting")
    }).pipe(Effect.provide(testLayer)),
  )
})
