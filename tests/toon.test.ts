import { describe, expect, it } from "@effect/vitest"
import { toToon } from "../src/cli/toon.ts"

describe("toToon", () => {
  it("encodes a flat object", () => {
    expect(toToon({ id: 123, name: "Ada", active: true, score: 98.5, x: null }))
      .toBe("id: 123\nname: Ada\nactive: true\nscore: 98.5\nx: null")
  })

  it("encodes a nested object", () => {
    expect(toToon({ user: { id: 1, name: "Alice" } }))
      .toBe("user:\n  id: 1\n  name: Alice")
  })

  it("encodes deeply nested objects", () => {
    expect(toToon({ a: { b: { c: 1 } } }))
      .toBe("a:\n  b:\n    c: 1")
  })

  it("encodes a primitive array", () => {
    expect(toToon({ tags: ["admin", "ops", "dev"] }))
      .toBe("tags[3]: admin,ops,dev")
  })

  it("encodes an empty array", () => {
    expect(toToon({ items: [] }))
      .toBe("items[0]:")
  })

  it("encodes a tabular array (uniform objects with primitive values)", () => {
    const data = {
      users: [
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
      ],
    }
    expect(toToon(data))
      .toBe("users[2]{id,name,role}:\n  1,Alice,admin\n  2,Bob,user")
  })

  it("encodes a root-level flat object", () => {
    expect(toToon({ flat: '"hello"', warning: null }))
      .toBe('flat: "\\\"hello\\\""\nwarning: null')
  })

  it("quotes strings containing commas", () => {
    expect(toToon({ names: ["one, two", "three"] }))
      .toBe('names[2]: "one, two",three')
  })

  it("quotes strings containing colons", () => {
    expect(toToon({ msg: "key: value" }))
      .toBe('msg: "key: value"')
  })

  it("quotes empty strings", () => {
    expect(toToon({ x: "" }))
      .toBe('x: ""')
  })

  it("quotes strings that look like booleans", () => {
    expect(toToon({ x: "true", y: "false", z: "null" }))
      .toBe('x: "true"\ny: "false"\nz: "null"')
  })

  it("quotes strings that look like numbers", () => {
    expect(toToon({ x: "42", y: "-3.14" }))
      .toBe('x: "42"\ny: "-3.14"')
  })

  it("quotes strings with leading/trailing whitespace", () => {
    expect(toToon({ x: " hello " }))
      .toBe('x: " hello "')
  })

  it("encodes mixed array as expanded list", () => {
    const data = {
      items: [1, "hello", true],
    }
    expect(toToon(data))
      .toBe("items[3]: 1,hello,true")
  })

  it("encodes array of non-uniform objects as expanded list", () => {
    const data = {
      items: [
        { a: 1 },
        { b: 2 },
      ],
    }
    expect(toToon(data)).toBe(
      "items[2]:\n  - a: 1\n  - b: 2",
    )
  })

  it("encodes an empty object", () => {
    expect(toToon({})).toBe("")
  })

  it("encodes a root array", () => {
    expect(toToon([1, 2, 3])).toBe("[3]: 1,2,3")
  })

  it("encodes a root tabular array", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]
    expect(toToon(data)).toBe("[2]{id,name}:\n  1,Alice\n  2,Bob")
  })

  it("handles strings starting with hyphen", () => {
    expect(toToon({ x: "-foo" }))
      .toBe('x: "-foo"')
  })

  it("handles NaN and Infinity as null", () => {
    expect(toToon({ x: NaN, y: Infinity, z: -Infinity }))
      .toBe("x: null\ny: null\nz: null")
  })
})
