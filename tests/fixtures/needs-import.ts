// This file has an unresolved reference that needs an auto-import
import type { User } from "./sample.ts"

export const bob: User = { name: "Bob", age: 25 }

// `alice` is used but not imported — a code fix should suggest adding the import
export const copy = alice
