import { getBoundsFromPoints } from "@tscircuit/math-utils"
import type { ClearancePathInput } from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const SAME_LAYER_SEARCH_MARGIN_MM = 4
const MAX_SAME_LAYER_GRID_SIZE_MM = 0.1
const DEFAULT_ROUTE_CLEARANCE_MM = 0.1
// Bound optional cleanup work after the main DRC repair has completed.
const MAX_SAME_LAYER_SEARCH_NODES = 1500
const SAME_LAYER_HEURISTIC_WEIGHT = 1.5
const GRID_ATTACH_DISTANCE = 3
const COORDINATE_TOLERANCE = 1e-9

export const getSameLayerViaRemovalInput = ({
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
  const routeStart = route.route[0]
  const routeEnd = route.route.at(-1)
  const routingGroups = [...(srj.differentialPairs ?? []), ...(srj.buses ?? [])]
  if (
    !routeStart ||
    !routeEnd ||
    routeStart.z !== routeEnd.z ||
    route.vias.length === 0 ||
    routingGroups.some(
      (group) =>
        group.connectionNames.includes(route.connectionName) ||
        (route.rootConnectionName !== undefined &&
          group.connectionNames.includes(route.rootConnectionName)),
    ) ||
    route.jumpers?.length ||
    route.route.slice(1, -1).some((point) => point.pcb_port_id) ||
    route.route.some(
      (point) =>
        point.toNextSegmentType ||
        point.insideJumperPad ||
        (point.traceThickness !== undefined &&
          point.traceThickness !== route.traceThickness),
    )
  ) {
    return undefined
  }
  const startIndex =
    route.route.findIndex(
      (point, index) => index > 0 && point.z !== route.route[index - 1]!.z,
    ) - 1
  const endIndex = route.route.findLastIndex(
    (point, index) => index > 0 && point.z !== route.route[index - 1]!.z,
  )
  if (startIndex < 0 || endIndex < 0) {
    throw new Error("Via removal requires a route with layer transitions")
  }
  const start = route.route[startIndex]!
  const end = route.route[endIndex]!
  const routeBounds = getBoundsFromPoints(
    route.route.slice(startIndex, endIndex + 1),
  )!
  let boardBounds = srj.bounds
  if (srj.outline?.length) boardBounds = getBoundsFromPoints(srj.outline)!
  const boardMargin =
    (srj.minBoardEdgeClearance ?? 0) + route.traceThickness / 2
  const gridSize = Math.min(
    MAX_SAME_LAYER_GRID_SIZE_MM,
    route.traceThickness / 2,
  )
  return {
    srj: { ...srj, traces: undefined },
    routes: [...routes, ...fixedRoutes],
    routeIndex,
    start,
    end,
    bounds: {
      minX: Math.max(
        boardBounds.minX + boardMargin,
        routeBounds.minX - SAME_LAYER_SEARCH_MARGIN_MM,
      ),
      maxX: Math.min(
        boardBounds.maxX - boardMargin,
        routeBounds.maxX + SAME_LAYER_SEARCH_MARGIN_MM,
      ),
      minY: Math.max(
        boardBounds.minY + boardMargin,
        routeBounds.minY - SAME_LAYER_SEARCH_MARGIN_MM,
      ),
      maxY: Math.min(
        boardBounds.maxY - boardMargin,
        routeBounds.maxY + SAME_LAYER_SEARCH_MARGIN_MM,
      ),
    },
    traceThickness: route.traceThickness,
    traceClearance:
      srj.minTraceToPadEdgeClearance ?? DEFAULT_ROUTE_CLEARANCE_MM,
    viaClearance:
      srj.minViaHoleEdgeToViaHoleEdgeClearance ?? DEFAULT_ROUTE_CLEARANCE_MM,
    gridSize,
    maxNodes: MAX_SAME_LAYER_SEARCH_NODES,
    heuristicWeight: SAME_LAYER_HEURISTIC_WEIGHT,
    getAdditionalEdgeCost: (a, b) => {
      const dx = Math.abs(a.x - b.x)
      const dy = Math.abs(a.y - b.y)
      if (
        dx < COORDINATE_TOLERANCE ||
        dy < COORDINATE_TOLERANCE ||
        Math.abs(dx - dy) < COORDINATE_TOLERANCE
      )
        return 0
      // Only the short grid attachments may leave the board's 45-degree style.
      if (
        Math.hypot(dx, dy) <= gridSize * GRID_ATTACH_DISTANCE &&
        ((a.x === start.x && a.y === start.y) ||
          (b.x === end.x && b.y === end.y))
      )
        return 0
      return Infinity
    },
    allowLayerChanges: false,
  }
}
