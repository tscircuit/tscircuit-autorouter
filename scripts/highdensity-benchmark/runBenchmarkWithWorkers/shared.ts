import { NodeWithPortPoints } from "lib/types/high-density-types"

export type BenchmarkTask = {
  problem: NodeWithPortPoints
  problemId: string
}

export type WorkerRequest = {
  taskId: number
  problemId: string
  problem: NodeWithPortPoints
}

export type WorkerResponse =
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

export type TaskResult = {
  value: number
  solved: boolean
  solveDurationMs: number
}

export type RunBenchmarkOptions = {
  problems: NodeWithPortPoints[]
  concurrency: number
  timeoutMs: number
}

export type RunBenchmarkResult = {
  results: number[]
  timedOutProblemIds: string[]
  totalDurationMs: number
  passCount: number
}

export const getProblemId = (problem: NodeWithPortPoints, index: number) => {
  if (typeof problem === "object" && problem !== null && "id" in problem) {
    const id = problem.id
    if (typeof id === "string" || typeof id === "number") {
      return String(id)
    }
  }

  return `problem-${index}`
}

export const formatSeconds = (milliseconds: number) =>
  (milliseconds / 1000).toFixed(3)
