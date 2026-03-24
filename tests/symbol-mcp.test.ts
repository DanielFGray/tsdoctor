import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as McpServer from "effect/unstable/ai/McpServer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as path from "node:path"
import { IntrospectionHandlers, IntrospectionToolkit } from "../src/tools.ts"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { McpClient } from "../src/cli/mcp-client.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")

const appLayer = McpServer.toolkit(IntrospectionToolkit).pipe(
  Layer.provide(IntrospectionHandlers),
  Layer.provide(LanguageServiceManager.layer),
  Layer.provide(TsConfigResolver.layer),
)

const makeTestClient = () => {
  const serverLayer = McpServer.layerHttp({
    name: "tsdoctor-test",
    version: "0.1.0",
    path: "/mcp",
  }).pipe(Layer.provide(appLayer))

  const { handler } = HttpRouter.toWebHandler(serverLayer, { disableLogger: true })
  return McpClient.fromHandler(handler)
}

describe("symbol lookup via MCP", () => {
  it("get_type_at_position with symbol param", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_type_at_position", {
        file: fixtureFile,
        symbol: "greeting",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    expect(data.flat).toBe('"hello"')
  })

  it("get_quickinfo with symbol param", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_quickinfo", {
        file: fixtureFile,
        symbol: "getUser",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    expect(data.displayString).toContain("getUser")
  })

  it("get_references with symbol param", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_references", {
        file: fixtureFile,
        symbol: "alice",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    expect(data.references.length).toBeGreaterThan(1)
  })

  it("returns error for unknown symbol", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_type_at_position", {
        file: fixtureFile,
        symbol: "doesNotExist",
      }),
    )
    // failureMode: "return" — error is returned as content with _tag
    const data = JSON.parse(result.content[0]!.text)
    expect(data._tag).toBe("SymbolNotFoundError")
    expect(data.symbol).toBe("doesNotExist")
  })

  it("dot notation works through MCP", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_type_at_position", {
        file: fixtureFile,
        symbol: "Calculator.add",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    expect(data.flat).toContain("number")
  })
})
