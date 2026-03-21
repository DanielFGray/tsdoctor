import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { resolveFileContext } from "../src/fileContext.ts"
import { typeToString } from "../src/typeFormat.ts"

const fixturesDir = path.resolve(import.meta.dirname, "fixtures")

const testLayer = LanguageServiceManager.layer.pipe(
  Layer.provide(TsConfigResolver.layer),
)

/** Offset of the `v` in `value` within `export const value = ...` */
const valueOffset = 13

/**
 * Write content and ensure mtime advances.
 * Some filesystems have 1-second mtime granularity, so we set
 * the mtime explicitly into the future to guarantee a change.
 */
const writeWithDistinctMtime = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, "utf-8")
  const future = new Date(Date.now() + 2000)
  fs.utimesSync(filePath, future, future)
}

const positionAt = (offset: number) => ({
  line: undefined as number | undefined,
  col: undefined as number | undefined,
  offset,
})

const getTypeAt = (
  lsm: LanguageServiceManager,
  file: string,
  offset: number,
) =>
  Effect.gen(function* () {
    const ctx = yield* resolveFileContext(lsm, file, positionAt(offset))
    const type = ctx.checker.getTypeAtLocation(ctx.node)
    return typeToString(ctx.checker, type, ctx.node)
  })

describe("staleness detection", () => {
  it.live("detects file changes via mtime and returns updated types", () =>
    Effect.gen(function* () {
      const tmpFile = path.join(fixturesDir, `__staleness_${Date.now()}.ts`)

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
        }),
      )

      // Phase 1: write a file with a number literal type
      fs.writeFileSync(tmpFile, "export const value = 42\n", "utf-8")

      const lsm = yield* LanguageServiceManager

      const type1 = yield* getTypeAt(lsm, tmpFile, valueOffset)
      expect(type1).toBe("42")

      // Phase 2: overwrite with a string literal type, ensuring mtime changes
      writeWithDistinctMtime(tmpFile, 'export const value = "hello"\n')

      const type2 = yield* getTypeAt(lsm, tmpFile, valueOffset)
      expect(type2).toBe('"hello"')

      // Phase 3: overwrite with a boolean literal type
      writeWithDistinctMtime(tmpFile, "export const value = true\n")

      const type3 = yield* getTypeAt(lsm, tmpFile, valueOffset)
      expect(type3).toBe("true")
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  )
})
