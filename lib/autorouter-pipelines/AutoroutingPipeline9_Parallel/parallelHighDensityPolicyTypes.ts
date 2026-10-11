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
  }>
}

export type ParallelHighDensityPolicyOptions = {
  policy: ParallelHighDensityPolicy
  stats?: FirstValidHighDensityStats
  onAcceptedCandidate?: () => void
  clearance?: number
}
