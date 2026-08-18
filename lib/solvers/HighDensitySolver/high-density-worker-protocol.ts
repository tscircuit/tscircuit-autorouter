import type {
  HighDensityNodeSolveResult,
  HighDensityNodeSolveTask,
  HighDensitySolverExecutionContext,
} from "./high-density-parallel-types"

export type HighDensityWorkerRequest =
  | {
      type: "initialize"
      context: HighDensitySolverExecutionContext
    }
  | {
      type: "solve"
      requestId: number
      task: HighDensityNodeSolveTask
    }

export type HighDensityWorkerResponse =
  | { type: "ready" }
  | {
      type: "result"
      requestId: number
      result: HighDensityNodeSolveResult
    }
  | {
      type: "error"
      requestId?: number
      error: string
    }
