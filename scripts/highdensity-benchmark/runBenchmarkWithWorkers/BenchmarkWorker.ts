import { Worker } from "node:worker_threads"
import { resolve } from "node:path"
import {
  BenchmarkTask,
  TaskResult,
  WorkerRequest,
  WorkerResponse,
} from "./shared.ts"

const workerPath = resolve(import.meta.dir, "../worker.ts")

const createWorker = () => new Worker(workerPath)

export class BenchmarkWorker {
  private worker = createWorker()
  private activeTaskId: number | null = null

  async runTask(
    task: BenchmarkTask,
    taskId: number,
    timeoutMs: number,
  ): Promise<TaskResult | null> {
    return new Promise<TaskResult | null>((resolveTask, rejectTask) => {
      const finish = (callback: () => void) => {
        clearTimeout(timeoutId)
        this.worker.off("message", onMessage)
        this.worker.off("error", onError)
        this.worker.off("exit", onExit)
        this.activeTaskId = null
        callback()
      }

      const onMessage = (message: WorkerResponse) => {
        if (message.taskId !== taskId) return

        if (message.type === "result") {
          finish(() =>
            resolveTask({
              value: message.value,
              solved: message.solved,
              solveDurationMs: message.solveDurationMs,
            }),
          )
          return
        }

        finish(() => rejectTask(new Error(message.error)))
      }

      const onError = (error: Error) => {
        finish(() => rejectTask(error))
      }

      const onExit = (code: number) => {
        if (code === 0 || this.activeTaskId === null) return
        finish(() => rejectTask(new Error(`Worker exited with code ${code}`)))
      }

      const timeoutId = setTimeout(() => {
        void this.handleTimeout(
          onMessage,
          onError,
          onExit,
          resolveTask,
          rejectTask,
        )
      }, timeoutMs)

      this.activeTaskId = taskId
      this.worker.on("message", onMessage)
      this.worker.once("error", onError)
      this.worker.once("exit", onExit)
      this.worker.postMessage({
        taskId,
        problemId: task.problemId,
        problem: task.problem,
      } satisfies WorkerRequest)
    })
  }

  async close() {
    this.activeTaskId = null
    await this.worker.terminate()
  }

  private async handleTimeout(
    onMessage: (message: WorkerResponse) => void,
    onError: (error: Error) => void,
    onExit: (code: number) => void,
    resolveTask: (value: TaskResult | null) => void,
    rejectTask: (error: Error) => void,
  ) {
    this.worker.off("message", onMessage)
    this.worker.off("error", onError)
    this.worker.off("exit", onExit)

    try {
      await this.restart()
      resolveTask(null)
    } catch (error) {
      rejectTask(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async restart() {
    await this.close()
    this.worker = createWorker()
  }
}
