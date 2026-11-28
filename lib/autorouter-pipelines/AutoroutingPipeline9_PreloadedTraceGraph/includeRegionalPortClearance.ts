import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

/** Board-world mm (+X right, +Y up). Keep unchanged prefixes and suffixes
 * outside every planned terminal's copper-clearance envelope. */
export function includeRegionalPortClearance(params: {
  node: NodeWithPortPoints
  routes: readonly HighDensityRoute[]
  traceWidth: number
  clearance: number
} & Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">): NodeWithPortPoints {
  let copperRadius = 0
  for (const route of params.routes) {
    const geometry = getPipeline9RouteCopperGeometry(route, params)
    for (const wire of geometry.wireSegments) copperRadius = Math.max(copperRadius, wire.width / 2)
    for (const via of geometry.viaSpans) copperRadius = Math.max(copperRadius, via.diameter / 2)
  }
  const margin = params.traceWidth / 2 + params.clearance + copperRadius
  const node = params.node
  let minX = node.center.x - node.width / 2
  let maxX = node.center.x + node.width / 2
  let minY = node.center.y - node.height / 2
  let maxY = node.center.y + node.height / 2
  for (const port of node.portPoints) {
    minX = Math.min(minX, port.x - margin)
    maxX = Math.max(maxX, port.x + margin)
    minY = Math.min(minY, port.y - margin)
    maxY = Math.max(maxY, port.y + margin)
  }
  return { ...node,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX, height: maxY - minY,
  }
}
