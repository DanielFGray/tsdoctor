import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileContext } from "../src/fileContext.ts"
import { typeToTree, type TypeNode } from "../src/typeFormat.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

describe("expand_type", () => {
  it.live("depth 0 returns a reference for complex types", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `alice` (User type) at line 11 col 14
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 11,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 0)

      expect(tree.kind).toBe("reference")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("depth 1 expands object properties but property types are references", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 11,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 1)

      expect(tree.kind).toBe("object")
      if (tree.kind === "object") {
        expect(tree.properties.length).toBeGreaterThanOrEqual(2)
        // At depth 1, the budget is consumed expanding User → properties are references
        const nameProp = tree.properties.find((p) => p.name === "name")
        expect(nameProp?.type.kind).toBe("reference")
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("depth 2 fully expands primitive property types", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 11,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 2)

      expect(tree.kind).toBe("object")
      if (tree.kind === "object") {
        const nameProp = tree.properties.find((p) => p.name === "name")
        expect(nameProp?.type.kind).toBe("primitive")
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("higher depth expands nested types", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      // `getUser` returns User | null — at depth 3 we should see the union expanded
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 15,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const tree = typeToTree(ctx.checker, type, 3)

      expect(tree.kind).toBe("function")
      if (tree.kind === "function") {
        const returnType = tree.signatures[0].returnType
        expect(returnType.kind).toBe("union")
        if (returnType.kind === "union") {
          // Should contain an object (User) and null
          const kinds = returnType.members.map((m) => m.kind)
          expect(kinds).toContain("object")
          expect(kinds).toContain("primitive") // null

          // The object member should have expanded properties
          const objectMember = returnType.members.find(
            (m): m is TypeNode & { kind: "object" } => m.kind === "object",
          )
          expect(objectMember).toBeDefined()
          expect(objectMember!.properties.length).toBeGreaterThanOrEqual(2)
        }
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("different depths produce different detail levels", () =>
    Effect.gen(function* () {
      const lsm = yield* LanguageServiceManager
      const ctx = yield* resolveFileContext(lsm, fixtureFile, {
        line: 11,
        col: 14,
        offset: undefined,
      })

      const type = ctx.checker.getTypeAtLocation(ctx.node)
      const shallow = typeToTree(ctx.checker, type, 0)
      const deep = typeToTree(ctx.checker, type, 3)

      // Shallow should be a reference, deep should be fully expanded
      expect(shallow.kind).toBe("reference")
      expect(deep.kind).toBe("object")
    }).pipe(Effect.provide(testLayer)),
  )
})
