import { Effect } from "effect"
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { ServerStartError } from "./errors.ts"

const POLL_INTERVAL_MS = 200
const MAX_WAIT_MS = 15_000
const PID_DIR = path.join(os.tmpdir(), "tsdoctor")

const pidFile = (port: number) => path.join(PID_DIR, `server-${port}.pid`)

const serverEntrypoint = () => {
  const fromFile = path.resolve(import.meta.dirname, "../main.ts")
  if (fs.existsSync(fromFile)) return fromFile
  return path.resolve(process.cwd(), "src/main.ts")
}

const checkPort = (port: number): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "tsdoctor-probe", version: "0.1.0" },
          },
        }),
        signal: AbortSignal.timeout(1000),
      })
      return response.ok
    },
    catch: () => new ServerStartError({ message: `Cannot reach port ${port}` }),
  }).pipe(Effect.orElseSucceed(() => false))

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readPid = (port: number): number | null => {
  try {
    const content = fs.readFileSync(pidFile(port), "utf-8").trim()
    const pid = parseInt(content, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

const writePid = (port: number, pid: number): void => {
  fs.mkdirSync(PID_DIR, { recursive: true })
  fs.writeFileSync(pidFile(port), String(pid), "utf-8")
}

const spawnDaemon = (port: number): number => {
  const entry = serverEntrypoint()
  const child = spawn("bun", [entry], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
    detached: true,
  })
  child.unref()
  const pid = child.pid!
  writePid(port, pid)
  return pid
}

const waitForServer = (port: number, pid: number): Effect.Effect<void, ServerStartError> =>
  Effect.gen(function* () {
    const deadline = Date.now() + MAX_WAIT_MS
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) {
        return yield* new ServerStartError({ message: `Server (pid ${pid}) exited before becoming ready` })
      }
      const reachable = yield* checkPort(port)
      if (reachable) return
      yield* Effect.sleep(POLL_INTERVAL_MS)
    }
    return yield* new ServerStartError({ message: `Server did not become ready within ${MAX_WAIT_MS / 1000}s` })
  })

/**
 * Ensure a tsdoctor server is running on the given port.
 * If one is already reachable, returns immediately.
 * Otherwise spawns a daemon and waits for it to be ready.
 */
export const ensureServer = (port: number): Effect.Effect<void, ServerStartError> =>
  Effect.gen(function* () {
    const reachable = yield* checkPort(port)
    if (reachable) return

    const existingPid = readPid(port)
    if (existingPid !== null && isProcessAlive(existingPid)) {
      yield* Effect.logDebug(`Waiting for existing server (pid ${existingPid}) on port ${port}`)
      yield* waitForServer(port, existingPid)
      return
    }

    yield* Effect.log(`Starting tsdoctor server on port ${port}...`)
    const pid = spawnDaemon(port)
    yield* Effect.logDebug(`Spawned server (pid ${pid})`)
    yield* waitForServer(port, pid)
  })
