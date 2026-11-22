import { distance } from "@tscircuit/math-utils"
import type { SimpleRouteJson as RepairSimpleRouteJson } from "high-density-repair03/lib"
import { getSegmentBoardClearance } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

export function widenClearInteriorSegments({
  board,
  route,
  nominalWidth,
  hasClearance,
}: {
  board?: SimpleRouteJson
  route: HighDensityRoute
  nominalWidth: number
  hasClearance: (start: RoutePoint, end: RoutePoint) => boolean
}): HighDensityRoute {
  const points = route.route
  if (
    route.traceThickness >= nominalWidth ||
    route.jumpers?.length ||
    points.some(
      (point) =>
        (point.traceThickness ?? route.traceThickness) !== route.traceThickness,
    )
  ) {
    return route
  }

  // Leave terminal stubs, via contacts and typed transitions at their routed width.
  const canWidenAtPoint = points.map((point, index) => {
    const previous = points[index - 1]
    return (
      previous?.z === point.z &&
      points[index + 1]?.z === point.z &&
      !point.pcb_port_id &&
      !point.terminalApproach &&
      !point.insideJumperPad &&
      !previous.toNextSegmentType &&
      !point.toNextSegmentType &&
      !previous.toNextSegmentCircuitJsonMetadata &&
      !point.toNextSegmentCircuitJsonMetadata &&
      !route.vias.some((via) => via.x === point.x && via.y === point.y)
    )
  })
  const boardEdgeClearance =
    nominalWidth / 2 + (board?.minBoardEdgeClearance ?? 0)
  const clearSegments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!
    return (
      canWidenAtPoint[index] &&
      canWidenAtPoint[index + 1] &&
      distance(start, end) > 1e-9 &&
      (!board ||
        getSegmentBoardClearance(board as RepairSimpleRouteJson, start, end) >=
          boardEdgeClearance) &&
      hasClearance(start, end)
    )
  })
  // Core moves an outgoing width to the opposite endpoint when reversing a
  // route. A check using the wider endpoint can then extend that width onto
  // the preceding or following wire, depending on the routing direction.
  const widenAtPoint = clearSegments.map(
    (isClear, index) =>
      isClear &&
      clearSegments[index - 1] === true &&
      clearSegments[index + 1] === true,
  )
  if (!widenAtPoint.includes(true)) return route

  // A point owns the width of its outgoing wire. The route width bounds
  // every segment so the spatial index can find this copper for later nets.
  return {
    ...route,
    traceThickness: nominalWidth,
    route: points.map((point, index) => ({
      ...point,
      traceThickness: widenAtPoint[index] ? nominalWidth : route.traceThickness,
    })),
  }
}
