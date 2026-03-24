import { Effect } from "effect"

// The Effect language service plugin should flag this:
// "Effect.void can be used instead of Effect.succeed(undefined)"
export const unnecessary = Effect.succeed(undefined)

// Basic Effect usage to ensure file compiles
export const program = Effect.gen(function* () {
  const value = yield* Effect.succeed(42)
  return value
})
