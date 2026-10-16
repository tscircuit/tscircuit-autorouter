import { getBoundsFromPoints } from "@tscircuit/math-utils"
import type { ClearancePathInput } from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const PLANAR_SEARCH_MARGIN_MM = 4
const MAX_PLANAR_GRID_SIZE_MM = 0.1
const DEFAULT_TRACE_CLEARANCE_MM = 0.1

export const getPipeline9PlanarViaRemovalProblem = ({
  srj,
  routes,
  fixedRoutes,
  routeIndex,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: readonly HighDensityRoute[]
  routeIndex: number
}): ClearancePathInput | undefined => {
  const route = routes[routeIndex]!
  const start = route.route[0]
  const end = route.route.at(-1)
  const routingGroups = [...(srj.differentialPairs ?? []), ...(srj.buses ?? [])]
  if (
    !start ||
    !end ||
    start.z !== end.z ||
    route.vias.length === 0 ||
    routingGroups.some((group) =>
      group.connectionNames.includes(route.connectionName) ||
      (route.rootConnectionName !== undefined &&
        group.connectionNames.includes(route.rootConnectionName)),
    ) ||
    route.jumpers?.length ||
    route.route.slice(1, -1).some((point) => point.pcb_port_id) ||
    route.route.some((point) =>
      point.toNextSegmentType ||
      point.insideJumperPad ||
      (point.traceThickness !== undefined &&
        point.traceThickness !== route.traceThickness),
    )
  ) {
    return undefined
  }
  const routeBounds = getBoundsFromPoints(route.route)!
  let boardBounds = srj.bounds
  if (srj.outline?.length) boardBounds = getBoundsFromPoints(srj.outline)!
  const boardMargin = (srj.minBoardEdgeClearance ?? 0) + route.traceThickness / 2
  return {
    srj: { ...srj, traces: undefined },
    routes: [...routes, ...fixedRoutes],
    routeIndex,
    start,
    end,
    bounds: {
      minX: Math.max(
        boardBounds.minX + boardMargin,
        routeBounds.minX - PLANAR_SEARCH_MARGIN_MM,
      ),
      maxX: Math.min(
        boardBounds.maxX - boardMargin,
        routeBounds.maxX + PLANAR_SEARCH_MARGIN_MM,
      ),
      minY: Math.max(
        boardBounds.minY + boardMargin,
        routeBounds.minY - PLANAR_SEARCH_MARGIN_MM,
      ),
      maxY: Math.min(
        boardBounds.maxY - boardMargin,
        routeBounds.maxY + PLANAR_SEARCH_MARGIN_MM,
      ),
    },
    traceThickness: route.traceThickness,
    traceClearance: srj.minTraceToPadEdgeClearance ?? DEFAULT_TRACE_CLEARANCE_MM,
    viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance ?? DEFAULT_TRACE_CLEARANCE_MM,
    gridSize: Math.min(MAX_PLANAR_GRID_SIZE_MM, route.traceThickness / 2),
    allowLayerChanges: false,
  }
}
