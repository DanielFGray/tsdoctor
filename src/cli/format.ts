/**
 * Plaintext formatters for CLI output.
 * Each function takes the parsed JSON content from an MCP tool response
 * and returns a human-readable string.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const tryParse = (text: string): JsonValue | null => {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}

export const formatPlain = (command: string, text: string): string => {
  const data = tryParse(text)
  if (data === null) return text

  switch (command) {
    case "type": return formatType(data)
    case "quickinfo": return formatQuickinfo(data)
    case "diagnostics": return formatDiagnostics(data)
    case "typecheck": return formatTypecheck(data)
    case "explain": return formatExplain(data)
    case "definition": return formatDefinition(data)
    case "references": return formatReferences(data)
    case "outline": return formatOutline(data)
    case "expand": return formatType(data)
    case "exports": return formatExports(data)
    case "completions": return formatCompletions(data)
    case "signature": return formatSignature(data)
    case "rename": return formatRename(data)
    case "file-references": return formatFileReferences(data)
    case "call-hierarchy": return formatCallHierarchy(data)
    case "code-fixes": return formatCodeFixes(data)
    case "organize-imports": return formatOrganizeImports(data)
    case "fix-all": return formatFixAll(data)
    case "refactor": return formatRefactor(data)
    case "explore": return formatExplore(data)
    default: return text
  }
}

// ── type / expand ──────────────────────────────────────────────────────────

const formatType = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  return String(obj.flat ?? "")
}

// ── quickinfo ──────────────────────────────────────────────────────────────

const formatQuickinfo = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const lines: string[] = []
  if (obj.displayString) lines.push(String(obj.displayString))
  if (obj.documentation && String(obj.documentation).length > 0) {
    lines.push("")
    lines.push(String(obj.documentation))
  }
  const tags = obj.tags as Array<{ name: string; text: string }> | undefined
  if (tags && tags.length > 0) {
    lines.push("")
    tags.forEach((t) => lines.push(`@${t.name} ${t.text}`))
  }
  return lines.join("\n")
}

// ── diagnostics ────────────────────────────────────────────────────────────

const formatDiagnostics = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  if (obj.count === 0) return "No errors."
  return String(obj.summary ?? "")
}

// ── typecheck ──────────────────────────────────────────────────────────────

const formatTypecheck = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  if (obj.pass === true) return "No errors."

  const lines: string[] = []
  lines.push(String(obj.summary ?? ""))

  const fileErrors = obj.fileErrors as Array<{ file: string; count: number }> | undefined
  if (fileErrors && fileErrors.length > 0) {
    lines.push("")
    lines.push("Files:")
    fileErrors.forEach((f) => lines.push(`  ${f.file}: ${f.count} error(s)`))
  }

  const errorCodes = obj.errorCodes as Array<{ code: number; message: string; count: number }> | undefined
  if (errorCodes && errorCodes.length > 0) {
    lines.push("")
    lines.push("Error codes:")
    errorCodes.forEach((e) => lines.push(`  TS${e.code}: ${e.count}x — ${e.message}`))
  }

  return lines.join("\n")
}

// ── explain ────────────────────────────────────────────────────────────────

const formatExplain = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const lines: string[] = []
  lines.push(`Expected: ${obj.expected}`)
  lines.push(`Actual:   ${obj.actual}`)
  lines.push("")
  if (obj.diff) {
    formatDiff(obj.diff as Record<string, JsonValue>, 0, lines)
  }
  return lines.join("\n")
}

const formatDiff = (
  diff: Record<string, JsonValue>,
  depth: number,
  lines: string[],
): void => {
  const indent = "  ".repeat(depth)
  switch (diff.status) {
    case "match":
      lines.push(`${indent}✓ ${diff.type}`)
      break
    case "mismatch":
      lines.push(`${indent}✗ expected ${diff.expected}, got ${diff.actual}`)
      break
    case "missing":
      lines.push(`${indent}✗ missing (expected ${diff.expected})`)
      break
    case "extra":
      lines.push(`${indent}✗ extra (${diff.actual})`)
      break
    case "object": {
      const props = diff.properties as Array<{ name: string; diff: Record<string, JsonValue> }>
      props.forEach((p) => {
        lines.push(`${indent}${p.name}:`)
        formatDiff(p.diff, depth + 1, lines)
      })
      break
    }
  }
}

// ── definition ─────────────────────────────────────────────────────────────

const formatDefinition = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const defs = obj.definitions as Array<Record<string, JsonValue>>
  if (!defs || defs.length === 0) return "No definition found."
  return defs.map((d) => {
    const loc = `${d.file}:${d.line}:${d.col}`
    const label = [d.kind, d.name].filter(Boolean).join(" ")
    return label ? `${loc} (${label})` : loc
  }).join("\n")
}

// ── references ─────────────────────────────────────────────────────────────

const formatReferences = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const refs = obj.references as Array<Record<string, JsonValue>>
  if (!refs || refs.length === 0) return "No references found."
  return refs.map((r) => {
    const loc = `${r.file}:${r.line}:${r.col}`
    return r.isDefinition ? `${loc} (definition)` : loc
  }).join("\n")
}

// ── outline ────────────────────────────────────────────────────────────────

const formatOutline = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const symbols = obj.symbols as Array<Record<string, JsonValue>>
  if (!symbols || symbols.length === 0) return "No symbols."
  const lines: string[] = []
  formatSymbols(symbols, 0, lines)
  return lines.join("\n")
}

const formatSymbols = (
  symbols: Array<Record<string, JsonValue>>,
  depth: number,
  lines: string[],
): void => {
  const indent = "  ".repeat(depth)
  symbols.forEach((s) => {
    const loc = `${s.line}:${s.col}`
    lines.push(`${indent}${s.kind} ${s.name} (${loc})`)
    const children = s.children as Array<Record<string, JsonValue>> | undefined
    if (children && children.length > 0) {
      formatSymbols(children, depth + 1, lines)
    }
  })
}

// ── exports ────────────────────────────────────────────────────────────────

const formatExports = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const exports = obj.exports as Array<Record<string, JsonValue>>
  if (!exports || exports.length === 0) return "No exports found."
  return exports.map((e) => {
    const type = String(e.type)
    return `${e.kind} ${e.name}: ${type}`
  }).join("\n")
}

// ── completions ────────────────────────────────────────────────────────────

const formatCompletions = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const entries = obj.entries as Array<Record<string, JsonValue>>
  if (!entries || entries.length === 0) return "No completions."
  return entries.map((e) => `${e.kind} ${e.name}`).join("\n")
}

// ── signature ──────────────────────────────────────────────────────────────

const formatSignature = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const sigs = obj.signatures as Array<Record<string, JsonValue>>
  if (!sigs || sigs.length === 0) return "No signature help."
  return sigs.map((s) => {
    const params = s.parameters as Array<Record<string, JsonValue>>
    const paramStr = params
      .map((p) => `${p.name}${p.isOptional ? "?" : ""}: ${p.type}`)
      .join(", ")
    const lines = [`${s.label}(${paramStr})`]
    if (s.documentation && String(s.documentation).length > 0) {
      lines.push(`  ${s.documentation}`)
    }
    return lines.join("\n")
  }).join("\n\n")
}

// ── rename ─────────────────────────────────────────────────────────────────

const formatRename = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  if (obj.canRename === false) return `Cannot rename: ${obj.reason ?? "unknown reason"}`
  const edits = obj.edits as Array<Record<string, JsonValue>>
  const applied = obj.applied ? " (applied)" : " (dry run)"
  if (!edits || edits.length === 0) return `No edits${applied}`
  const lines = edits.map((e) =>
    `${e.file}:${e.line}:${e.col} ${e.oldText} -> ${e.newText}`,
  )
  lines.push(`\n${edits.length} edit(s)${applied}`)
  return lines.join("\n")
}

// ── file-references ────────────────────────────────────────────────────────

const formatFileReferences = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const refs = obj.references as Array<Record<string, JsonValue>>
  if (!refs || refs.length === 0) return "No file references found."
  return refs.map((r) => `${r.file}:${r.line}:${r.col}`).join("\n")
}

// ── call-hierarchy ─────────────────────────────────────────────────────────

const formatCallHierarchy = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const item = obj.item as Record<string, JsonValue> | undefined
  const calls = obj.calls as Array<Record<string, JsonValue>>
  const lines: string[] = []
  if (item) {
    lines.push(`${item.kind} ${item.name} (${item.file}:${item.line}:${item.col})`)
  }
  if (!calls || calls.length === 0) {
    lines.push("No calls found.")
  } else {
    calls.forEach((c) => {
      lines.push(`  ${c.kind} ${c.name} (${c.file}:${c.line}:${c.col})`)
    })
  }
  return lines.join("\n")
}

// ── code-fixes ─────────────────────────────────────────────────────────────

const formatCodeFixes = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const fixes = obj.fixes as Array<Record<string, JsonValue>>
  const applied = obj.applied ? " (applied)" : ""
  if (!fixes || fixes.length === 0) return `No code fixes available.${applied}`
  return fixes.map((f) => {
    const changes = f.changes as Array<Record<string, JsonValue>>
    const editCount = changes.reduce(
      (sum, c) => sum + (c.edits as Array<unknown>).length,
      0,
    )
    return `${f.fixName}: ${f.description} (${editCount} edit(s))`
  }).join("\n") + applied
}

// ── organize-imports ───────────────────────────────────────────────────────

const formatOrganizeImports = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const changes = obj.changes as Array<Record<string, JsonValue>>
  const applied = obj.applied ? " (applied)" : " (dry run)"
  if (!changes || changes.length === 0) return `No import changes needed.${applied}`
  const editCount = changes.reduce(
    (sum, c) => sum + (c.edits as Array<unknown>).length,
    0,
  )
  return `${editCount} edit(s) in ${changes.length} file(s)${applied}`
}

// ── fix-all ────────────────────────────────────────────────────────────────

const formatFixAll = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const changes = obj.changes as Array<Record<string, JsonValue>>
  const applied = obj.applied ? " (applied)" : " (dry run)"
  if (!changes || changes.length === 0) return `No changes needed.${applied}`
  const editCount = changes.reduce(
    (sum, c) => sum + (c.edits as Array<unknown>).length,
    0,
  )
  return `${editCount} edit(s) in ${changes.length} file(s)${applied}`
}

// ── refactor ───────────────────────────────────────────────────────────────

const formatRefactor = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const applied = obj.applied ? " (applied)" : ""
  const refactors = obj.refactors as Array<Record<string, JsonValue>> | undefined
  if (refactors) {
    if (refactors.length === 0) return "No refactors available."
    return refactors.map((r) => {
      const actions = r.actions as Array<Record<string, JsonValue>>
      const actionList = actions.map((a) => `  ${a.name}: ${a.description}`).join("\n")
      return `${r.name}: ${r.description}\n${actionList}`
    }).join("\n\n")
  }
  const changes = obj.changes as Array<Record<string, JsonValue>> | undefined
  if (changes && changes.length > 0) {
    const editCount = changes.reduce(
      (sum, c) => sum + (c.edits as Array<unknown>).length,
      0,
    )
    return `${editCount} edit(s) in ${changes.length} file(s)${applied}`
  }
  return `No changes.${applied}`
}

// ── explore ───────────────────────────────────────────────────────────────

const formatExplore = (data: JsonValue): string => {
  const obj = data as Record<string, JsonValue>
  const lines: string[] = []

  if (obj.signature && String(obj.signature).length > 0) {
    lines.push(String(obj.signature))
    lines.push("")
  }

  const members = obj.members as Array<Record<string, JsonValue>>
  if (members && members.length > 0) {
    members.forEach((m) => {
      const type = m.type ? `: ${m.type}` : ""
      lines.push(`${m.kind} ${m.name}${type}`)
    })
  } else if (lines.length === 0) {
    return "No members found."
  }

  return lines.join("\n")
}
