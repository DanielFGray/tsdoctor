import * as ts from "typescript"
import { type ResolvedTsConfig, defaultCompilerOptions } from "./TsConfigResolver.ts"

/**
 * LanguageServiceHost bridges the TS compiler API's imperative interface.
 *
 * This is intentionally a mutable class — the TS LanguageService requires its
 * host to track file versions and project state mutably. Methods like
 * ensureFile() and refreshVersions() mutate in place so the LanguageService
 * picks up changes on next query.
 */
export class LanguageServiceHostImpl implements ts.LanguageServiceHost {
  private readonly versions = new Map<string, string>()
  private projectVersion = 0

  constructor(
    private readonly config: ResolvedTsConfig | null,
    private readonly fileNames: string[],
  ) {}

  getCompilationSettings(): ts.CompilerOptions {
    return this.config?.compilerOptions ?? defaultCompilerOptions
  }

  getScriptFileNames(): string[] {
    return this.fileNames
  }

  getProjectVersion(): string {
    return String(this.projectVersion)
  }

  getScriptVersion(fileName: string): string {
    const cached = this.versions.get(fileName)
    if (cached !== undefined) return cached

    const version = this.computeVersion(fileName)
    this.versions.set(fileName, version)
    return version
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const content = ts.sys.readFile(fileName)
    return content !== undefined
      ? ts.ScriptSnapshot.fromString(content)
      : undefined
  }

  getCurrentDirectory(): string {
    return this.config !== undefined && this.config !== null
      ? ts.sys.resolvePath(this.config.configPath + "/..")
      : ts.sys.getCurrentDirectory()
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options)
  }

  readFile(path: string, encoding?: string): string | undefined {
    return ts.sys.readFile(path, encoding)
  }

  fileExists(path: string): boolean {
    return ts.sys.fileExists(path)
  }

  readDirectory(
    path: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[] {
    return ts.sys.readDirectory(path, extensions, exclude, include, depth)
  }

  getDirectories(directoryName: string): string[] {
    return ts.sys.getDirectories(directoryName)
  }

  useCaseSensitiveFileNames(): boolean {
    return ts.sys.useCaseSensitiveFileNames
  }

  realpath(path: string): string {
    return ts.sys.realpath?.(path) ?? path
  }

  /**
   * Refresh versions for tracked files by re-checking mtime.
   * Returns true if any file changed.
   */
  refreshVersions(): boolean {
    let changed = false
    this.fileNames.forEach((fileName) => {
      const oldVersion = this.versions.get(fileName)
      const newVersion = this.computeVersion(fileName)
      if (oldVersion !== newVersion) {
        this.versions.set(fileName, newVersion)
        changed = true
      }
    })
    if (changed) {
      this.projectVersion++
    }
    return changed
  }

  /** Add a file that isn't in the tsconfig's file list (e.g. loose file) */
  ensureFile(fileName: string): void {
    if (!this.fileNames.includes(fileName)) {
      this.fileNames.push(fileName)
      this.projectVersion++
    }
  }

  private computeVersion(fileName: string): string {
    const mtime = ts.sys.getModifiedTime?.(fileName)
    return mtime !== undefined ? String(mtime.getTime()) : "0"
  }
}
