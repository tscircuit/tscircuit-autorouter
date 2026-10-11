import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9LocalWorkerJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"

export type ControlledFrontierTask = { job: Pipeline9LocalWorkerJob; resolve(result: unknown): void; reject(error: Error): void }
export class FirstValidFrontierControlledPool extends Pipeline9LocalWorkerPool {
  readonly tasks: ControlledFrontierTask[] = []

  override run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    return new Promise<T>((resolve, reject): void => {
      this.tasks.push({ job, resolve: (result: unknown): void => resolve(result as T), reject })
    })
  }
}
