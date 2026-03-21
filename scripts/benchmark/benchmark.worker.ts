import type {
  BenchmarkTask,
  WorkerResult,
  WorkerResultMessage,
  WorkerTaskMessage,
} from "./benchmark-types"
import { runTask } from "./benchmark-run-task"

self.onmessage = async (event: MessageEvent<WorkerTaskMessage>) => {
  const { taskId, task } = event.data

  try {
    const result = await runTask(task)
    self.postMessage({
      taskId,
      result,
    } satisfies WorkerResultMessage)
  } catch (error) {
    self.postMessage({
      taskId,
      result: {
        solverName: task.solverName,
        scenarioName: task.scenarioName,
        elapsedTimeMs: 0,
        didSolve: false,
        didTimeout: false,
        relaxedDrcPassed: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerResult,
    } satisfies WorkerResultMessage)
  }
}
