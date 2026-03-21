import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import * as path from "node:path"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const fixtureConfig = path.resolve(import.meta.dirname, "fixtures/tsconfig.json")

describe("TsConfigResolver", () => {
  it.live("resolves tsconfig for a file in a project", () =>
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const result = yield* resolver.resolve(fixtureFile)

      expect(result.warning).toBeNull()
      expect(result.config).not.toBeNull()
      expect(result.config!.configPath).toBe(fixtureConfig)
      expect(result.config!.compilerOptions.strict).toBe(true)
    }).pipe(Effect.provide(TsConfigResolver.layer)),
  )

  it.live("returns warning for file with no tsconfig", () =>
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const result = yield* resolver.resolve("/tmp/nonexistent-project/foo.ts")

      expect(result.config).toBeNull()
      expect(result.warning).toContain("No tsconfig.json found")
    }).pipe(Effect.provide(TsConfigResolver.layer)),
  )

  it.live("caches resolved configs", () =>
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const first = yield* resolver.resolve(fixtureFile)
      const second = yield* resolver.resolve(fixtureFile)

      expect(first.config).toBe(second.config)
    }).pipe(Effect.provide(TsConfigResolver.layer)),
  )

  it.live("invalidate clears cache", () =>
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const first = yield* resolver.resolve(fixtureFile)
      yield* resolver.invalidate()
      const second = yield* resolver.resolve(fixtureFile)

      // After invalidation, should be a fresh parse (different object identity)
      expect(first.config).not.toBe(second.config)
      // But same content
      expect(first.config!.configPath).toBe(second.config!.configPath)
    }).pipe(Effect.provide(TsConfigResolver.layer)),
  )
})
