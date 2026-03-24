import { Effect } from "effect"
import { ServerConnectError } from "./errors.ts"

export interface ToolResult {
  readonly content: ReadonlyArray<{ type: string; text: string }>
  readonly isError?: boolean
}

interface InitializeResult {
  readonly protocolVersion: string
  readonly serverInfo: { readonly name: string; readonly version: string }
  readonly capabilities: Record<string, unknown>
}

interface ToolInfo {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

export interface McpClient {
  readonly initialize: () => Effect.Effect<InitializeResult>
  readonly listTools: () => Effect.Effect<ReadonlyArray<ToolInfo>>
  readonly callTool: (name: string, args: Record<string, unknown>) => Effect.Effect<ToolResult>
}

type RequestHandler = (request: Request) => Promise<Response>

const jsonRpc = (
  handler: RequestHandler,
  sessionId: { current: string | null },
  nextId: { current: number },
) => (method: string, params: Record<string, unknown> = {}) =>
  Effect.promise(async () => {
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
        ...(sessionId.current ? { "Mcp-Session-Id": sessionId.current } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId.current++,
        method,
        params,
      }),
    })
    const response = await handler(request)
    sessionId.current = response.headers.get("Mcp-Session-Id") ?? sessionId.current
    return response.json() as Promise<{
      jsonrpc: string
      id: number
      result?: unknown
      error?: { code: number; message: string }
    }>
  })

const httpJsonRpc = (
  baseUrl: string,
  sessionId: { current: string | null },
  nextId: { current: number },
) => (method: string, params: Record<string, unknown> = {}) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
          ...(sessionId.current ? { "Mcp-Session-Id": sessionId.current } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId.current++,
          method,
          params,
        }),
      })
      sessionId.current = response.headers.get("Mcp-Session-Id") ?? sessionId.current
      return response.json() as Promise<{
        jsonrpc: string
        id: number
        result?: unknown
        error?: { code: number; message: string }
      }>
    },
    catch: () => new ServerConnectError({ url: baseUrl }),
  })

const makeClient = (
  rpc: (method: string, params?: Record<string, unknown>) => Effect.Effect<{
    result?: unknown
    error?: { code: number; message: string }
  }>,
): McpClient => ({
  initialize: () =>
    rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tsdoctor-cli", version: "0.1.0" },
    }).pipe(Effect.map((r) => r.result as InitializeResult)),

  listTools: () =>
    rpc("tools/list").pipe(
      Effect.map((r) => (r.result as { tools: ReadonlyArray<ToolInfo> }).tools),
    ),

  callTool: (name, args) =>
    rpc("tools/call", { name, arguments: args }).pipe(
      Effect.map((r) => r.result as ToolResult),
    ),
})

export const McpClient = {
  /** Create a client from a web handler (for testing) */
  fromHandler: (handler: RequestHandler): McpClient => {
    const sessionId = { current: null as string | null }
    const nextId = { current: 1 }
    return makeClient(jsonRpc(handler, sessionId, nextId))
  },

  /** Create a client that connects to a running server */
  fromUrl: (url: string): McpClient => {
    const sessionId = { current: null as string | null }
    const nextId = { current: 1 }
    const rpc = httpJsonRpc(url, sessionId, nextId)
    return makeClient((method, params) => rpc(method, params).pipe(Effect.orDie))
  },
}
