import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  getPipeline9DrcErrors,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type ApplyPipeline9ReferenceDrcRepairsParams = {
  srj: RepairSimpleRouteJson
  routes: HighDensityRoute[]
  initialErrors: Pipeline9DrcError[]
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
  effort: number
  maxIterations: number
  viaHoleDiameter: number
  allowViaInPad: boolean
}

export type Pipeline9ReferenceDrcRepairResult = {
  routes: HighDensityRoute[]
  remainingErrors: Pipeline9DrcError[]
  accepted: boolean
  solverStats: Record<string, unknown>
}

/**
 * Uses the authoritative DRC evaluator for the small residue left by the fast
 * indexed repair pass. Route identity, terminal positions, and trace width are
 * invariants: this stage may only adjust interior geometry and vias.
 */
export const applyPipeline9ReferenceDrcRepairs = ({
  srj,
  routes,
  initialErrors,
  connMap,
  drcEvaluator,
  effort,
  maxIterations,
  viaHoleDiameter,
  allowViaInPad,
}: ApplyPipeline9ReferenceDrcRepairsParams): Pipeline9ReferenceDrcRepairResult => {
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    connMap,
    effort,
    drcEvaluator,
    viaHoleDiameter,
    maxIterations,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: allowViaInPad,
    enableTraceViaOwnerTargeting: true,
  })
  solver.solve()
  if (solver.failed || !solver.solved) {
    throw new Error(
      `Pipeline9 reference DRC repair failed: ${solver.error ?? "solver did not finish"}`,
    )
  }

  const candidateRoutes = solver.getOutput()
  if (candidateRoutes.length !== routes.length) {
    throw new Error("Pipeline9 reference DRC repair changed the route count")
  }
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const inputRoute = routes[routeIndex]!
    const candidateRoute = candidateRoutes[routeIndex]!
    const inputStart = inputRoute.route[0]
    const inputEnd = inputRoute.route.at(-1)
    const candidateStart = candidateRoute.route[0]
    const candidateEnd = candidateRoute.route.at(-1)
    if (
      candidateRoute.connectionName !== inputRoute.connectionName ||
      candidateRoute.traceThickness !== inputRoute.traceThickness ||
      !inputStart ||
      !inputEnd ||
      !candidateStart ||
      !candidateEnd ||
      candidateStart.x !== inputStart.x ||
      candidateStart.y !== inputStart.y ||
      candidateStart.z !== inputStart.z ||
      candidateEnd.x !== inputEnd.x ||
      candidateEnd.y !== inputEnd.y ||
      candidateEnd.z !== inputEnd.z
    ) {
      throw new Error(
        `Pipeline9 reference DRC repair changed electrical route identity for "${inputRoute.connectionName}"`,
      )
    }
  }

  const candidateErrors = getPipeline9DrcErrors(
    drcEvaluator,
    candidateRoutes,
  )
  const accepted = isPipeline9DrcCandidateBetter(
    candidateErrors,
    initialErrors,
  )
  return {
    routes: accepted ? candidateRoutes : routes,
    remainingErrors: accepted ? candidateErrors : initialErrors,
    accepted,
    solverStats: solver.stats,
  }
}
