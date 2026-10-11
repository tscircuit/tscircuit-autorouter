import type { FirstValidA13CandidateDispatcher } from "./firstValidA13CandidateTypes"
import type { Obstacle } from "../../types"

export type ParallelHighDensityPolicy = "ordered" | "first-valid"

export type FirstValidHighDensityStats = {
  eligiblePortfolioCount: number
  acceptedCandidateCount: number
  rejectedCandidateCount: number
  rejectionReasons: Record<string, number>
  winners: Array<{
    nodeId: string
    candidateId: number
    candidateIterations: number
    elapsedTimeMs: number
    candidateSource?: "multi-head" | "a13"
    routingIterations?: number
    sourceStats?: Record<string, unknown>
  }>
  candidateWork?: Array<{
    nodeId: string
    candidateSource: "a13"
    status: "solved" | "failed" | "cancelled" | "exception"
    iterations: number
    routingIterations: number
    sourceStats: Record<string, unknown>
  }>
}

export type ParallelHighDensityPolicyOptions = {
  policy: ParallelHighDensityPolicy
  stats?: FirstValidHighDensityStats
  onAcceptedCandidate?: () => void
  clearance?: number
  a13Dispatcher?: FirstValidA13CandidateDispatcher
  requirePhysicalCopper?: boolean
  physicalCopperObstacles?: readonly Obstacle[]
}
