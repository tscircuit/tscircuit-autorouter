import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { Point } from "@tscircuit/math-utils"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { canPublishIndependentClearanceRepairs } from "./canPublishIndependentClearanceRepairs"
import { canPublishPartialFixedObstacleRepair } from "./canPublishPartialFixedObstacleRepair"
import { getPipeline9DrcErrors } from "./pipeline9JointDrcRepairUtils"
import { selectIndependentClearanceRepairs } from "./selectIndependentClearanceRepairs"

const PROJECTION_MARGIN = 1e-5

/** Nudge interior wire bends away from the physical outline, preserving vias. */
export const applyPipeline9BoardEdgeRepairs = ({
  srj: inputSrj,
  routes,
  fixedTraces,
  lockedConnectionNames,
  drcEvaluator,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedTraces: SimplifiedPcbTrace[]
  lockedConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  const outline = inputSrj.outline
  if (!outline || outline.length < 3) return routes
  const before = getPipeline9DrcErrors(drcEvaluator, routes)
  if (
    !before.some(
      (error) => typeof error.actual_board_edge_clearance === "number",
    )
  ) {
    return routes
  }

  const edges = outline.flatMap((start, index) => {
    const end = outline[(index + 1) % outline.length]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    return length === 0 ? [] : [{ start, dx, dy, length }]
  })
  const winding = Math.sign(
    edges.reduce(
      (area, { start, dx, dy }) => area + start.x * dy - start.y * dx,
      0,
    ),
  )
  if (!winding) return routes
  const boardMargin = inputSrj.minBoardEdgeClearance ?? 0
  const project = (point: Point, required: number): Point => {
    let x = point.x
    let y = point.y
    for (let pass = 0; pass < edges.length; pass++) {
      let distance = required
      let dx = 0
      let dy = 0
      for (const edge of edges) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - edge.start.x) * edge.dx + (y - edge.start.y) * edge.dy) /
              edge.length ** 2,
          ),
        )
        const offsetX = x - (edge.start.x + t * edge.dx)
        const offsetY = y - (edge.start.y + t * edge.dy)
        const gap = Math.hypot(offsetX, offsetY)
        if (gap >= distance) continue
        const shift = required + PROJECTION_MARGIN - gap
        distance = gap
        if (gap > 0 && (t === 0 || t === 1)) {
          // The finite edge ends here. Move away from the corner itself.
          dx = (offsetX / gap) * shift
          dy = (offsetY / gap) * shift
        } else {
          dx = (-winding * edge.dy * shift) / edge.length
          dy = (winding * edge.dx * shift) / edge.length
        }
      }
      if (distance === required) break
      x += dx
      y += dy
    }
    return (x !== point.x || y !== point.y) &&
      isPointInOrOnPolygon({ x, y }, outline)
      ? { x, y }
      : point
  }
  const proposed = routes.map((route): HighDensityRoute => {
    if (lockedConnectionNames.has(route.connectionName)) return route
    const viaCoordinates = new Set(route.vias.map(({ x, y }) => `${x},${y}`))
    const points = route.route.map((point, index) => {
      const previous = route.route[index - 1]
      const next = route.route[index + 1]
      if (
        !previous ||
        !next ||
        previous.z !== point.z ||
        next.z !== point.z ||
        point.pcb_port_id ||
        point.terminalApproach ||
        viaCoordinates.has(`${point.x},${point.y}`)
      ) {
        return point
      }
      const width = Math.max(
        previous.traceThickness ?? route.traceThickness,
        point.traceThickness ?? route.traceThickness,
        next.traceThickness ?? route.traceThickness,
      )
      const moved = project(point, boardMargin + width / 2)
      return moved === point ? point : { ...point, ...moved }
    })
    return points.some((point, index) => point !== route.route[index])
      ? { ...route, route: points }
      : route
  })
  if (proposed.every((route, index) => route === routes[index])) return routes

  const srj = {
    ...createSrjWithBoardValidObstacleLayers(inputSrj),
    traces: undefined,
  }
  const candidate = selectIndependentClearanceRepairs({
    srj,
    routes,
    proposedRoutes: proposed,
    boardOutline: outline,
    fixedTraces,
  })
  if (candidate.every((route, index) => route === routes[index])) return routes
  const after = getPipeline9DrcErrors(drcEvaluator, candidate)
  if (
    !canPublishIndependentClearanceRepairs(before, after) &&
    !canPublishPartialFixedObstacleRepair({
      originalSrj: srj,
      initialErrors: before,
      remainingErrors: after,
    })
  ) {
    return routes
  }
  const obstacleViolations = new Map(
    getFixedObstacleViolations({ srj, routes }).map(({ key, severity }) => [
      key,
      severity,
    ]),
  )
  if (
    getFixedObstacleViolations({ srj, routes: candidate }).some(
      ({ key, severity }) =>
        !obstacleViolations.has(key) ||
        severity > obstacleViolations.get(key)! + 1e-8,
    )
  ) {
    return routes
  }
  return candidate
}
