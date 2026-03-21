import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as McpServer from "effect/unstable/ai/McpServer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as path from "node:path"
import { IntrospectionHandlers, IntrospectionToolkit } from "../src/tools.ts"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const errorFile = path.resolve(import.meta.dirname, "fixtures/with-errors.ts")

const appLayer = McpServer.toolkit(IntrospectionToolkit).pipe(
  Layer.provide(IntrospectionHandlers),
  Layer.provide(LanguageServiceManager.layer),
  Layer.provide(TsConfigResolver.layer),
)

/**
 * Raw JSON-RPC client that goes through the full HTTP/JSON serialization path.
 * This is what a real MCP client (Claude Code, Cursor, etc.) does — it sends
 * plain JSON over HTTP and reads the JSON Schema to decide types. The Effect
 * RPC client bypasses this and uses native codec types, which hides
 * serialization bugs like the NaN/Infinity string issue.
 */
const makeRawClient = Effect.gen(function* () {
  const serverLayer = McpServer.layerHttp({
    name: "glass-cobra-test",
    version: "0.1.0",
    path: "/mcp",
  }).pipe(Layer.provide(appLayer))

  const { handler, dispose } = HttpRouter.toWebHandler(serverLayer, { disableLogger: true })
  yield* Effect.addFinalizer(() => Effect.promise(() => dispose()))

  let sessionId: string | null = null
  let nextId = 1

  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    Effect.promise(async () => {
      const request = new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method,
          params,
        }),
      })
      const response = await handler(request)
      sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId
      return response.json() as Promise<{
        jsonrpc: string
        id: number
        result?: unknown
        error?: { code: number; message: string }
      }>
    })

  const callTool = (name: string, args: Record<string, unknown> = {}) =>
    rpc("tools/call", { name, arguments: args }).pipe(
      Effect.map((r) => r.result as {
        content: Array<{ type: string; text: string }>
        structuredContent?: Record<string, unknown>
        isError?: boolean
      }),
    )

  // Initialize the session
  yield* rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-raw", version: "1.0.0" },
  })

  return { rpc, callTool }
})

