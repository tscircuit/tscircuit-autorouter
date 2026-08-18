import type {
  HighDensityWorkerRequest,
  HighDensityWorkerResponse,
} from "./solvers/HighDensitySolver/high-density-worker-protocol"
import { createHighDensityNodeTaskHandler } from "./solvers/HighDensitySolver/solveHighDensityNodeTask"

type HighDensityWorkerScope = {
  onmessage: ((event: MessageEvent<HighDensityWorkerRequest>) => void) | null
  postMessage(message: HighDensityWorkerResponse): void
}

const workerScope = globalThis as unknown as HighDensityWorkerScope
let solveNodeTask: ReturnType<typeof createHighDensityNodeTaskHandler> | null =
  null

workerScope.onmessage = (event): void => {
  const request = event.data
  if (request.type === "initialize") {
    solveNodeTask = createHighDensityNodeTaskHandler(request.context)
    workerScope.postMessage({ type: "ready" })
    return
  }

  if (!solveNodeTask) {
    workerScope.postMessage({
      type: "error",
      requestId: request.requestId,
      error: "High-density worker received a task before initialization",
    })
    return
  }

  try {
    workerScope.postMessage({
      type: "result",
      requestId: request.requestId,
      result: solveNodeTask(request.task),
    })
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
