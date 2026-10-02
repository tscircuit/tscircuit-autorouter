import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type Pipeline9BoundedRegionalRepairResult = {
  routes: HighDensityRoute[]
  attemptedRegionCount: number
  acceptedRegionCount: number
  candidateAttemptCount: number
  pathSearchNodeCount: number
  referenceValidationCount: number
  initialDrcIssueCount: number | undefined
  finalDrcIssueCount: number | undefined
  publishedDrcIssueCount: number | undefined
  repaired: boolean
}

export const PIPELINE9_BOUNDED_REPAIR_BUDGET = {
  maxRegions: 4,
  maxCandidateAttempts: 1024,
  maxPathSearchNodes: 480_000,
} as const

export type Pipeline9BoundedRepairBudget = {
  maxRegions: number
  maxCandidateAttempts: number
  maxPathSearchNodes: number
  initialMaxRegions?: number
  initialMaxCandidateAttempts?: number
  initialMaxPathSearchNodes?: number
  regionsPerAcceptedRepair?: number
  candidateAttemptsPerAcceptedRepair?: number
  pathSearchNodesPerAcceptedRepair?: number
  maxPathSearchNodesPerCall?: number
  maxCandidateAttemptsPerRegion?: number
  pathGridSizeScale?: number
  pathHeuristicWeight?: number
  revisitChangedRegions?: boolean
  regionSizes?: readonly number[]
}

export const getPipeline9BoundedRepairBudget = (
  _routeCount: number,
  _drcIssueCount: number,
  effort: number,
): Pipeline9BoundedRepairBudget => {
  if (!Number.isFinite(effort) || effort <= 0) {
    throw new Error(
      "Pipeline9 regional repair effort must be positive and finite",
    )
  }
  // Every board starts with the same bounded allowance. Strict whole-board
  // DRC improvements earn more search work; board size never changes policy.
  // Effort scales both the initial allowance and the total ceiling smoothly.
  const scale = Math.max(1, effort)
  return {
    maxRegions: Math.ceil(24 * scale),
    maxCandidateAttempts: Math.ceil(4096 * scale),
    maxPathSearchNodes: Math.ceil(40_000_000 * scale),
    initialMaxRegions: Math.ceil(4 * scale),
    initialMaxCandidateAttempts: Math.ceil(1024 * scale),
    initialMaxPathSearchNodes: Math.ceil(2_000_000 * scale),
    regionsPerAcceptedRepair: 2,
    candidateAttemptsPerAcceptedRepair: 512,
    pathSearchNodesPerAcceptedRepair: 2_000_000,
    maxCandidateAttemptsPerRegion: 512,
    maxPathSearchNodesPerCall: 1_000_000,
    pathGridSizeScale: 2,
    pathHeuristicWeight: 3,
    revisitChangedRegions: true,
    regionSizes: [16, 32],
  }
}

export type Pipeline9BoundedRegionalRepairParams = {
  originalSrj: SimpleRouteJson
  connMap?: ConnectivityMap
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  viaHoleDiameter?: number
  budget?: Pipeline9BoundedRepairBudget
}


type RepairAllowance = {
  maxRegions: number
  maxCandidateAttempts: number
  maxPathSearchNodes: number
}

export const getPipeline9BoundedRepairAllowance = (
  budget: Pipeline9BoundedRepairBudget,
  acceptedRegionCount: number,
): RepairAllowance => ({
  maxRegions: Math.min(
    budget.maxRegions,
    (budget.initialMaxRegions ?? budget.maxRegions) +
      acceptedRegionCount * (budget.regionsPerAcceptedRepair ?? 0),
  ),
  maxCandidateAttempts: Math.min(
    budget.maxCandidateAttempts,
    (budget.initialMaxCandidateAttempts ?? budget.maxCandidateAttempts) +
      acceptedRegionCount * (budget.candidateAttemptsPerAcceptedRepair ?? 0),
  ),
  maxPathSearchNodes: Math.min(
    budget.maxPathSearchNodes,
    (budget.initialMaxPathSearchNodes ?? budget.maxPathSearchNodes) +
      acceptedRegionCount * (budget.pathSearchNodesPerAcceptedRepair ?? 0),
  ),
})
