import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const residualLocalRerouteInputRoute: HighDensityRoute = {
  connectionName: "route",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
}

export const residualLocalRerouteError = {
  type: "pcb_trace_error",
  pcb_trace_id: "route_0",
  pcb_trace_error_id: "overlap_route_0_pcb_smtpad_obstacle",
  center: { x: 0, y: 0 },
  message: "Trace overlaps an obstacle",
}

export const createResidualLocalRerouteSolver = (
  drcEvaluator: DrcEvaluator,
  effort: number,
): ResidualLocalRerouteSolver =>
  new ResidualLocalRerouteSolver({
    hdRoutes: [residualLocalRerouteInputRoute],
    drcEvaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort,
  })
