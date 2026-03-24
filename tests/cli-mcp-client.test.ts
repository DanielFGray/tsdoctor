import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
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

describe("McpClient", () => {
  it("initializes a session and returns server info", async () => {
    const client = makeTestClient()
    const result = await Effect.runPromise(client.initialize())
    expect(result.protocolVersion).toBeDefined()
    expect(result.serverInfo.name).toBe("tsdoctor-test")
  })

  it("lists available tools", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const tools = await Effect.runPromise(client.listTools())
    expect(tools.length).toBeGreaterThan(0)
    const names = tools.map((t: { name: string }) => t.name)
    expect(names).toContain("get_type_at_position")
    expect(names).toContain("get_diagnostics")
    expect(names).toContain("typecheck")
  })

  it("calls a tool and gets a result", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("get_type_at_position", {
        file: fixtureFile,
        line: 1,
        col: 1,
      }),
    )
    expect(result.content).toBeDefined()
    expect(result.content.length).toBeGreaterThan(0)
  })

  it("calls typecheck tool", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("typecheck", { file: fixtureFile }),
    )
    expect(result.content).toBeDefined()
    expect(result.isError).not.toBe(true)
  })
})
