import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "./Pipeline9HighDensitySolver"
import type { HighDensityWorkerRequest, HighDensityWorkerResponse, HighDensityWorkerShared } from "./pipeline9HighDensityWorkerTypes"

let shared: HighDensityWorkerShared | undefined
let connMap: ConnectivityMap | undefined

function handleMessage(message: HighDensityWorkerRequest, send: (response: HighDensityWorkerResponse) => void): void {
  try {
    if (message.type === "init") {
      shared = message.shared
      connMap = new ConnectivityMap(shared.connectivityNetMap)
      return
    }
    if (!shared || !connMap) throw new Error("High-density worker has not been initialized")
    const solver = new Pipeline9HighDensitySolver({ ...shared, connMap, nodePortPoints: message.nodes })
    solver.MAX_ITERATIONS = message.maxIterations
    solver.solve()
    send({ type: "result", result: {
      index: message.index,
      routes: solver.routes,
      stats: solver.stats,
      iterations: solver.iterations,
      consumedNodeCount: message.nodes.length - solver.unsolvedNodePortPoints.length,
      solved: solver.solved,
      error: solver.error,
    } })
  } catch (error) {
    send({ type: "error", message: String(error), stack: error instanceof Error ? error.stack : undefined })
  }
}

if (typeof process !== "undefined" && Boolean(process.versions?.bun)) {
  const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<HighDensityWorkerRequest>) => void
    postMessage: (response: HighDensityWorkerResponse) => void
  }
  scope.onmessage = (event): void => handleMessage(event.data, (response): void => scope.postMessage(response))
} else {
  const moduleName = "node:worker_threads"
  const { parentPort } = await import(moduleName) as typeof import("node:worker_threads")
  if (!parentPort) throw new Error("High-density worker requires a worker thread")
  parentPort.on("message", (message: HighDensityWorkerRequest): void => {
    handleMessage(message, (response): void => parentPort.postMessage(response))
  })
}
