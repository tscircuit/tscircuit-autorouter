import { BenchmarkWorker } from "./BenchmarkWorker.ts"
import {
  BenchmarkTask,
  RunBenchmarkOptions,
  RunBenchmarkResult,
  formatSeconds,
  getProblemId,
} from "./shared.ts"

export class BenchmarkWorkerPool {
  private readonly tasks: BenchmarkTask[]
  private readonly workers: BenchmarkWorker[]
  private readonly timeoutMs: number
  private readonly results: number[] = []
  private readonly timedOutProblemIds: string[] = []
  private completedProblems = 0
  private nextTaskIndex = 0
  private nextTaskId = 1

  constructor({ problems, concurrency, timeoutMs }: RunBenchmarkOptions) {
    this.tasks = problems.map((problem, index) => ({
      problem,
      problemId: getProblemId(problem, index),
    }))

    const workerCount =
      this.tasks.length === 0
        ? 0
        : Math.max(1, Math.min(concurrency, this.tasks.length))

    this.workers = Array.from(
      { length: workerCount },
      () => new BenchmarkWorker(),
    )
    this.timeoutMs = timeoutMs
  }

  static async run(
    options: RunBenchmarkOptions,
  ): Promise<RunBenchmarkResult> {
    const pool = new BenchmarkWorkerPool(options)
    return pool.run()
  }

  private async run(): Promise<RunBenchmarkResult> {
    if (this.tasks.length === 0) {
      return {
        results: [],
        timedOutProblemIds: [],
      }
    }

    console.log(
      `Starting high-density benchmark with ${this.workers.length} workers across ${this.tasks.length} cases`,
    )

    try {
      await Promise.all(this.workers.map((worker) => this.drainQueue(worker)))
    } finally {
      await Promise.all(this.workers.map((worker) => worker.close()))
    }

    return {
      results: this.results,
      timedOutProblemIds: this.timedOutProblemIds,
    }
  }

  private async drainQueue(worker: BenchmarkWorker) {
    while (true) {
      const task = this.takeNextTask()
      if (!task) return

      const result = await worker.runTask(task, this.nextTaskId++, this.timeoutMs)
      if (result === null) {
        this.timedOutProblemIds.push(task.problemId)
        continue
      }

      this.completedProblems += 1
      console.log(
        `${task.problemId} ${result.solved ? "pass" : "fail"} solve in ${formatSeconds(result.solveDurationMs)} seconds (${this.completedProblems}/${this.tasks.length})`,
      )
      this.results.push(result.value)
    }
  }

  private takeNextTask() {
    const task = this.tasks[this.nextTaskIndex]
    if (!task) return null

    this.nextTaskIndex += 1
    return task
  }
}
