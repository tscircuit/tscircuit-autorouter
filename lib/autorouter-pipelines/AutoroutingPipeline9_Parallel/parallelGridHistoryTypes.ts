import type { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"

/** The existing native portfolio observes grid candidates every 100 steps. */
export const PARALLEL_GRID_HISTORY_QUANTUM = 100

export type GridHistorySnapshot = {
  iterations: number
  maxIterations: number
  solved: boolean
  failed: boolean
  error: string | null
  progress: number
  solvedSegmentCount: number
  stats: Record<string, unknown>
  exception?: { name: string; message: string; stack?: string }
}

type GridHistoryJobBase = {
  kind: "gridHistory"
  candidateId: number
  /** The original owner applies this exact limit after native setup. */
  maxIterations: number
  ownerIterations: number
  cancellationBuffer?: SharedArrayBuffer
}

export type GridHistoryJob = GridHistoryJobBase & (
  | { algorithm: "a01"; params: Omit<ConstructorParameters<typeof HighDensitySolverA01>[0], "initialPenaltyFn"> }
  | { algorithm: "a03"; params: Omit<ConstructorParameters<typeof HighDensitySolverA03>[0], "initialPenaltyFn"> }
)

export type GridHistoryResult = {
  kind: "gridHistory"
  algorithm: GridHistoryJob["algorithm"]
  initial: GridHistorySnapshot
  checkpoints: GridHistorySnapshot[]
  /** Native getOutput, evaluated once after its original terminal step. */
  output: HighDensityIntraNodeRoute[]
  outputException?: { name: string; message: string; stack?: string }
  computedIterations: number
  cancelled?: boolean
}

export type GridHistoryDispatcher = (
  jobs: GridHistoryJob[],
) => Promise<Map<number, Promise<GridHistoryResult>>>

export type GridHistoryRequest = {
  kind: "requestGridHistories"
  taskId: number
  requestId: number
  jobs: GridHistoryJob[]
}

export type GridHistoryCancellation = {
  kind: "cancelGridHistories"
  taskId: number
}

export type GridHistoryGrant = {
  kind: "gridHistoryGrant"
  taskId: number
  requestId: number
  admittedCandidateIds: number[]
}

export type GridHistoryDelivery = {
  kind: "gridHistoryDelivery"
  taskId: number
  requestId: number
  candidateId: number
} & ({ ok: true; result: GridHistoryResult } | { ok: false; error: string })
