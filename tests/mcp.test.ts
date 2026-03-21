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
})
