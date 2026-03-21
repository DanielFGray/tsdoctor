import * as ts from "typescript"

// -----------------------------------------------------------------------------
// Flat string formatting
// -----------------------------------------------------------------------------

const defaultFormatFlags =
  ts.TypeFormatFlags.NoTruncation
  | ts.TypeFormatFlags.WriteArrayAsGenericType
  | ts.TypeFormatFlags.UseFullyQualifiedType

export const typeToString = (
  checker: ts.TypeChecker,
  type: ts.Type,
  enclosingNode?: ts.Node,
  flags: ts.TypeFormatFlags = defaultFormatFlags,
): string =>
  checker.typeToString(type, enclosingNode, flags)

// -----------------------------------------------------------------------------
// Structured type tree
// -----------------------------------------------------------------------------

export type TypeNode =
  | { readonly kind: "primitive"; readonly name: string }
  | { readonly kind: "literal"; readonly value: string | number | boolean | bigint }
  | { readonly kind: "reference"; readonly name: string; readonly typeArguments?: ReadonlyArray<TypeNode> }
  | { readonly kind: "union"; readonly members: ReadonlyArray<TypeNode> }
  | { readonly kind: "intersection"; readonly members: ReadonlyArray<TypeNode> }
  | { readonly kind: "object"; readonly properties: ReadonlyArray<PropertyNode> }
  | { readonly kind: "array"; readonly elementType: TypeNode }
  | { readonly kind: "tuple"; readonly elements: ReadonlyArray<TypeNode> }
  | { readonly kind: "function"; readonly signatures: ReadonlyArray<SignatureNode> }
  | { readonly kind: "typeParameter"; readonly name: string; readonly constraint?: TypeNode }
  | { readonly kind: "indexedAccess"; readonly objectType: TypeNode; readonly indexType: TypeNode }
  | { readonly kind: "conditional"; readonly checkType: TypeNode; readonly extendsType: TypeNode; readonly trueType: TypeNode; readonly falseType: TypeNode }
  | { readonly kind: "mapped"; readonly flat: string }
  | { readonly kind: "unknown"; readonly flat: string }

export interface PropertyNode {
  readonly name: string
  readonly type: TypeNode
  readonly optional: boolean
  readonly readonly: boolean
}

export interface SignatureNode {
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly type: TypeNode }>
  readonly returnType: TypeNode
  readonly typeParameters?: ReadonlyArray<{ readonly name: string; readonly constraint?: TypeNode }>
}

// -----------------------------------------------------------------------------
// Recursive type walker
// -----------------------------------------------------------------------------

interface WalkContext {
  readonly checker: ts.TypeChecker
  readonly depth: number
  readonly maxDepth: number
  readonly seen: Set<number>
}

const walkType = (type: ts.Type, ctx: WalkContext): TypeNode => {
  const typeId = (type as { id?: number }).id
  if (typeId !== undefined && ctx.seen.has(typeId)) {
    return { kind: "reference", name: ctx.checker.typeToString(type) }
  }

  if (ctx.depth >= ctx.maxDepth) {
    return { kind: "reference", name: ctx.checker.typeToString(type) }
  }

  const deeper: WalkContext = {
    ...ctx,
    depth: ctx.depth + 1,
    seen: typeId !== undefined ? new Set([...ctx.seen, typeId]) : ctx.seen,
  }

  // Union
  if (type.isUnion()) {
    return { kind: "union", members: type.types.map((t) => walkType(t, deeper)) }
  }

  // Intersection
  if (type.isIntersection()) {
    return { kind: "intersection", members: type.types.map((t) => walkType(t, deeper)) }
  }

  // Literal types
  if (type.isStringLiteral()) {
    return { kind: "literal", value: type.value }
  }
  if (type.isNumberLiteral()) {
    return { kind: "literal", value: type.value }
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: "literal", value: ctx.checker.typeToString(type) === "true" }
  }
  if (type.flags & ts.TypeFlags.BigIntLiteral) {
    const lit = type as ts.BigIntLiteralType
    return { kind: "literal", value: BigInt(lit.value.negative ? `-${lit.value.base10Value}` : lit.value.base10Value) }
  }

  // Primitives
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean
    | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null
    | ts.TypeFlags.Never | ts.TypeFlags.Any | ts.TypeFlags.Unknown
    | ts.TypeFlags.BigInt | ts.TypeFlags.ESSymbol)) {
    return { kind: "primitive", name: ctx.checker.typeToString(type) }
  }

  // Type parameters
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const tp = type as ts.TypeParameter
    const constraint = tp.getConstraint()
    return constraint
      ? { kind: "typeParameter", name: ctx.checker.typeToString(type), constraint: walkType(constraint, deeper) }
      : { kind: "typeParameter", name: ctx.checker.typeToString(type) }
  }

  // Indexed access (T[K])
  if (type.flags & ts.TypeFlags.IndexedAccess) {
    const ia = type as ts.IndexedAccessType
    return {
      kind: "indexedAccess",
      objectType: walkType(ia.objectType, deeper),
      indexType: walkType(ia.indexType, deeper),
    }
  }

  // Conditional (T extends U ? A : B)
  if (type.flags & ts.TypeFlags.Conditional) {
    const ct = type as ts.ConditionalType
    return {
      kind: "conditional",
      checkType: walkType(ct.checkType, deeper),
      extendsType: walkType(ct.extendsType, deeper),
      trueType: walkType(ctx.checker.getTypeAtLocation(ct.root.node.trueType), deeper),
      falseType: walkType(ctx.checker.getTypeAtLocation(ct.root.node.falseType), deeper),
    }
  }

  // Object types
  if (type.flags & ts.TypeFlags.Object) {
    return walkObjectType(type as ts.ObjectType, deeper)
  }

  return { kind: "unknown", flat: ctx.checker.typeToString(type) }
}

