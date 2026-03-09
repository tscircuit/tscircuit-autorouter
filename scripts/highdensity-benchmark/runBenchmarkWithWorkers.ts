import { Worker } from "node:worker_threads"
import { resolve } from "node:path"

type BenchmarkTask = {
  problem: unknown
  problemId: string
}

type WorkerRequest = {
  taskId: number
  problemId: string
  problem: unknown
}

type WorkerResponse =
  | {
      type: "result"
      taskId: number
      value: number
      solved: boolean
      solveDurationMs: number
    }
  | {
      type: "error"
      taskId: number
      error: string
    }

type TaskResult = {
  value: number
  solved: boolean
  solveDurationMs: number
}

type TaskState = {
  resolve: (value: TaskResult | null) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

type WorkerSlot = {
  worker: Worker
  currentTaskId: number | null
}

type RunBenchmarkOptions = {
  problems: unknown[]
  concurrency: number
  timeoutMs: number
}

type RunBenchmarkResult = {
  results: number[]
  timedOutProblemIds: string[]
}

const workerPath = resolve(import.meta.dir, "./worker.ts")

const getProblemId = (problem: unknown, index: number) => {
  // Keep timeout reporting readable by assigning each task a stable label.
  // Prefer a stable dataset identifier when one exists and fall back to the index.
  if (typeof problem === "object" && problem !== null && "id" in problem) {
    const id = (problem as { id?: unknown }).id
    if (typeof id === "string" || typeof id === "number") {
      return String(id)
    }
  }

  return `problem-${index}`
}

const createWorker = () => {
  // Each worker runs one benchmark task at a time so timeouts are easy to enforce.
  return new Worker(workerPath)
}

const terminateWorker = async (slot: WorkerSlot) => {
  // Worker termination is async in Bun/Node, so await it before replacing the slot.
  await slot.worker.terminate()
  slot.currentTaskId = null
}

const formatSeconds = (milliseconds: number) => {
  return (milliseconds / 1000).toFixed(3)
}

const runTaskOnWorker = (
  slot: WorkerSlot,
  task: BenchmarkTask,
  taskId: number,
  timeoutMs: number,
): Promise<TaskResult | null> => {
  // This wrapper isolates all event wiring for a single task assignment.
  // The promise resolves with a score or null for timeouts, and rejects on worker failures.
  return new Promise<TaskResult | null>((resolveTask, rejectTask) => {
    // The timeout path kills the worker so stuck CPU work cannot continue in the background.
    const timeoutId = setTimeout(async () => {
      slot.worker.off("message", onMessage)
      slot.worker.off("error", onError)
      slot.worker.off("exit", onExit)

      try {
        await terminateWorker(slot)
        slot.worker = createWorker()
        resolveTask(null)
      } catch (error) {
        rejectTask(error instanceof Error ? error : new Error(String(error)))
      }
    }, timeoutMs)

    const state: TaskState = {
      resolve: resolveTask,
      reject: rejectTask,
      timeoutId,
    }

    // Successful completion and hard failures share the same listener cleanup.
    const finishTask = (callback: () => void) => {
      clearTimeout(state.timeoutId)
      slot.worker.off("message", onMessage)
      slot.worker.off("error", onError)
      slot.worker.off("exit", onExit)
      slot.currentTaskId = null
      callback()
    }

    // Worker replies are filtered by task id so respawned workers stay safe.
    const onMessage = (message: WorkerResponse) => {
      if (message.taskId !== taskId) return

      if (message.type === "result") {
        finishTask(() =>
          state.resolve({
            value: message.value,
            solved: message.solved,
            solveDurationMs: message.solveDurationMs,
          }),
        )
        return
      }

      finishTask(() => state.reject(new Error(message.error)))
    }

    // Errors and unexpected exits are promoted to hard benchmark failures.
    const onError = (error: Error) => {
      finishTask(() => state.reject(error))
    }

    const onExit = (code: number) => {
      if (code === 0 || slot.currentTaskId === null) return
      finishTask(() =>
        state.reject(new Error(`Worker exited with code ${code}`)),
      )
    }

    // Post the problem only after every listener is attached.
    slot.currentTaskId = taskId
    slot.worker.on("message", onMessage)
    slot.worker.once("error", onError)
    slot.worker.once("exit", onExit)
    slot.worker.postMessage({
      taskId,
      problemId: task.problemId,
      problem: task.problem,
    } satisfies WorkerRequest)
  })
}

export const runBenchmarkWithWorkers = async ({
  problems,
  concurrency,
  timeoutMs,
}: RunBenchmarkOptions): Promise<RunBenchmarkResult> => {
  // Turn the raw dataset into queue items before any worker starts running.
  const tasks = problems.map((problem, index) => ({
    problem,
    problemId: getProblemId(problem, index),
  }))

  // Exit early when the dataset is empty so we do not create pointless workers.
  if (tasks.length === 0) {
    return {
      results: [],
      timedOutProblemIds: [],
    }
  }

  // Bound the pool size by the task count so we do not create idle workers unnecessarily.
  const workerCount = Math.max(1, Math.min(concurrency, tasks.length))
  console.log(
    `Starting high-density benchmark with ${workerCount} workers across ${tasks.length} cases`,
  )
  const slots = Array.from({ length: workerCount }, () => ({
    worker: createWorker(),
    currentTaskId: null,
  }))

  const results: number[] = []
  const timedOutProblemIds: string[] = []
  let completedProblems = 0
  let nextTaskIndex = 0
  let nextTaskId = 1

  try {
    // Every slot repeatedly grabs the next task from the shared queue.
    // Each slot drains the shared queue until no work remains.
    await Promise.all(
      slots.map(async (slot) => {
        while (nextTaskIndex < tasks.length) {
          const task = tasks[nextTaskIndex++]
          const result = await runTaskOnWorker(
            slot,
            task,
            nextTaskId++,
            timeoutMs,
          )

          // Timed-out problems are tracked, but intentionally excluded from the MSE inputs.
          if (result === null) {
            timedOutProblemIds.push(task.problemId)
            continue
          }

          completedProblems += 1
          console.log(
            `${task.problemId} ${result.solved ? "pass" : "fail"} solve in ${formatSeconds(result.solveDurationMs)} seconds (${completedProblems}/${tasks.length})`,
          )
          results.push(result.value)
        }
      }),
    )
  } finally {
    // Always clean up workers so the script can exit cleanly after the queue completes.
    await Promise.all(slots.map((slot) => terminateWorker(slot)))
  }

  return {
    results,
    timedOutProblemIds,
  }
}
