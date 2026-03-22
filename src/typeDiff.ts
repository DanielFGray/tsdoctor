import * as ts from "typescript"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DiffResult =
  | { readonly status: "match"; readonly type: string }
  | { readonly status: "mismatch"; readonly expected: string; readonly actual: string }
  | { readonly status: "missing"; readonly expected: string }
  | { readonly status: "extra"; readonly actual: string }
  | { readonly status: "object"; readonly properties: ReadonlyArray<PropertyDiff> }
  | { readonly status: "union"; readonly expected: string; readonly actual: string }

export interface PropertyDiff {
  readonly name: string
  readonly diff: DiffResult
}

// -----------------------------------------------------------------------------
// Parallel type diff
// -----------------------------------------------------------------------------

interface DiffContext {
  readonly checker: ts.TypeChecker
  readonly depth: number
  readonly maxDepth: number
  readonly seen: Set<string>
}

const typeKey = (a: ts.Type, b: ts.Type): string => {
  const aId = (a as { id?: number }).id ?? 0
  const bId = (b as { id?: number }).id ?? 0
  return `${aId}:${bId}`
}

const isAssignable = (checker: ts.TypeChecker, source: ts.Type, target: ts.Type): boolean =>
  (checker as { isTypeAssignableTo?: (s: ts.Type, t: ts.Type) => boolean })
    .isTypeAssignableTo?.(source, target) ?? false

export const diffTypes = (
  checker: ts.TypeChecker,
  expected: ts.Type,
  actual: ts.Type,
  maxDepth = 5,
): DiffResult =>
  diffTypesImpl(expected, actual, {
    checker,
    depth: 0,
    maxDepth,
    seen: new Set(),
  })

const diffTypesImpl = (
  expected: ts.Type,
  actual: ts.Type,
  ctx: DiffContext,
): DiffResult => {
  const key = typeKey(expected, actual)
  if (ctx.seen.has(key) || ctx.depth >= ctx.maxDepth) {
    const assignable = isAssignable(ctx.checker, actual, expected)
    return assignable
      ? { status: "match", type: ctx.checker.typeToString(expected) }
      : { status: "mismatch", expected: ctx.checker.typeToString(expected), actual: ctx.checker.typeToString(actual) }
  }

  // Quick check: if assignable, it's a match
  if (isAssignable(ctx.checker, actual, expected)) {
    return { status: "match", type: ctx.checker.typeToString(expected) }
  }

  const deeper: DiffContext = {
    ...ctx,
    depth: ctx.depth + 1,
    seen: new Set([...ctx.seen, key]),
  }

  // Primitives and literals: don't recurse into their prototype properties
  const isPrimitive = (t: ts.Type) =>
    !!(t.flags & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean
      | ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral
      | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null
      | ts.TypeFlags.Never | ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral))

  if (isPrimitive(expected) || isPrimitive(actual)) {
    return {
      status: "mismatch",
      expected: ctx.checker.typeToString(expected),
      actual: ctx.checker.typeToString(actual),
    }
  }

  // Both have properties — diff them
  const expectedProps = expected.getProperties()
  const actualProps = actual.getProperties()

  if (expectedProps.length > 0 || actualProps.length > 0) {
    const expectedMap = new Map(expectedProps.map((p) => [p.name, p]))
    const actualMap = new Map(actualProps.map((p) => [p.name, p]))
    const allNames = new Set([...expectedMap.keys(), ...actualMap.keys()])

    const properties: PropertyDiff[] = []
    allNames.forEach((name) => {
      const ep = expectedMap.get(name)
      const ap = actualMap.get(name)

      if (ep && ap) {
        const ept = ctx.checker.getTypeOfSymbol(ep)
        const apt = ctx.checker.getTypeOfSymbol(ap)
        properties.push({ name, diff: diffTypesImpl(ept, apt, deeper) })
      } else if (ep && !ap) {
        const isOptional = (ep.flags & ts.SymbolFlags.Optional) !== 0
        if (!isOptional) {
          properties.push({
            name,
            diff: { status: "missing", expected: ctx.checker.typeToString(ctx.checker.getTypeOfSymbol(ep)) },
          })
        }
      } else if (!ep && ap) {
        properties.push({
          name,
          diff: { status: "extra", actual: ctx.checker.typeToString(ctx.checker.getTypeOfSymbol(ap)) },
        })
      }
    })

    // Only return object diff if there are mismatched properties
    const hasMismatches = properties.some((p) => p.diff.status !== "match")
    if (hasMismatches) {
      // Filter to only show mismatched properties for clarity
      return {
        status: "object",
        properties: properties.filter((p) => p.diff.status !== "match"),
      }
    }
  }

  // Fallback: just report the top-level mismatch
  return {
    status: "mismatch",
    expected: ctx.checker.typeToString(expected, undefined, ts.TypeFormatFlags.NoTruncation),
    actual: ctx.checker.typeToString(actual, undefined, ts.TypeFormatFlags.NoTruncation),
  }
}

// -----------------------------------------------------------------------------
// Extract expected and actual types from a diagnostic
// -----------------------------------------------------------------------------

/**
 * Given a TS2322 (assignment) or TS2345 (argument) diagnostic, extract
 * the expected and actual ts.Type objects by finding the declaration/call
 * and inspecting the declared type vs the expression type.
 */
export const extractMismatchTypes = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): { expected: ts.Type; actual: ts.Type } | null => {
  if (diagnostic.start === undefined) return null

  const node = findDeepestNode(sourceFile, diagnostic.start)
  if (!node) return null

  // TS2322: Type 'X' is not assignable to type 'Y'
  // The diagnostic is on the target (variable name or property name)
  if (diagnostic.code === 2322) {
    // Walk up to find VariableDeclaration or PropertyAssignment
    let current: ts.Node = node
    while (current) {
      if (ts.isVariableDeclaration(current) && current.initializer) {
        return {
          expected: checker.getTypeAtLocation(current.name),
          actual: checker.getTypeAtLocation(current.initializer),
        }
      }
      if (ts.isPropertyAssignment(current) && current.parent && ts.isObjectLiteralExpression(current.parent)) {
        const contextualType = checker.getContextualType(current.parent)
        if (contextualType) {
          return {
            expected: contextualType,
            actual: checker.getTypeAtLocation(current.parent),
          }
        }
      }
      current = current.parent
    }
  }

  // TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
  if (diagnostic.code === 2345) {
    let current: ts.Node = node
    while (current) {
      if (ts.isCallExpression(current.parent) && current.parent.arguments.includes(current as ts.Expression)) {
        const argIndex = current.parent.arguments.indexOf(current as ts.Expression)
        const sig = checker.getResolvedSignature(current.parent)
        if (sig) {
          const param = sig.getParameters()[argIndex]
          if (param) {
            return {
              expected: checker.getTypeOfSymbol(param),
              actual: checker.getTypeAtLocation(current),
            }
          }
        }
      }
      current = current.parent
    }
  }

  return null
}

const findDeepestNode = (sourceFile: ts.SourceFile, offset: number): ts.Node | undefined => {
  const find = (node: ts.Node): ts.Node | undefined => {
    if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
      return ts.forEachChild(node, find) ?? node
    }
    return undefined
  }
  return ts.forEachChild(sourceFile, find)
}
