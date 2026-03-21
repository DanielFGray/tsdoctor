import { Effect, HashMap, Layer, Option, pipe, Ref, ServiceMap } from "effect"
import * as ts from "typescript"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ResolvedTsConfig {
  readonly configPath: string
  readonly compilerOptions: ts.CompilerOptions
  readonly fileNames: ReadonlyArray<string>
  readonly projectReferences: ReadonlyArray<ts.ProjectReference> | undefined
}

export const defaultCompilerOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
}

export interface ResolveResult {
  readonly config: ResolvedTsConfig | null
  readonly warning: string | null
}

// -----------------------------------------------------------------------------
// Pure functions
// -----------------------------------------------------------------------------

const findConfigForFile = (filePath: string): string | null =>
  ts.findConfigFile(
    ts.sys.resolvePath(filePath + "/.."),
    ts.sys.fileExists,
    "tsconfig.json",
  ) ?? null

const parseConfig = (configPath: string): ResolvedTsConfig => {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  const configDir = ts.sys.resolvePath(configPath + "/..")
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir,
    undefined,
    configPath,
  )
  return {
    configPath,
    compilerOptions: parsed.options,
    fileNames: parsed.fileNames,
    projectReferences: parsed.projectReferences,
  }
}

// -----------------------------------------------------------------------------
// Cache state
// -----------------------------------------------------------------------------

interface CacheState {
  readonly configs: HashMap.HashMap<string, ResolvedTsConfig>
  readonly fileToConfig: HashMap.HashMap<string, string | null>
}

const emptyCache: CacheState = {
  configs: HashMap.empty(),
  fileToConfig: HashMap.empty(),
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class TsConfigResolver extends ServiceMap.Service<
  TsConfigResolver,
  {
    readonly resolve: (filePath: string) => Effect.Effect<ResolveResult>
    readonly invalidate: () => Effect.Effect<void>
  }
>()("TsConfigResolver") {
  static readonly layer = Layer.effect(
    TsConfigResolver,
    Effect.gen(function* () {
      const cache = yield* Ref.make(emptyCache)

      const resolve = (filePath: string): Effect.Effect<ResolveResult> =>
        Effect.gen(function* () {
          const absPath = ts.sys.resolvePath(filePath)
          const state = yield* Ref.get(cache)

          const cachedMapping = HashMap.get(state.fileToConfig, absPath)
          if (Option.isNone(cachedMapping)) {
            return yield* resolveAndCache(absPath)
          }

          const configPath = cachedMapping.value
          if (configPath === null) {
            return {
              config: null,
              warning: `No tsconfig.json found for ${absPath}. Using default compiler options.`,
            }
          }

          return pipe(
            HashMap.get(state.configs, configPath),
            Option.match({
              onNone: () => ({ config: parseConfig(configPath), warning: null }),
              onSome: (config) => ({ config, warning: null }),
            }),
          )
        })

      const resolveAndCache = (absPath: string): Effect.Effect<ResolveResult> =>
        Effect.sync(() => {
          const configPath = findConfigForFile(absPath)

          if (configPath === null) {
            return { configPath: null as string | null, config: null }
          }

          const config = parseConfig(configPath)
          return { configPath: configPath as string | null, config }
        }).pipe(
          Effect.tap(({ configPath, config }) =>
            Ref.update(cache, (state) => ({
              configs: config !== null
                ? HashMap.set(state.configs, configPath!, config)
                : state.configs,
              fileToConfig: HashMap.set(state.fileToConfig, absPath, configPath),
            })),
          ),
          Effect.map(({ config, configPath }) =>
            config === null
              ? {
                config: null,
                warning: `No tsconfig.json found for ${absPath}. Using default compiler options.`,
              }
              : { config, warning: null },
          ),
        )

      const invalidate = () => Ref.set(cache, emptyCache)

      return { resolve, invalidate }
    }),
  )
}