const walkObjectType = (type: ts.ObjectType, ctx: WalkContext): TypeNode => {
  const objectFlags = type.objectFlags

  // Tuple
  if (objectFlags & ts.ObjectFlags.Tuple) {
    const typeArgs = ctx.checker.getTypeArguments(type as ts.TupleTypeReference)
    return { kind: "tuple", elements: Array.from(typeArgs).map((t) => walkType(t, ctx)) }
  }

  // Type reference (Array<T>, Map<K,V>, user-defined generics)
  if (objectFlags & ts.ObjectFlags.Reference) {
    const typeRef = type as ts.TypeReference
    const symbol = type.getSymbol()
    const name = symbol?.getName() ?? ctx.checker.typeToString(type)
    const typeArgs = ctx.checker.getTypeArguments(typeRef)

    if ((name === "Array" || name === "ReadonlyArray") && typeArgs.length === 1) {
      return { kind: "array", elementType: walkType(typeArgs[0]!, ctx) }
    }

    return typeArgs.length > 0
      ? { kind: "reference" as const, name, typeArguments: Array.from(typeArgs).map((t) => walkType(t, ctx)) }
      : { kind: "reference" as const, name }
  }

  // Mapped types
  if (objectFlags & ts.ObjectFlags.Mapped) {
    return { kind: "mapped", flat: ctx.checker.typeToString(type) }
  }

  // Function/callable types
  const callSignatures = type.getCallSignatures()
  if (callSignatures.length > 0 && type.getProperties().length === 0) {
    return { kind: "function", signatures: callSignatures.map((sig) => walkSignature(sig, ctx)) }
  }

  // Plain object type
  return {
    kind: "object",
    properties: type.getProperties().map((prop) => {
      const propType = ctx.checker.getTypeOfSymbol(prop)
      const declarations = prop.getDeclarations() ?? []
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0
      const isReadonly = declarations.some((d) =>
        ts.canHaveModifiers(d) &&
        ts.getModifiers(d)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) === true,
      )
      return {
        name: prop.getName(),
        type: walkType(propType, ctx),
        optional: isOptional,
        readonly: isReadonly,
      }
    }),
  }
}

const walkSignature = (sig: ts.Signature, ctx: WalkContext): SignatureNode => {
  const parameters = sig.getParameters().map((param) => ({
    name: param.getName(),
    type: walkType(ctx.checker.getTypeOfSymbol(param), ctx),
  }))
  const returnType = walkType(sig.getReturnType(), ctx)
  const typeParams = sig.getTypeParameters()

  if (!typeParams || typeParams.length === 0) {
    return { parameters, returnType }
  }

  return {
    parameters,
    returnType,
    typeParameters: typeParams.map((tp) => {
      const constraint = tp.getConstraint()
      return constraint
        ? { name: tp.symbol.getName(), constraint: walkType(constraint, ctx) }
        : { name: tp.symbol.getName() }
    }),
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export const typeToTree = (
  checker: ts.TypeChecker,
  type: ts.Type,
  maxDepth: number = 1,
): TypeNode =>
  walkType(type, {
    checker,
    depth: 0,
    maxDepth,
    seen: new Set(),
  })
