export const greeting = "hello"

export const count = 42

export interface User {
  readonly name: string
  readonly age: number
  readonly email?: string
}

export const alice: User = { name: "Alice", age: 30 }

export type Status = "active" | "inactive" | "pending"

export const getUser = (id: number): User | null => {
  if (id === 1) return alice
  return null
}

export type Pair<A, B> = readonly [A, B]

export const pair: Pair<string, number> = ["hello", 42]