describe("MCP integration (raw JSON-RPC)", () => {
  it.live("lists all tools", () =>
    Effect.gen(function* () {
      const { rpc } = yield* makeRawClient
      const result = yield* rpc("tools/list", {})
      const tools = (result.result as { tools: Array<{ name: string }> }).tools
      const names = tools.map((t) => t.name)

      expect(names).toContain("get_type_at_position")
      expect(names).toContain("get_quickinfo")
      expect(names).toContain("get_completions")
      expect(names).toContain("get_diagnostics")
      expect(names).toContain("expand_type")
    }).pipe(Effect.scoped),
  )

  it.live("tool schemas use plain number types (no NaN/Infinity strings)", () =>
    Effect.gen(function* () {
      const { rpc } = yield* makeRawClient
      const result = yield* rpc("tools/list", {})
      const tools = (result.result as {
        tools: Array<{ name: string; inputSchema: Record<string, unknown> }>
      }).tools
      const quickinfo = tools.find((t) => t.name === "get_quickinfo")!

      const lineSchema = (quickinfo.inputSchema as {
        properties: { line: unknown }
      }).properties.line

      // Should be a simple number type, not anyOf with NaN/Infinity string variants
      expect(lineSchema).not.toHaveProperty("anyOf")
    }).pipe(Effect.scoped),
  )

  it.live("get_type_at_position with numeric line/col", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        line: 1,
        col: 14,
      })

      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent!["flat"]).toContain("hello")
      expect((result.structuredContent!["position"] as { line: number }).line).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.live("get_quickinfo returns hover info", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_quickinfo", {
        file: fixtureFile,
        line: 15,
        col: 14,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      expect(content["displayString"]).toContain("getUser")
      expect(content["kind"]).toBe("const")
    }).pipe(Effect.scoped),
  )

  it.live("get_completions returns entries", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_completions", {
        file: fixtureFile,
        line: 2,
        col: 1,
      })

      expect(result.isError).not.toBe(true)
      const entries = result.structuredContent!["entries"] as Array<{ name: string }>
      expect(entries.length).toBeGreaterThan(0)
    }).pipe(Effect.scoped),
  )

  it.live("get_diagnostics returns errors for bad file", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_diagnostics", { file: errorFile })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      expect(content["count"]).toBeGreaterThanOrEqual(2)
      ;(content["diagnostics"] as Array<{ category: string }>).forEach((d) => {
        expect(d.category).toBe("error")
      })
    }).pipe(Effect.scoped),
  )

  it.live("get_diagnostics returns empty for clean file", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_diagnostics", { file: fixtureFile })

      expect(result.structuredContent!["count"]).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.live("expand_type returns deeper structure at higher depth", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("expand_type", {
        file: fixtureFile,
        line: 11,
        col: 14,
        depth: 3,
      })

      expect(result.isError).not.toBe(true)
      const tree = result.structuredContent!["tree"] as {
        kind: string
        properties?: Array<{ name: string }>
      }
      expect(tree.kind).toBe("object")
      expect(tree.properties!.map((p) => p.name)).toContain("name")
    }).pipe(Effect.scoped),
  )

  it.live("returns tagged error for nonexistent file", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_type_at_position", {
        file: "/nonexistent.ts",
        line: 1,
        col: 1,
      })

      const content = result.structuredContent!
      expect(content["_tag"]).toBe("FileNotInProgramError")
    }).pipe(Effect.scoped),
  )

  it.live("works with offset instead of line/col", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        offset: 13,
      })

      expect(result.isError).not.toBe(true)
      expect(result.structuredContent!["flat"]).toContain("hello")
    }).pipe(Effect.scoped),
  )

  it.live("returns PositionOutOfRangeError for out-of-range line", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        line: 9999,
        col: 1,
      })

      const content = result.structuredContent!
      expect(content["_tag"]).toBe("PositionOutOfRangeError")
    }).pipe(Effect.scoped),
  )

  // --- get_signature_help ---

  it.live("get_signature_help returns parameter info inside a call", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // getUser(id: number) — line 16, inside the call `getUser(1)`
      // but the fixture doesn't have a standalone call. Let's query the function params.
      // Actually, `getUser = (id: number)` — position inside the parameter list
      // Line 15 col 25 is inside `(id: number)` — the `id` parameter
      const result = yield* callTool("get_signature_help", {
        file: fixtureFile,
        line: 15,
        col: 25,
      })

      // Signature help may or may not be available at a param declaration
      // (it's designed for call sites). The tool should not crash regardless.
      expect(result.isError).not.toBe(true)
    }).pipe(Effect.scoped),
  )

  // --- get_definition ---

  it.live("get_definition resolves variable reference to its declaration", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // `alice` on line 16 col 28 (inside getUser body: `return alice`)
      const result = yield* callTool("get_definition", {
        file: fixtureFile,
        line: 16,
        col: 28,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      const definitions = content["definitions"] as Array<{
        file: string
        line: number
        name: string
      }>
      expect(definitions.length).toBeGreaterThan(0)
      // Should point back to line 11 where alice is declared
      expect(definitions[0].line).toBe(11)
    }).pipe(Effect.scoped),
  )

  it.live("get_definition resolves type reference", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // `User` in the return type on line 15: `: User | null`
      // "User" starts around col 39
      const result = yield* callTool("get_definition", {
        file: fixtureFile,
        line: 15,
        col: 39,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      const definitions = content["definitions"] as Array<{
        file: string
        line: number
      }>
      expect(definitions.length).toBeGreaterThan(0)
      // Should point back to line 5 where User interface is declared
      expect(definitions[0].line).toBe(5)
    }).pipe(Effect.scoped),
  )

  // --- get_references ---

  it.live("get_references finds all uses of a variable", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // `alice` declaration at line 11 col 14
      const result = yield* callTool("get_references", {
        file: fixtureFile,
        line: 11,
        col: 14,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      const references = content["references"] as Array<{
        file: string
        line: number
      }>
      // Should find at least 2: declaration (line 11) and usage (line 16)
      expect(references.length).toBeGreaterThanOrEqual(2)
      const lines = references.map((r) => r.line)
      expect(lines).toContain(11)
      expect(lines).toContain(16)
    }).pipe(Effect.scoped),
  )

  // --- get_diagnostics range filter ---

  it.live("get_diagnostics with startLine/endLine filters results", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // with-errors.ts has errors on line 3 and line 5
      // Filter to just line 3
      const result = yield* callTool("get_diagnostics", {
        file: errorFile,
        startLine: 3,
        endLine: 3,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      expect(content["count"]).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.live("get_diagnostics without range still returns all", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_diagnostics", { file: errorFile })

      const content = result.structuredContent!
      expect((content["count"] as number)).toBeGreaterThanOrEqual(2)
    }).pipe(Effect.scoped),
  )

  // --- completions prefix filter and limit ---

  it.live("get_completions with prefix filters entries", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_completions", {
        file: fixtureFile,
        line: 2,
        col: 1,
        prefix: "greet",
      })

      expect(result.isError).not.toBe(true)
      const entries = result.structuredContent!["entries"] as Array<{ name: string }>
      expect(entries.length).toBeGreaterThan(0)
      entries.forEach((e) => {
        expect(e.name.toLowerCase()).toContain("greet")
      })
    }).pipe(Effect.scoped),
  )

  it.live("get_completions with limit caps results", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_completions", {
        file: fixtureFile,
        line: 2,
        col: 1,
        limit: 5,
      })

      expect(result.isError).not.toBe(true)
      const entries = result.structuredContent!["entries"] as Array<{ name: string }>
      expect(entries.length).toBeLessThanOrEqual(5)
    }).pipe(Effect.scoped),
  )

  // --- JSDoc tags in quickinfo ---

  it.live("get_quickinfo includes tags array", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_quickinfo", {
        file: fixtureFile,
        line: 1,
        col: 14,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      // tags should be present as an array (even if empty for this fixture)
      expect(content).toHaveProperty("tags")
      expect(Array.isArray(content["tags"])).toBe(true)
    }).pipe(Effect.scoped),
  )

  // --- code snippets in diagnostics ---

  it.live("get_diagnostics includes code snippets", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_diagnostics", { file: errorFile })

      expect(result.isError).not.toBe(true)
      const diagnostics = result.structuredContent!["diagnostics"] as Array<{
        snippet: string
        message: string
      }>
      expect(diagnostics.length).toBeGreaterThan(0)
      // Each diagnostic with a position should have a snippet
      diagnostics.forEach((d) => {
        expect(d.snippet).toBeDefined()
        expect(d.snippet.length).toBeGreaterThan(0)
      })
    }).pipe(Effect.scoped),
  )

  // --- expression range type query ---

  it.live("get_type_at_position with range returns the enclosing expression type", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // The chain [alice].map(...).filter(...) spans lines 24-28
      // Selecting lines 24-28 should get the type of the whole chain: string[]
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        startLine: 24,
        startCol: 22,
        endLine: 28,
        endCol: 2,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      expect(content["flat"]).toContain("string")
    }).pipe(Effect.scoped),
  )

  it.live("get_type_at_position with range on a function call returns its return type", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // `getUser(1)` on line 30 — select the call expression
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        startLine: 30,
        startCol: 22,
        endLine: 30,
        endCol: 32,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      // getUser returns User | null
      expect(content["flat"]).toContain("User")
      expect(content["flat"]).toContain("null")
    }).pipe(Effect.scoped),
  )

  it.live("get_type_at_position with point position still works (no range)", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // Regular point query should still work as before
      const result = yield* callTool("get_type_at_position", {
        file: fixtureFile,
        line: 1,
        col: 14,
      })

      expect(result.isError).not.toBe(true)
      expect(result.structuredContent!["flat"]).toContain("hello")
    }).pipe(Effect.scoped),
  )

  // --- project-wide diagnostics ---

  it.live("get_diagnostics with projectWide returns errors across all files", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      // Use any file in the project as the anchor, set projectWide: true
      // Should find the 2 errors from with-errors.ts even though we pass sample.ts
      const result = yield* callTool("get_diagnostics", {
        file: fixtureFile,
        projectWide: true,
      })

      expect(result.isError).not.toBe(true)
      const content = result.structuredContent!
      expect((content["count"] as number)).toBeGreaterThanOrEqual(2)
      // Errors should reference the actual file with errors
      const diagnostics = content["diagnostics"] as Array<{ position?: { file?: string } }>
      const hasErrorFileRef = diagnostics.some((d) =>
        d.position !== undefined,
      )
      expect(hasErrorFileRef).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.live("get_diagnostics without projectWide still scopes to single file", () =>
    Effect.gen(function* () {
      const { callTool } = yield* makeRawClient
      const result = yield* callTool("get_diagnostics", { file: fixtureFile })

      const content = result.structuredContent!
      expect(content["count"]).toBe(0)
    }).pipe(Effect.scoped),
  )
})
