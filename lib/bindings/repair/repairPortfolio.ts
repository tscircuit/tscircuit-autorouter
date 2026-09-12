import type { AutoroutingDrcEngine } from "lib/bindings/repair/AutoroutingDrcEngine"
import { GlobalDrcBranchPortfolioSolver } from "lib/bindings/repair/GlobalDrcBranchPortfolioSolver"
import type { BaseSolver } from "@tscircuit/solver-utils"
import {
  type GlobalDrcBranchPortfolioSolverParams,
  type DrcEvaluator,
  type AutoroutingDrcEngineOptions,
  type HighDensityRoute,
  type SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import type { Obstacle, SimpleRouteConnection, SimplifiedPcbTrace } from "lib/types"

export type RepairPortfolioDescriptor = {
  engineSrj: RepairSimpleRouteJson
  engineOptions: Omit<AutoroutingDrcEngineOptions, "connMap">
  solverSrj: RepairSimpleRouteJson
  connMap: { netMap: Record<string, string[]>; idToNetMap: Record<string, string> } | null
  originalTraces: SimplifiedPcbTrace[]
  newConnections: SimpleRouteConnection[]
  originalConnections: SimpleRouteConnection[]
  layerCount: number
  defaultViaHoleDiameter: number
  obstacles: Obstacle[]
  movablePreloadedSections: Array<{
    syntheticConnectionName: string
    evaluationTraceId: string
    originalTrace: SimplifiedPcbTrace
  }>
  nonMovableMutatedPreloadedTraces: SimplifiedPcbTrace[]
}

export type PreparedRepairDrc = {
  engine: AutoroutingDrcEngine
  baseline: { errors: unknown[]; errorsWithCenters: unknown[] }
}

export type RepairEvaluationCounters = {
  indexedDrcEvaluationCount: number
  indexedDrcCacheHitCount: number
  indexedDrcCandidateCacheSize: number
  indexedDrcEvaluationTimeMs?: number
}

export type RepairPortfolio = BaseSolver & {
  readonly params: GlobalDrcBranchPortfolioSolverParams
  getOutput: () => HighDensityRoute[]
  getRepairEvaluationCounters?: () => RepairEvaluationCounters
}

export function createRepairPortfolio(
  params: GlobalDrcBranchPortfolioSolverParams,
  descriptor: RepairPortfolioDescriptor,
  referenceEvaluator: DrcEvaluator,
  preparedDrc?: PreparedRepairDrc,
): RepairPortfolio {
  return new GlobalDrcBranchPortfolioSolver(params, descriptor, referenceEvaluator, preparedDrc)
}
