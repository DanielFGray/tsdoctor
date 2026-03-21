import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileContext, resolveServiceContext } from "../src/fileContext.ts"
import { typeToString, typeToTree } from "../src/typeFormat.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("resolveFileContext", () => {
  it.live("resolves type at a position", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `greeting` on line 1 col 14
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 1,
        col: 14,
        offset: undefined,
      })

      expect(ctx.node).toBeDefined()
      expect(ctx.warning).toBeNull()

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toBe('"hello"')
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves via offset", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // offset 13 should be the 'g' in 'greeting' (after 'export const ')
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: undefined,
        col: undefined,
        offset: 13,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const flat = typeToString(ctx.checker, type, ctx.node)
      expect(flat).toBe('"hello"')
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("returns typed error for nonexistent file", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const result = yield* resolveFileContext(lsm, "/nonexistent.ts", {
        line: 1,
        col: 1,
        offset: undefined,
      }).pipe(Effect.flip)

      expect(result._tag).toBe("FileNotInProgramError")
    }).pipe(Effect.provide(testLayer)),
  )
})

describe("resolveServiceContext", () => {
  it.live("provides language service and offset", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveServiceContext(lsm, fixtureFile, {
        line: 1,
        col: 14,
        offset: undefined,
      })

      expect(ctx.service).toBeDefined()
      expect(ctx.sourceFile).toBeDefined()
      expect(ctx.offset).toBeGreaterThan(0)
      expect(ctx.warning).toBeNull()
    }).pipe(Effect.provide(testLayer)),
  )
})

describe("end-to-end type queries", () => {
  it.live("resolves interface properties", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `alice` on line 11
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 11,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 2)

      expect(tree.kind).toBe("object")
      if (tree.kind === "object") {
        expect(tree.properties.map((p) => p.name)).toEqual(
          expect.arrayContaining(["name", "age", "email"]),
        )
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves union type", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `Status` on line 13
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 13,
        col: 13,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 2)

      expect(tree.kind).toBe("union")
      if (tree.kind === "union") {
        expect(tree.members).toHaveLength(3)
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("resolves function signature", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `getUser` on line 15
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 15,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 2)

      expect(tree.kind).toBe("function")
      if (tree.kind === "function") {
        const sig = tree.signatures[0]
        expect(sig.parameters[0].name).toBe("id")
        expect(sig.returnType.kind).toBe("union")
      }
    }).pipe(Effect.provide(testLayer)),
  )
})
