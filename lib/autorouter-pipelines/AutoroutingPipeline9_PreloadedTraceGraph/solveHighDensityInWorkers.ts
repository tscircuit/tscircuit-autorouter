import type { NodeWithPortPoints } from "../../types/high-density-types"
import type { HighDensityWorkerShared, HighDensityWorkerRequest, HighDensityWorkerResponse, HighDensityWorkerResult, Pipeline9SolveAsyncOptions } from "./pipeline9HighDensityWorkerTypes"

type WorkerHandle = {
  postMessage(message: HighDensityWorkerRequest): void
  terminate(): unknown
}

/** Workers own their solver state; only immutable inputs cross the thread boundary. */
export async function solveHighDensityInWorkers(
  nodes: NodeWithPortPoints[],
  shared: HighDensityWorkerShared,
  maxIterations: number,
  options: Pipeline9SolveAsyncOptions,
): Promise<HighDensityWorkerResult[]> {
  // Some hosts (including the SVG test preload) replace the Web Worker global
  // with Node's Worker. Select the API that is actually present.
  const useBunWorker = Boolean(process.versions?.bun) &&
    typeof Worker !== "undefined" && typeof Worker.prototype.addEventListener === "function"
  const osModule = "node:os"
  const threadsModule = "node:worker_threads"
  const { availableParallelism } = await import(osModule) as typeof import("node:os")
  const workerCount = options.workerCount ?? Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2)))
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) throw new Error("workerCount must be a positive integer")
  const NodeWorker = useBunWorker ? undefined : (await import(threadsModule) as typeof import("node:worker_threads")).Worker
  const workerUrl = new URL(import.meta.url.endsWith(".ts") ? "./pipeline9HighDensityWorker.ts" : "./pipeline9HighDensityWorker.js", import.meta.url)
  // Small jobs let idle workers pick up more work without changing commit order.
  const jobs: NodeWithPortPoints[][] = []
  for (let offset = 0; offset < nodes.length; offset += 4) jobs.push(nodes.slice(offset, offset + 4).reverse())
  const results = new Array<HighDensityWorkerResult>(jobs.length)
  const workers: WorkerHandle[] = []
  let next = 0
  let completed = 0
  let stopping = false
  try {
    await new Promise<void>((resolve, reject): void => {
      for (let slot = 0; slot < Math.min(workerCount, jobs.length); slot++) {
        const worker = useBunWorker ? new Worker(workerUrl.href, { type: "module", ...{ ref: true } }) : new NodeWorker!(workerUrl)
        workers.push(worker)
        let activeIndex: number | null = null
        const dispatch = (): void => {
          if (next >= jobs.length) {
            activeIndex = null
            return
          }
          activeIndex = next++
          worker.postMessage({ type: "solve", index: activeIndex, nodes: jobs[activeIndex]!, maxIterations })
        }
        const onMessage = (message: HighDensityWorkerResponse): void => {
          if (stopping) return
          if (message.type === "error") {
            reject(new Error(message.message))
            return
          }
          if (message.result.index !== activeIndex) {
            reject(new Error("High-density worker response does not match its assigned job"))
            return
          }
          results[message.result.index] = message.result
          completed++
          if (completed === jobs.length) resolve()
          else dispatch()
        }
        if (useBunWorker) {
          const bunWorker = worker as Worker
          bunWorker.onmessage = (event: MessageEvent<HighDensityWorkerResponse>): void => onMessage(event.data)
          bunWorker.onerror = (event: ErrorEvent): void => reject(new Error(event.message))
          bunWorker.addEventListener("close", (): void => {
            if (completed < jobs.length) reject(new Error("High-density worker exited before finishing"))
          })
        } else {
          const nodeWorker = worker as import("node:worker_threads").Worker
          nodeWorker.on("message", onMessage)
          nodeWorker.on("error", reject)
          nodeWorker.on("exit", (code): void => {
            if (completed < jobs.length) reject(new Error(`High-density worker exited before finishing (code ${code})`))
          })
        }
        worker.postMessage({ type: "init", shared })
        dispatch()
      }
      if (jobs.length === 0) resolve()
    })
    return results
  } finally {
    stopping = true
    await Promise.all(workers.map(async (worker): Promise<void> => { await worker.terminate() }))
  }
}
