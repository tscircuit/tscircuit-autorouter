import { BenchmarkWorker } from "./BenchmarkWorker.ts"
import {
  BenchmarkTask,
  RunBenchmarkOptions,
  RunBenchmarkResult,
  getProblemId,
} from "./shared.ts"

export class BenchmarkWorkerPool {
  private readonly tasks: BenchmarkTask[]
  private readonly workers: BenchmarkWorker[]
  private readonly timeoutMs: number
  private readonly results: number[] = []
  private readonly timedOutProblemIds: string[] = []
  private passCount = 0
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

  static async run(options: RunBenchmarkOptions): Promise<RunBenchmarkResult> {
    const pool = new BenchmarkWorkerPool(options)
    return pool.run()
  }

  private async run(): Promise<RunBenchmarkResult> {
    if (this.tasks.length === 0) {
      return {
        results: [],
        timedOutProblemIds: [],
        totalDurationMs: 0,
        passCount: 0,
      }
    }

    console.log(
      `Starting high-density benchmark with ${this.workers.length} workers across ${this.tasks.length} cases`,
    )

    const startedAt = Date.now()

    try {
      await this.runWorkers()
    } finally {
      await this.closeWorkers()
    }

    return {
      results: this.results,
      timedOutProblemIds: this.timedOutProblemIds,
      totalDurationMs: Date.now() - startedAt,
      passCount: this.passCount,
    }
  }

  private async drainQueue(worker: BenchmarkWorker) {
    while (true) {
      const task = this.takeNextTask()
      if (!task) return

      const result = await worker.runTask(
        task,
        this.nextTaskId++,
        this.timeoutMs,
      )
      if (result === null) {
        this.timedOutProblemIds.push(task.problemId)
        this.logProgress()
        continue
      }

      this.completedProblems += 1
      if (result.solved) {
        this.passCount += 1
      }
      this.results.push(result.value)
      this.logProgress()
    }
  }

  private async runWorkers() {
    const drainPromises: Array<Promise<void>> = []

    for (const worker of this.workers) {
      drainPromises.push(this.drainQueue(worker))
    }

    await Promise.all(drainPromises)
  }

  private async closeWorkers() {
    for (const worker of this.workers) {
      await worker.close()
    }
  }

  private takeNextTask() {
    const task = this.tasks[this.nextTaskIndex]
    if (!task) return null

    this.nextTaskIndex += 1
    return task
  }

  private logProgress() {
    const processedProblems =
      this.completedProblems + this.timedOutProblemIds.length
    const completedRatio =
      this.completedProblems === 0 ? 0 : this.passCount / this.completedProblems

    console.log(
      `Progress ${processedProblems}/${this.tasks.length} | pass ${(
        completedRatio * 100
      ).toFixed(1)}%`,
    )
  }
}
