/**
 * TOON (Token-Oriented Object Notation) encoder.
 * Implements the subset of TOON v3.0 spec needed for CLI output formatting.
 * Comma delimiter only. indent = 2 spaces.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const INDENT = "  "

// §7.2 — quoting rules for string values
const needsQuote = (s: string, delimiter = ","): boolean =>
  s === "" ||
  s !== s.trim() ||
  s === "true" || s === "false" || s === "null" ||
  /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s) ||
  /^0\d+$/.test(s) ||
  s.includes(":") || s.includes('"') || s.includes("\\") ||
  s.includes("[") || s.includes("]") || s.includes("{") || s.includes("}") ||
  s.includes("\n") || s.includes("\r") || s.includes("\t") ||
  s.includes(delimiter) ||
  s.startsWith("-")

// §7.1 — escape only \\, \", \n, \r, \t
const escapeString = (s: string): string =>
  s.replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")

const quoteIfNeeded = (s: string, delimiter = ","): string =>
  needsQuote(s, delimiter) ? `"${escapeString(s)}"` : s

// §3 — number normalization
const encodeNumber = (n: number): string => {
  if (!Number.isFinite(n)) return "null"
  if (Object.is(n, -0)) return "0"
  return String(n)
}

const encodePrimitive = (v: JsonValue, delimiter = ","): string => {
  if (v === null) return "null"
  if (typeof v === "boolean") return String(v)
  if (typeof v === "number") return encodeNumber(v)
  if (typeof v === "string") return quoteIfNeeded(v, delimiter)
  return quoteIfNeeded(JSON.stringify(v), delimiter)
}

const isPrimitive = (v: JsonValue): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"

const isPlainObject = (v: JsonValue): v is Record<string, JsonValue> =>
  v !== null && typeof v === "object" && !Array.isArray(v)

// §7.3 — key encoding
const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_.]*$/
const encodeKey = (k: string): string =>
  safeKeyPattern.test(k) ? k : `"${escapeString(k)}"`

// §9.3 — tabular detection: all objects, same keys, all primitive values
const isTabular = (arr: JsonValue[]): arr is Array<Record<string, JsonValue>> => {
  if (arr.length === 0) return false
  if (!arr.every(isPlainObject)) return false
  const firstKeys = Object.keys(arr[0] as Record<string, JsonValue>).sort().join(",")
  return arr.every((item) => {
    const obj = item as Record<string, JsonValue>
    const keys = Object.keys(obj).sort().join(",")
    return keys === firstKeys && Object.values(obj).every(isPrimitive)
  })
}

const encodeArray = (
  key: string,
  arr: JsonValue[],
  depth: number,
): string => {
  const prefix = INDENT.repeat(depth)
  const header = key ? `${encodeKey(key)}[${arr.length}]` : `[${arr.length}]`

  // Empty array
  if (arr.length === 0) return `${prefix}${header}:`

  // Tabular array — uniform objects with primitive values
  if (isTabular(arr)) {
    const fields = Object.keys(arr[0] as Record<string, JsonValue>)
    const headerLine = `${prefix}${header}{${fields.map(encodeKey).join(",")}}:`
    const rows = arr.map((item) => {
      const obj = item as Record<string, JsonValue>
      return `${INDENT.repeat(depth + 1)}${fields.map((f) => encodePrimitive(obj[f]!)).join(",")}`
    })
    return [headerLine, ...rows].join("\n")
  }

  // All primitives — inline
  if (arr.every(isPrimitive)) {
    return `${prefix}${header}: ${arr.map((v) => encodePrimitive(v)).join(",")}`
  }

  // Mixed / non-uniform — expanded list items
  const items = arr.map((item) => {
    if (isPrimitive(item)) {
      return `${INDENT.repeat(depth + 1)}- ${encodePrimitive(item)}`
    }
    if (Array.isArray(item)) {
      // Nested array as list item
      return encodeArray(`- `, item, depth + 1)
    }
    // Object as list item (§10)
    const obj = item as Record<string, JsonValue>
    return encodeObjectAsListItem(obj, depth + 1)
  })

  return [`${prefix}${header}:`, ...items].join("\n")
}

// §10 — object as list item
const encodeObjectAsListItem = (
  obj: Record<string, JsonValue>,
  depth: number,
): string => {
  const prefix = INDENT.repeat(depth)
  const entries = Object.entries(obj)
  if (entries.length === 0) return `${prefix}-`

  const lines: string[] = []
  const [firstKey, firstVal] = entries[0]!

  // First field on the hyphen line
  if (isPrimitive(firstVal)) {
    lines.push(`${prefix}- ${encodeKey(firstKey)}: ${encodePrimitive(firstVal)}`)
  } else if (Array.isArray(firstVal)) {
    // Tabular array on hyphen line
    const arrStr = encodeArray(firstKey, firstVal, 0)
    lines.push(`${prefix}- ${arrStr}`)
  } else {
    lines.push(`${prefix}- ${encodeKey(firstKey)}:`)
    lines.push(encodeValue(firstVal, depth + 1))
  }

  // Remaining fields at depth+1
  for (let i = 1; i < entries.length; i++) {
    const [k, v] = entries[i]!
    lines.push(encodeField(k, v, depth + 1))
  }

  return lines.join("\n")
}

const encodeField = (key: string, value: JsonValue, depth: number): string => {
  const prefix = INDENT.repeat(depth)

  if (isPrimitive(value)) {
    return `${prefix}${encodeKey(key)}: ${encodePrimitive(value)}`
  }

  if (Array.isArray(value)) {
    return encodeArray(key, value, depth)
  }

  // Nested object
  const obj = value as Record<string, JsonValue>
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    return `${prefix}${encodeKey(key)}:`
  }

  const nested = entries.map(([k, v]) => encodeField(k, v, depth + 1)).join("\n")
  return `${prefix}${encodeKey(key)}:\n${nested}`
}

const encodeValue = (value: JsonValue, depth: number): string => {
  if (isPrimitive(value)) {
    return `${INDENT.repeat(depth)}${encodePrimitive(value)}`
  }
  if (Array.isArray(value)) {
    return encodeArray("", value, depth)
  }
  const obj = value as Record<string, JsonValue>
  return Object.entries(obj).map(([k, v]) => encodeField(k, v, depth)).join("\n")
}

/**
 * Encode a JSON value to TOON format.
 */
export const toToon = (value: JsonValue): string => {
  if (isPrimitive(value)) return encodePrimitive(value)
  if (Array.isArray(value)) return encodeArray("", value, 0)

  const obj = value as Record<string, JsonValue>
  const entries = Object.entries(obj)
  if (entries.length === 0) return ""

  return entries.map(([k, v]) => encodeField(k, v, 0)).join("\n")
}
