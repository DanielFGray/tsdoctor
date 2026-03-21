import { Effect, Layer } from "effect"
import { McpServer } from "effect/unstable/ai"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { HttpRouter } from "effect/unstable/http"
import { IntrospectionHandlers, IntrospectionToolkit } from "./tools.ts"
import { LanguageServiceManager } from "./LanguageServiceManager.ts"
import { TsConfigResolver } from "./TsConfigResolver.ts"

const PORT = Number(process.env["PORT"] ?? 39100)

const McpLive = McpServer.toolkit(IntrospectionToolkit).pipe(
  Layer.provide(IntrospectionHandlers),
  Layer.provide(LanguageServiceManager.layer),
  Layer.provide(TsConfigResolver.layer),
)

const ServerLive = HttpRouter.serve(
  McpServer.layerHttp({
    name: "glass-cobra",
    version: "0.1.0",
    path: "/mcp",
  }).pipe(Layer.provide(McpLive)),
).pipe(
  Layer.provide(BunHttpServer.layer({ port: PORT })),
)

Effect.log(`Starting glass-cobra MCP server on port ${PORT}`).pipe(
  Effect.andThen(Layer.launch(ServerLive)),
  BunRuntime.runMain,
)
