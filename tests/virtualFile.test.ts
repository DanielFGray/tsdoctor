import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const fixtureDir = path.resolve(import.meta.dirname, "fixtures")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("withVirtualFile", () => {
  it.live("provides completions from a virtual file", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const virtualPath = path.resolve(fixtureDir, "__explore__.ts")
      const content = `import { Effect } from "effect"\nEffect.`

      const completions = yield* lsm.withVirtualFile(
        fixtureFile,
        virtualPath,
        content,
        (service) => service.getCompletionsAtPosition(
          virtualPath,
          content.length,
          { includeCompletionsForModuleExports: false },
        ),
      )

      expect(completions).toBeDefined()
      const names = completions!.entries.map((e) => e.name)
      expect(names).toContain("gen")
      expect(names).toContain("map")
      expect(names).toContain("flatMap")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("virtual file is cleaned up after use", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const virtualPath = path.resolve(fixtureDir, "__explore_cleanup__.ts")

      yield* lsm.withVirtualFile(
        fixtureFile,
        virtualPath,
        "export const x = 1",
        () => "ok",
      )

      // After withVirtualFile, the virtual file should be gone
      // Trying to get diagnostics for it should fail or show errors
      const { service } = yield* lsm.getForFile(fixtureFile)
      const snapshot = service.getProgram()!.getSourceFile(virtualPath)
      expect(snapshot).toBeUndefined()
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("gets type info from a virtual expression", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const virtualPath = path.resolve(fixtureDir, "__explore_type__.ts")
      const content = `import { Schema } from "effect"\ntype _T = typeof Schema.Struct`

      const info = yield* lsm.withVirtualFile(
        fixtureFile,
        virtualPath,
        content,
        (service) => service.getQuickInfoAtPosition(virtualPath, content.length - 1),
      )

      expect(info).toBeDefined()
      expect(info!.displayParts!.map((p) => p.text).join("")).toContain("Struct")
    }).pipe(Effect.provide(testLayer)),
  )
})
