import type { SimpleRouteJson } from "../../lib/types/srj-types"

export type BenchmarkTask = {
  solverName: string
  scenarioName: string
  scenario: SimpleRouteJson
}

export type WorkerTaskMessage = {
  taskId: number
  task: BenchmarkTask
}

export type WorkerResult = {
  solverName: string
  scenarioName: string
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  error?: string
}

export type WorkerResultMessage = {
  taskId: number
  result: WorkerResult
}
