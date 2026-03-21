import { Effect, HashMap, Layer, Option, pipe, Ref, ServiceMap } from "effect"
import * as ts from "typescript"
import { type ResolvedTsConfig, TsConfigResolver } from "./TsConfigResolver.ts"
import { LanguageServiceHostImpl } from "./LanguageServiceHost.ts"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * A ManagedLanguageService wraps a ts.LanguageService with lifecycle metadata.
 *
 * This is intentionally a mutable handle — the TS compiler API requires
 * imperative interaction. The host, service, and lastAccessedAt are all
 * mutated in place rather than through the Ref. The Ref tracks which
 * entries exist in the cache; the entries themselves are mutable.
 */
interface ManagedLanguageService {
  readonly service: ts.LanguageService
  readonly configPath: string | null
  readonly host: LanguageServiceHostImpl
  lastAccessedAt: number
}

// -----------------------------------------------------------------------------
// Cache state
// -----------------------------------------------------------------------------

/** Key is tsconfig path, or "__default__" for files with no tsconfig */
const DEFAULT_KEY = "__default__"

type ServiceCache = HashMap.HashMap<string, ManagedLanguageService>

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class LanguageServiceManager extends ServiceMap.Service<
  LanguageServiceManager,
  {
    readonly getForFile: (filePath: string) => Effect.Effect<{
      readonly service: ts.LanguageService
      readonly warning: string | null
    }>
    readonly evictIdle: (timeoutMs: number) => Effect.Effect<number>
    readonly disposeAll: () => Effect.Effect<void>
  }
>()("LanguageServiceManager") {
  static readonly layer = Layer.effect(
    LanguageServiceManager,
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const cache = yield* Ref.make<ServiceCache>(HashMap.empty())

      const createService = (
        config: ResolvedTsConfig | null,
        fileNames: string[],
      ): ManagedLanguageService => {
        const host = new LanguageServiceHostImpl(config, fileNames)
        const service = ts.createLanguageService(
          host,
          ts.createDocumentRegistry(),
        )
        return {
          service,
          configPath: config?.configPath ?? null,
          host,
          lastAccessedAt: Date.now(),
        }
      }

      const getForFile = (filePath: string) =>
        Effect.gen(function* () {
          const absPath = ts.sys.resolvePath(filePath)
          const { config, warning } = yield* resolver.resolve(absPath)
          const key = config?.configPath ?? DEFAULT_KEY

          const state = yield* Ref.get(cache)
          const existing = HashMap.get(state, key)

          if (Option.isSome(existing)) {
            const managed = existing.value
            managed.host.ensureFile(absPath)
            managed.host.refreshVersions()
            managed.lastAccessedAt = Date.now()
            return { service: managed.service, warning }
          }

          const fileNames = config !== null
            ? [...config.fileNames]
            : [absPath]

          const managed = createService(config, fileNames)
          managed.host.ensureFile(absPath)
          yield* Ref.update(cache, HashMap.set(key, managed))
          return { service: managed.service, warning }
        })

      const evictIdle = (timeoutMs: number) =>
        Effect.gen(function* () {
          const now = Date.now()
          const state = yield* Ref.get(cache)

          const { kept, evicted } = pipe(
            HashMap.toEntries(state),
            (entries) =>
              entries.reduce(
                (acc, [key, managed]) => {
                  if (now - managed.lastAccessedAt > timeoutMs) {
                    managed.service.dispose()
                    return { ...acc, evicted: [...acc.evicted, key] }
                  }
                  return {
                    ...acc,
                    kept: HashMap.set(acc.kept, key, managed),
                  }
                },
                {
                  kept: HashMap.empty<string, ManagedLanguageService>(),
                  evicted: [] as string[],
                },
              ),
          )

          yield* Ref.set(cache, kept)
          return evicted.length
        })

      const disposeAll = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(cache)
          HashMap.forEach(state, (managed) => managed.service.dispose())
          yield* Ref.set(cache, HashMap.empty())
        })

      return { getForFile, evictIdle, disposeAll }
    }),
  )
}
