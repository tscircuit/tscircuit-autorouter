import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"

export type FirstValidA13CandidateJob = {
  kind: "firstValidA13Candidate"
  params: Omit<ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0], "connMap">
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
  cancellationBuffer?: SharedArrayBuffer
}

type FirstValidA13CandidateWork = {
  kind: "firstValidA13Candidate"
  iterations: number
  maxIterations: number
  routingIterations: number
  sourceStats: Record<string, unknown>
}

export type FirstValidA13CandidateResult = FirstValidA13CandidateWork & (
  | { status: "solved"; routes: HighDensityIntraNodeRoute[] }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { status: "exception"; exception: { name: string; message: string } }
)

export type FirstValidA13CandidateDispatcher = (
  job: FirstValidA13CandidateJob,
) => Promise<{ result: Promise<FirstValidA13CandidateResult> } | null>

export type FirstValidA13CandidateRequest = {
  kind: "requestFirstValidA13Candidate"
  taskId: number
  requestId: number
  job: FirstValidA13CandidateJob
}

export type FirstValidA13CandidateCancellation = {
  kind: "cancelFirstValidA13Candidate"
  taskId: number
}

export type FirstValidA13CandidateGrant = {
  kind: "firstValidA13CandidateGrant"
  taskId: number
  requestId: number
  admitted: boolean
}

export type FirstValidA13CandidateDelivery = {
  kind: "firstValidA13CandidateDelivery"
  taskId: number
  requestId: number
} & ({ ok: true; result: FirstValidA13CandidateResult } | { ok: false; error: string })
