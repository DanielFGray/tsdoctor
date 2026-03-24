import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as McpServer from "effect/unstable/ai/McpServer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as path from "node:path"
import { IntrospectionHandlers, IntrospectionToolkit } from "../src/tools.ts"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { McpClient } from "../src/cli/mcp-client.ts"
import { runCommand } from "../src/cli/commands.ts"

const fixtureFile = path.resolve(import.meta.dirname, "fixtures/sample.ts")
const errorFile = path.resolve(import.meta.dirname, "fixtures/with-errors.ts")

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
  const client = McpClient.fromHandler(handler)
  return client
}

describe("CLI commands", () => {
  it("type command returns type info", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "type", { position: `${fixtureFile}:1:14` }),
    )
    expect(output).toContain('"hello"')
  })

  it("diagnostics command returns errors for bad file", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "diagnostics", { position: errorFile }),
    )
    const parsed = JSON.parse(output)
    // Compact mode: diagnostics array is empty but count/summary show errors
    expect(parsed.count).toBeGreaterThan(0)
    expect(parsed.summary).toContain("error")
  })

  it("diagnostics command returns clean for good file", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "diagnostics", { position: fixtureFile }),
    )
    const parsed = JSON.parse(output)
    expect(parsed.diagnostics).toEqual([])
  })

  it("typecheck command works", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "typecheck", { position: fixtureFile }),
    )
    expect(output).toBeDefined()
    expect(output.length).toBeGreaterThan(0)
  })

  it("quickinfo command returns hover info", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "quickinfo", { position: `${fixtureFile}:1:14` }),
    )
    expect(output).toContain("greeting")
  })

  it("definition command returns location", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "definition", { position: `${fixtureFile}:1:14` }),
    )
    const parsed = JSON.parse(output)
    expect(parsed.definitions).toBeDefined()
  })

  it("outline command returns file structure", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const output = await Effect.runPromise(
      runCommand(client, "outline", { position: fixtureFile }),
    )
    const parsed = JSON.parse(output)
    expect(parsed.symbols).toBeDefined()
    expect(parsed.symbols.length).toBeGreaterThan(0)
  })
})
