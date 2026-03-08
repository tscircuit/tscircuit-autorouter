import { availableParallelism } from "node:os"
import { currentVersion } from "../config/paths.ts"
import { getAllProblemFileNames } from "../dataset/getAllProblemFileNames.ts"
import type { SolveResult } from "../types/SolveResult.ts"

type WorkerSolveResult = SolveResult & {
  error?: string
}

type RunCurrentSolverOptions = {
  concurrency?: number
  timeoutSeconds?: number
}

type ActiveTask = {
  fileName: string
  startedAt: number
}

const DEFAULT_TIMEOUT_SECONDS = 1000
const ACTIVE_TASK_LOG_INTERVAL_MS = 30_000

const getDefaultConcurrency = (problemCount: number) =>
  Math.max(1, Math.min(problemCount, availableParallelism()))

const createSolverWorker = () =>
  new Worker(new URL("./runCurrentSolver.worker.ts", import.meta.url), {
    type: "module",
  })

const formatActiveTaskStatus = (
  activeTasks: Map<number, ActiveTask>,
  problemCount: number,
) => {
  if (activeTasks.size === 0) {
    return null
  }

  const status = [...activeTasks.entries()]
    .sort((left, right) => left[1].startedAt - right[1].startedAt)
    .map(([workerIndex, task]) => {
      const elapsedSeconds = (performance.now() - task.startedAt) / 1000
      return `worker ${workerIndex + 1}: ${task.fileName} (${elapsedSeconds.toFixed(1)}s)`
    })

  return `Still running ${activeTasks.size}/${problemCount} active task${activeTasks.size === 1 ? "" : "s"}: ${status.join(", ")}`
}

export const runCurrentSolver = async (
  options: RunCurrentSolverOptions = {},
): Promise<SolveResult[]> => {
  const { concurrency = 0, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS } = options
  const problemFileNames = await getAllProblemFileNames()
  const results = new Array<SolveResult>(problemFileNames.length)

  if (problemFileNames.length === 0) {
    return []
  }

  const workerCount = Math.max(
    1,
    Math.min(
      problemFileNames.length,
      concurrency > 0
        ? concurrency
        : getDefaultConcurrency(problemFileNames.length),
    ),
  )

  console.warn(
    `Running ${problemFileNames.length} high-density problems with local solver ${currentVersion} using ${workerCount} worker${workerCount === 1 ? "" : "s"} (timeout ${timeoutSeconds}s)`,
  )

  const activeTasks = new Map<number, ActiveTask>()
  const activeTaskLogger = setInterval(() => {
    const status = formatActiveTaskStatus(activeTasks, problemFileNames.length)
    if (status) {
      console.warn(status)
    }
  }, ACTIVE_TASK_LOG_INTERVAL_MS)

  let nextProblemIndex = 0
  let completed = 0
  const finalWorkers = new Array<Worker>(workerCount)

  const runSingleProblem = async (
    worker: Worker,
    workerIndex: number,
    fileName: string,
  ): Promise<{ nextWorker: Worker; result: WorkerSolveResult }> =>
    new Promise((resolve) => {
      const startedAt = performance.now()
      activeTasks.set(workerIndex, { fileName, startedAt })
      let settled = false

      const cleanup = () => {
        clearTimeout(timeoutId)
        worker.removeEventListener("message", onMessage)
        worker.removeEventListener("error", onError)
        activeTasks.delete(workerIndex)
      }

      const finish = (result: WorkerSolveResult, nextWorker = worker) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ nextWorker, result })
      }

      const onMessage = (event: MessageEvent<WorkerSolveResult>) => {
        finish(event.data)
      }

      const onError = (event: Event | ErrorEvent) => {
        worker.terminate()
        finish(
          {
            fileName,
            didSolve: false,
            timeSeconds: (performance.now() - startedAt) / 1000,
            error:
              event instanceof ErrorEvent
                ? event.message || "worker failed"
                : "worker failed",
          },
          createSolverWorker(),
        )
      }

      const timeoutId = setTimeout(() => {
        worker.terminate()
        finish(
          {
            fileName,
            didSolve: false,
            timeSeconds: timeoutSeconds,
            error: `timed out after ${timeoutSeconds}s`,
          },
          createSolverWorker(),
        )
      }, timeoutSeconds * 1000)

      worker.addEventListener("message", onMessage, { once: true })
      worker.addEventListener("error", onError, { once: true })
      worker.postMessage({ fileName })
    })

  const assignWork = async (initialWorker: Worker, workerIndex: number) => {
    let worker = initialWorker

    while (true) {
      const problemIndex = nextProblemIndex
      if (problemIndex >= problemFileNames.length) {
        finalWorkers[workerIndex] = worker
        return
      }
      nextProblemIndex += 1

      const fileName = problemFileNames[problemIndex]
      const { nextWorker, result } = await runSingleProblem(
        worker,
        workerIndex,
        fileName,
      )
      worker = nextWorker

      results[problemIndex] = {
        fileName: result.fileName,
        didSolve: result.didSolve,
        timeSeconds: result.timeSeconds,
      }
      completed += 1

      const suffix = result.error ? ` (${result.error})` : ""
      console.warn(
        `[${completed}/${problemFileNames.length}] ${result.fileName} -> ${result.didSolve ? "PASS" : "FAIL"} in ${result.timeSeconds.toFixed(3)}s${suffix}`,
      )
    }
  }

  try {
    await Promise.all(
      Array.from({ length: workerCount }, (_, workerIndex) =>
        assignWork(createSolverWorker(), workerIndex),
      ),
    )
  } finally {
    clearInterval(activeTaskLogger)
    for (const worker of finalWorkers) {
      worker?.terminate()
    }
  }

  return results
}
