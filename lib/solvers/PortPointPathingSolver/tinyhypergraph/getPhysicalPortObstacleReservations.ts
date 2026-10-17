import { RbushIndex } from "lib/data-structures/RbushIndex"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { PortObstacleConstraints } from "../hgportpointpathingsolver/types"

type PhysicalPortGraph = {
  topology: {
    portX: ArrayLike<number>
    portY: ArrayLike<number>
    portZ: ArrayLike<number>
  }
  problem: {
    routeNet: ArrayLike<number>
    routeMetadata?: { mutuallyConnectedNetworkId?: string }[]
  }
}

type IndexedObstacle = {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
  cos: number
  sin: number
  layers: Set<number>
  netId: number
}

/** A graph port beside copper is usable only by that copper's own net. */
export const getPhysicalPortObstacleReservations = (
  graph: PhysicalPortGraph,
  constraints: PortObstacleConstraints,
  layerCount: number,
): Int32Array => {
  const netIndexById = new Map<string, number>()
  for (let routeId = 0; routeId < graph.problem.routeNet.length; routeId++) {
    const netId =
      graph.problem.routeMetadata?.[routeId]?.mutuallyConnectedNetworkId
    if (typeof netId !== "string") {
      throw new Error(`Physical port route ${routeId} is missing its net ID`)
    }
    netIndexById.set(netId, graph.problem.routeNet[routeId]!)
  }
  const radius = constraints.traceWidth / 2 + constraints.clearance
  const index = new RbushIndex<IndexedObstacle>()
  for (const obstacle of constraints.obstacles) {
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    const halfX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight
    const halfY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight
    const netIds = new Set(
      obstacle.connectedTo.map((id) => netIndexById.get(id) ?? -2),
    )
    const netId = netIds.size === 1 ? [...netIds][0]! : -2
    index.insert(
      {
        x: obstacle.center.x,
        y: obstacle.center.y,
        halfWidth,
        halfHeight,
        cos,
        sin,
        netId,
        layers: new Set(
          obstacle.zLayers ??
            obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
        ),
      },
      obstacle.center.x - halfX - radius,
      obstacle.center.y - halfY - radius,
      obstacle.center.x + halfX + radius,
      obstacle.center.y + halfY + radius,
    )
  }
  const reservations = new Int32Array(graph.topology.portX.length).fill(-1)
  for (let portId = 0; portId < reservations.length; portId++) {
    const x = graph.topology.portX[portId]!
    const y = graph.topology.portY[portId]!
    const z = graph.topology.portZ[portId]!
    for (const obstacle of index.search(x, y, x, y)) {
      if (!obstacle.layers.has(z)) continue
      const dx = x - obstacle.x
      const dy = y - obstacle.y
      const localX = obstacle.cos * dx + obstacle.sin * dy
      const localY = -obstacle.sin * dx + obstacle.cos * dy
      const distance = Math.hypot(
        Math.max(0, Math.abs(localX) - obstacle.halfWidth),
        Math.max(0, Math.abs(localY) - obstacle.halfHeight),
      )
      if (distance >= radius - 1e-6) continue
      const previous = reservations[portId]!
      reservations[portId] =
        previous === -1 || previous === obstacle.netId ? obstacle.netId : -2
      if (reservations[portId] === -2) break
    }
  }
  return reservations
}
