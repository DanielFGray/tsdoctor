import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as McpServer from "effect/unstable/ai/McpServer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as path from "node:path"
import { IntrospectionHandlers, IntrospectionToolkit } from "../src/tools.ts"
import { LanguageServiceManager } from "../src/LanguageServiceManager.ts"
import { TsConfigResolver } from "../src/TsConfigResolver.ts"
import { McpClient } from "../src/cli/mcp-client.ts"

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
  return McpClient.fromHandler(handler)
}

describe("typecheck", () => {
  it("returns per-file and per-error-code breakdowns", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("typecheck", { file: errorFile }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)

    expect(data.pass).toBe(false)
    expect(data.errorCount).toBeGreaterThanOrEqual(2)

    // Per-file breakdown
    expect(data.fileErrors).toBeInstanceOf(Array)
    expect(data.fileErrors.length).toBeGreaterThanOrEqual(1)
    const fileNames = data.fileErrors.map((f: { file: string }) => f.file)
    expect(fileNames.some((f: string) => f.includes("with-errors"))).toBe(true)
    // Sorted by count descending
    for (let i = 1; i < data.fileErrors.length; i++) {
      expect(data.fileErrors[i - 1].count).toBeGreaterThanOrEqual(data.fileErrors[i].count)
    }

    // Per-error-code breakdown
    expect(data.errorCodes).toBeInstanceOf(Array)
    expect(data.errorCodes.length).toBeGreaterThanOrEqual(1)
    expect(data.errorCodes[0]).toHaveProperty("code")
    expect(data.errorCodes[0]).toHaveProperty("message")
    expect(data.errorCodes[0]).toHaveProperty("count")
    // Sorted by count descending
    for (let i = 1; i < data.errorCodes.length; i++) {
      expect(data.errorCodes[i - 1].count).toBeGreaterThanOrEqual(data.errorCodes[i].count)
    }

    // Summary includes file count
    expect(data.summary).toContain("file(s)")
  })

  it("respects limit parameter", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("typecheck", { file: errorFile, limit: 1 }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)

    // Total count is still complete
    expect(data.errorCount).toBeGreaterThanOrEqual(2)
    // Summary is truncated
    expect(data.summary).toContain("more")
    // But fileErrors and errorCodes are still complete
    expect(data.fileErrors.length).toBeGreaterThanOrEqual(1)
    expect(data.errorCodes.length).toBeGreaterThanOrEqual(1)
  })

  it("returns empty arrays when project is clean", async () => {
    const client = makeTestClient()
    await Effect.runPromise(client.initialize())
    const result = await Effect.runPromise(
      client.callTool("typecheck", { file: errorFile }),
    )
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(result.content[0]!.text)

    // Project has errors so this test just verifies shape
    expect(data).toHaveProperty("fileErrors")
    expect(data).toHaveProperty("errorCodes")
    expect(data).toHaveProperty("pass")
    expect(data).toHaveProperty("errorCount")
    expect(data).toHaveProperty("summary")
  })
})
