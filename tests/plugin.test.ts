import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileOnly } from "../src/fileContext.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/effect-plugin.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("language service plugin loading", () => {
  it.live("plugin is injected into the language service", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const { service } = yield* lsm.getForFile(fixtureFile)

      const marker = "@effect/language-service/injected"
      expect((service as Record<string, unknown>)[marker]).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("surfaces @effect/language-service diagnostics", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileOnly(lsm, fixtureFile)

      const diags = ctx.service.getSemanticDiagnostics(fixtureFile)
      const effectDiags = diags.filter((d) => d.source === "effect")

      expect(effectDiags.length).toBeGreaterThan(0)

      const msg = typeof effectDiags[0]!.messageText === "string"
        ? effectDiags[0]!.messageText
        : effectDiags[0]!.messageText.messageText
      expect(msg).toContain("Effect.void")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("effect diagnostics appear through get_diagnostics flow", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileOnly(lsm, fixtureFile)

      // This is the same path our MCP tool uses
      const semanticDiags = ctx.service.getSemanticDiagnostics(fixtureFile)
      const suggestionDiags = ctx.service.getSuggestionDiagnostics(fixtureFile)
      const allDiags = [...semanticDiags, ...suggestionDiags]

      const hasEffectDiag = allDiags.some((d) => d.source === "effect")
      expect(hasEffectDiag).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )
})
