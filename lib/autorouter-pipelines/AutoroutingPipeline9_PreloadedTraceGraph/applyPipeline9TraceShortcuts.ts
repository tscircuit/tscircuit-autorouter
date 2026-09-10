import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import stringify from "fast-json-stable-stringify"
import type { DrcError, DrcEvaluator } from "high-density-repair03/lib"
import { VertexShortcutPathSolver } from "lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { doHdRoutesTouch } from "./doHdRoutesTouch"

type ShortcutInput = {
  routes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  drcEvaluator: DrcEvaluator
}
const JUNCTION_TOLERANCE_MM = 1e-6

const isPointOnRoute = (point: HighDensityRoute["route"][number], route: HighDensityRoute): boolean => {
  for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]!
    const b = route.route[i]!
    if (a.toNextSegmentType || a.z !== point.z || b.z !== point.z) continue
    if (pointToSegmentDistance(point, a, b) < JUNCTION_TOLERANCE_MM) return true
  }
  return false
}

const evaluateRoutes = (routes: HighDensityRoute[], drcEvaluator: DrcEvaluator): DrcError[] => {
  const result = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  if (Array.isArray(result)) {
    return result
  }
  return result.errors
}

export const applyPipeline9TraceShortcuts = ({ routes, otherHdRoutes, srj, connMap, colorMap, drcEvaluator }: ShortcutInput): HighDensityRoute[] => {
  let accepted = [...routes]
  let beforeErrors = evaluateRoutes(accepted, drcEvaluator)
  const obstacles = createObjectsWithZLayers(srj.obstacles, srj.layerCount)
  for (let index = 0; index < accepted.length; index++) {
    const inputRoute = accepted[index]!
    const others = [...otherHdRoutes, ...accepted.filter((_, routeIndex) => routeIndex !== index)]
    const solver = new VertexShortcutPathSolver({
      inputRoute,
      otherHdRoutes: others,
      obstacles,
      connMap,
      colorMap,
      outline: srj.outline,
      minBoardEdgeClearance: srj.minBoardEdgeClearance,
      useTraceWidthAwareClearance: true,
    })
    solver.solve()
    if (solver.failed) throw new Error(solver.error ?? "Trace shortcut solver failed")
    const candidate = solver.simplifiedRoute
    if (stringify(candidate.route) === stringify(inputRoute.route)) continue
    if (stringify(candidate.vias) !== stringify(inputRoute.vias) ||
      stringify(candidate.route[0]) !== stringify(inputRoute.route[0]) ||
      stringify(candidate.route.at(-1)) !== stringify(inputRoute.route.at(-1))) {
      throw new Error("Trace shortcut changed a via or terminal")
    }
    // Keep branch junctions and existing copper contacts, including same-net crossings.
    const attachments = others.flatMap((route) => [route.route[0]!, route.route.at(-1)!])
      .filter((point) => isPointOnRoute(point, inputRoute))
    if (attachments.some((point) => !isPointOnRoute(point, candidate))) continue
    if (others.some((route) => doHdRoutesTouch(inputRoute, route) && !doHdRoutesTouch(candidate, route))) continue
    const proposed = [...accepted]
    proposed[index] = candidate
    const afterErrors = evaluateRoutes(proposed, drcEvaluator)
    if (afterErrors.length > beforeErrors.length) continue
    const unmatched = beforeErrors.map((error) => stringify(error))
    const introducesError = afterErrors.some((error) => {
      const errorIndex = unmatched.indexOf(stringify(error))
      if (errorIndex < 0) return true
      unmatched.splice(errorIndex, 1)
      return false
    })
    if (introducesError) continue
    accepted = proposed
    beforeErrors = afterErrors
  }
  return accepted
}
