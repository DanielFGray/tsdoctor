import { alice, getUser, type User } from "./sample.ts"

export const firstUser: User = alice

export const found = getUser(1)
