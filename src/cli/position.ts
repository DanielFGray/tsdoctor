import * as path from "node:path"

export interface ParsedPosition {
  readonly file: string
  readonly line?: number | undefined
  readonly col?: number | undefined
  readonly offset?: number | undefined
}

/**
 * Parse a position string in the format `file:line:col`, `file:line`, or just `file`.
 * Resolves relative paths to absolute using cwd.
 */
export const parsePositionArgs = (input: string): ParsedPosition => {
  // Try to split off :line:col from the end
  // Match: ...:<digits> or ...:<digits>:<digits>
  const match = input.match(/^(.+?):(\d+)(?::(\d+))?$/)

  if (match) {
    const [, filePart, linePart, colPart] = match
    const line = parseInt(linePart!, 10)
    const col = colPart !== undefined ? parseInt(colPart, 10) : undefined

    return {
      file: resolvePath(filePart!),
      line: Number.isFinite(line) ? line : undefined,
      col: col !== undefined && Number.isFinite(col) ? col : undefined,
    }
  }

  return { file: resolvePath(input) }
}

const resolvePath = (p: string): string =>
  path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
