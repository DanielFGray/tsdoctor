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

describe("explore_module", () => {
  it("lists top-level exports of a module", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("explore_module", {
        file: fixtureFile,
        module: "effect",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    const names = data.members.map((m: { name: string }) => m.name)
    expect(names).toContain("Effect")
    expect(names).toContain("Schema")
    expect(names).toContain("Layer")
    expect(names).toContain("pipe")
  })

  it("lists members of a namespace", { timeout: 15000 }, async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("explore_module", {
        file: fixtureFile,
        module: "effect",
        member: "Effect",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    const names = data.members.map((m: { name: string }) => m.name)
    expect(names).toContain("gen")
    expect(names).toContain("map")
    expect(names).toContain("flatMap")
  })

  it("shows signature of a specific API", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("explore_module", {
        file: fixtureFile,
        module: "effect",
        member: "Schema.Struct",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    expect(data.signature).toBeDefined()
    expect(data.signature).toContain("Struct")
  })

  it("lists exports of a subpath module", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("explore_module", {
        file: fixtureFile,
        module: "effect/unstable/cli",
      }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)
    const names = data.members.map((m: { name: string }) => m.name)
    expect(names).toContain("Command")
    expect(names).toContain("Flag")
    expect(names).toContain("Argument")
  })
})
