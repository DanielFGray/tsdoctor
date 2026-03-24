import { Effect, HashMap, Layer, Option, pipe, Ref, ServiceMap } from "effect"
import * as ts from "typescript"
import * as fs from "node:fs"
import * as path from "node:path"
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
  readonly watcher: fs.FSWatcher | null
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
    readonly withVirtualFile: <A>(
      contextFile: string,
      virtualPath: string,
      content: string,
      fn: (service: ts.LanguageService) => A,
    ) => Effect.Effect<A>
    readonly evictIdle: (timeoutMs: number) => Effect.Effect<number>
    readonly invalidate: () => Effect.Effect<void>
    readonly disposeAll: () => Effect.Effect<void>
  }
>()("LanguageServiceManager") {
  static readonly layer = Layer.effect(
    LanguageServiceManager,
    Effect.gen(function* () {
      const resolver = yield* TsConfigResolver
      const cache = yield* Ref.make<ServiceCache>(HashMap.empty())

      const applyPlugins = (
        service: ts.LanguageService,
        host: LanguageServiceHostImpl,
        config: ResolvedTsConfig | null,
      ): ts.LanguageService => {
        const plugins = config?.compilerOptions.plugins as Array<{ name?: string }> | undefined
        if (!plugins || plugins.length === 0 || !config) return service

        const configDir = ts.sys.resolvePath(config.configPath + "/..")

        let wrapped = service
        for (const pluginEntry of plugins) {
          const pluginName = (pluginEntry as { name?: string }).name
          if (!pluginName) continue

          try {
            const resolved = require.resolve(pluginName, { paths: [configDir] })
            const factory = require(resolved) as (mod: { typescript: typeof ts }) => {
              create(info: Record<string, unknown>): ts.LanguageService
            }
            const pluginModule = factory({ typescript: ts })

            // Stub project with a no-op logger — the Effect plugin calls project.log()
            const stubProject = {
              log: () => {},
              projectService: null,
            }

            wrapped = pluginModule.create({
              languageService: wrapped,
              languageServiceHost: host,
              project: stubProject,
              serverHost: null,
              session: undefined,
              config: pluginEntry,
            })
          } catch {
            // Plugin not found or failed to load — continue without it
          }
        }
        return wrapped
      }

      const WATCHED_EXTENSIONS = new Set([
        ".ts", ".tsx", ".mts", ".cts",
        ".js", ".jsx", ".mjs", ".cjs",
        ".json", ".d.ts",
      ])

      const startWatcher = (
        projectDir: string,
        host: LanguageServiceHostImpl,
        onInvalidate: () => void,
      ): fs.FSWatcher | null => {
        try {
          const watcher = fs.watch(projectDir, { recursive: true }, (eventType, filename) => {
            if (!filename) return
            if (filename.includes("node_modules")) return

            // tsconfig changed — full invalidation needed
            if (filename === "tsconfig.json" || filename.endsWith("/tsconfig.json")) {
              onInvalidate()
              return
            }

            const ext = path.extname(filename)
            if (!WATCHED_EXTENSIONS.has(ext)) return

            const fullPath = path.resolve(projectDir, filename)

            if (eventType === "rename") {
              // rename fires for both create and delete
              if (ts.sys.fileExists(fullPath)) {
                host.ensureFile(fullPath)
                host.notifyFileChanged(fullPath)
              } else {
                host.notifyFileDeleted(fullPath)
              }
            } else {
              host.notifyFileChanged(fullPath)
            }
          })
          // Don't prevent process exit
          watcher.unref()
          return watcher
        } catch {
          return null
        }
      }

      const createService = (
        config: ResolvedTsConfig | null,
        fileNames: string[],
        onInvalidate: () => void,
      ): ManagedLanguageService => {
        const host = new LanguageServiceHostImpl(config, fileNames)
        const bareService = ts.createLanguageService(
          host,
          ts.createDocumentRegistry(),
        )
        const service = applyPlugins(bareService, host, config)

        const projectDir = config?.configPath
          ? ts.sys.resolvePath(config.configPath + "/..")
          : null
        const watcher = projectDir
          ? startWatcher(projectDir, host, onInvalidate)
          : null

        return {
          service,
          configPath: config?.configPath ?? null,
          host,
          watcher,
          lastAccessedAt: Date.now(),
        }
      }

      const disposeManaged = (managed: ManagedLanguageService): void => {
        managed.watcher?.close()
        managed.service.dispose()
      }

      /** Invalidate a single cache entry by key, triggered by tsconfig file watcher. */
      const invalidateKey = (key: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(cache)
          const existing = HashMap.get(state, key)
          if (Option.isSome(existing)) {
            disposeManaged(existing.value)
            yield* Ref.update(cache, HashMap.remove(key))
            yield* resolver.invalidate()
          }
        })

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
            managed.host.notifyFileChanged(absPath)
            managed.lastAccessedAt = Date.now()
            return { service: managed.service, warning }
          }

          const fileNames = config !== null
            ? [...config.fileNames]
            : [absPath]

          const managed = createService(config, fileNames, () => {
            Effect.runSync(invalidateKey(key))
          })
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
                    disposeManaged(managed)
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

      /** Drop all cached services and clear tsconfig cache. Next query rebuilds from scratch. */
      const invalidate = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(cache)
          HashMap.forEach(state, disposeManaged)
          yield* Ref.set(cache, HashMap.empty())
          yield* resolver.invalidate()
        })

      const disposeAll = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(cache)
          HashMap.forEach(state, disposeManaged)
          yield* Ref.set(cache, HashMap.empty())
        })

      const withVirtualFile = <A>(
        contextFile: string,
        virtualPath: string,
        content: string,
        fn: (service: ts.LanguageService) => A,
      ) =>
        Effect.gen(function* () {
          const absPath = ts.sys.resolvePath(contextFile)
          const { config } = yield* resolver.resolve(absPath)
          const key = config?.configPath ?? DEFAULT_KEY

          const state = yield* Ref.get(cache)
          const existing = HashMap.get(state, key)

          let managed: ManagedLanguageService
          if (Option.isSome(existing)) {
            managed = existing.value
          } else {
            const fileNames = config !== null ? [...config.fileNames] : [absPath]
            managed = createService(config, fileNames, () => {
              Effect.runSync(invalidateKey(key))
            })
            managed.host.ensureFile(absPath)
            yield* Ref.update(cache, HashMap.set(key, managed))
          }

          managed.host.setVirtualFile(virtualPath, content)
          try {
            return fn(managed.service)
          } finally {
            managed.host.removeVirtualFile(virtualPath)
          }
        })

      return { getForFile, withVirtualFile, evictIdle, invalidate, disposeAll }
    }),
  )
}
