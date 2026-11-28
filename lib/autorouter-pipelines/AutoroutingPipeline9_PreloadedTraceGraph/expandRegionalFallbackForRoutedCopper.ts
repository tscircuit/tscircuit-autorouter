import type { ReservedRoutingTerminal } from "lib/solvers/HyperHighDensitySolver/createIntraNodeSegmentValidator"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { arePipeline9RoutesOnSameNet, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { createRegionalFallbackProblem, type RegionalFallbackProblem } from "./pipeline9RegionalFallback"

type RegionalCopperParams = Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias"> & {
  reservedTerminals: readonly ReservedRoutingTerminal[]
  node: NodeWithPortPoints
  problem: RegionalFallbackProblem
  fixedRoutes: PreloadedHighDensityRoute[]
  completedRoutes: readonly HighDensityRoute[]
  connMap: ConnectivityMap
  traceWidth: number
  obstacleMargin: number
  promotedFixedRouteConnectionNames: ReadonlySet<string>
}

/** Board-world geometry in mm (+X right, +Y up). A replacement cut must
 * clear completed copper, which stays fixed during this regional solve. */
export function expandRegionalFallbackForRoutedCopper(params: RegionalCopperParams): {
  node: NodeWithPortPoints
  problem: RegionalFallbackProblem
} {
  let node = params.node
  let problem = params.problem
  while (true) {
    const bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    const expanded = { ...bounds }
    let hasConflictingCut = false
    for (const cut of problem.nodeWithPortPoints.portPoints.slice(params.node.portPoints.length)) {
      for (const terminal of params.reservedTerminals) {
        if (terminal.z !== cut.z ||
          arePipeline9RoutesOnSameNet({ left: cut, right: terminal }, params.connMap)) continue
        const margin = params.obstacleMargin + terminal.traceThickness / 2 + params.traceWidth / 2
        if (Math.hypot(cut.x - terminal.x, cut.y - terminal.y) >= margin - 1e-6) continue
        hasConflictingCut = true
        expanded.minX = Math.min(expanded.minX, terminal.x - margin)
        expanded.maxX = Math.max(expanded.maxX, terminal.x + margin)
        expanded.minY = Math.min(expanded.minY, terminal.y - margin)
        expanded.maxY = Math.max(expanded.maxY, terminal.y + margin)
      }
      for (const route of params.completedRoutes) {
        if (arePipeline9RoutesOnSameNet({ left: cut, right: route }, params.connMap)) continue
        const geometry = getPipeline9RouteCopperGeometry(route, params)
        for (const wire of geometry.wireSegments) {
          const margin = params.obstacleMargin + wire.width / 2 + params.traceWidth / 2
          if (wire.z !== cut.z || pointToSegmentDistance(cut, wire.start, wire.end) >= margin - 1e-6) continue
          hasConflictingCut = true
          expanded.minX = Math.min(expanded.minX, wire.start.x - margin, wire.end.x - margin)
          expanded.maxX = Math.max(expanded.maxX, wire.start.x + margin, wire.end.x + margin)
          expanded.minY = Math.min(expanded.minY, wire.start.y - margin, wire.end.y - margin)
          expanded.maxY = Math.max(expanded.maxY, wire.start.y + margin, wire.end.y + margin)
        }
        for (const via of geometry.viaSpans) {
          const margin = params.obstacleMargin + via.diameter / 2 + params.traceWidth / 2
          if (cut.z < via.minZ || cut.z > via.maxZ || Math.hypot(cut.x - via.center.x, cut.y - via.center.y) >= margin - 1e-6) continue
          hasConflictingCut = true
          expanded.minX = Math.min(expanded.minX, via.center.x - margin)
          expanded.maxX = Math.max(expanded.maxX, via.center.x + margin)
          expanded.minY = Math.min(expanded.minY, via.center.y - margin)
          expanded.maxY = Math.max(expanded.maxY, via.center.y + margin)
        }
      }
    }
    if (!hasConflictingCut) return { node, problem }
    if (Math.max(
      Math.abs(expanded.minX - bounds.minX), Math.abs(expanded.maxX - bounds.maxX),
      Math.abs(expanded.minY - bounds.minY), Math.abs(expanded.maxY - bounds.maxY),
    ) < 1e-9) {
      throw new Error("Regional copper terminal violates previously routed clearance")
    }
    node = {
      ...node,
      center: { x: (expanded.minX + expanded.maxX) / 2, y: (expanded.minY + expanded.maxY) / 2 },
      width: expanded.maxX - expanded.minX,
      height: expanded.maxY - expanded.minY,
    }
    problem = createRegionalFallbackProblem(node, params.fixedRoutes, params.promotedFixedRouteConnectionNames)
  }
}
