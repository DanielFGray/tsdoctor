import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileOnly } from "../src/fileContext.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const errorFile = path.resolve(import.meta.dirname, "fixtures/with-errors.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("get_diagnostics", () => {
  it.live("returns no diagnostics for a valid file", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileOnly(lsm, fixtureFile)

      const diagnostics = ctx.service.getSemanticDiagnostics(fixtureFile)

      expect(diagnostics).toHaveLength(0)
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("returns diagnostics for a file with type errors", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const { service } = yield* lsm.getForFile(errorFile)

      const diagnostics = service.getSemanticDiagnostics(errorFile)

      expect(diagnostics.length).toBeGreaterThanOrEqual(2)

      diagnostics.forEach((d) => {
        expect(d.category).toBe(1) // DiagnosticCategory.Error
      })
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("diagnostics contain file and position info", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const { service } = yield* lsm.getForFile(errorFile)

      const diagnostics = service.getSemanticDiagnostics(errorFile)
      const first = diagnostics[0]!

      expect(first.file).toBeDefined()
      expect(first.file!.fileName).toBe(errorFile)
      expect(first.start).toBeDefined()
      expect(first.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("diagnostic messageText contains type information", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const { service } = yield* lsm.getForFile(errorFile)

      const diagnostics = service.getSemanticDiagnostics(errorFile)
      const messages = diagnostics.map((d) =>
        typeof d.messageText === "string"
          ? d.messageText
          : d.messageText.messageText,
      )

      expect(messages.some((m) => m.includes("number") || m.includes("string"))).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )
})
