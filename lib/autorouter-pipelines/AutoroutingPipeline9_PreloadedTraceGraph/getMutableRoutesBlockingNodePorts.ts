import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { arePipeline9RoutesOnSameNet, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

// Board-world XY in mm; z is the routing-layer index. An assigned entry can
// overlap movable copper outside its cell. That copper must join the repair.
export function getMutableRoutesBlockingNodePorts<Route extends HighDensityRoute & {
  isFixed?: boolean
  isThroughObstacle?: boolean
}>(params: {
  node: NodeWithPortPoints
  routes: readonly Route[]
  connMap: ConnectivityMap
  traceWidth: number
  clearance: number
} & Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">): Set<Route> {
  const blocking = new Set<Route>()
  for (const route of params.routes) {
    if (route.isFixed === true || route.isThroughObstacle === true) continue
    const geometry = getPipeline9RouteCopperGeometry(route, params)
    for (const port of params.node.portPoints) {
      if (arePipeline9RoutesOnSameNet({ left: port, right: route }, params.connMap)) continue
      const margin = params.traceWidth / 2 + params.clearance
      const wireConflict = geometry.wireSegments.some(wire =>
        wire.z === port.z && pointToSegmentDistance(port, wire.start, wire.end) <
          margin + wire.width / 2 - 1e-9,
      )
      const viaConflict = geometry.viaSpans.some(via =>
        port.z >= via.minZ && port.z <= via.maxZ &&
        Math.hypot(port.x - via.center.x, port.y - via.center.y) <
          margin + via.diameter / 2 - 1e-9,
      )
      if (wireConflict || viaConflict) {
        blocking.add(route)
        break
      }
    }
  }
  return blocking
}
