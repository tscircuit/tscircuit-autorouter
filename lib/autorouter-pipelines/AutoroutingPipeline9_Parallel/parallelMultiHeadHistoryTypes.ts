import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import type { MultiHeadPolyLineIntraNodeSolver3 } from "../../solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

export type MultiHeadStepSnapshot = {
  iterations: number
  maxIterations: number
  solved: boolean
  failed: boolean
  error: string | null
  progress: number
  exception?: { name: string; message: string }
}

export type MultiHeadHistoryJob = {
  kind: "multiHeadHistory"
  candidateId: number
  params: Omit<ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver3>[0], "connMap">
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
}

export type MultiHeadHistoryResult = {
  kind: "multiHeadHistory"
  initial: MultiHeadStepSnapshot
  steps: MultiHeadStepSnapshot[]
  solvedRoutes: HighDensityIntraNodeRoute[]
}

export type MultiHeadHistoryDispatcher = (
  jobs: MultiHeadHistoryJob[],
) => Promise<Map<number, Promise<MultiHeadHistoryResult>>>

export type MultiHeadHistoryRequest = {
  kind: "requestMultiHeadHistories"
  taskId: number
  requestId: number
  jobs: MultiHeadHistoryJob[]
}

export type MultiHeadHistoryGrant = {
  kind: "multiHeadHistoryGrant"
  taskId: number
  requestId: number
  admittedCandidateIds: number[]
}

export type MultiHeadHistoryDelivery = {
  kind: "multiHeadHistoryDelivery"
  taskId: number
  requestId: number
  candidateId: number
} & ({ ok: true; result: MultiHeadHistoryResult } | { ok: false; error: string })
