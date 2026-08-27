import type { Obstacle, SimpleRouteConnection } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/**
 * Returns the physical copper-layer indices on which each PCB-port terminal
 * can directly accept a route endpoint without a via. Connection-point layer
 * metadata is the primary source; an exactly centered multilayer obstacle
 * connected to that specific PCB port may add layers for a plated hole.
 */
export const getTerminalLayerIndicesByPcbPortId = (
  connections: ReadonlyArray<SimpleRouteConnection>,
  obstacles: ReadonlyArray<Obstacle>,
  layerCount: number,
): ReadonlyMap<string, ReadonlySet<number>> => {
  const getCenterKey = (point: { x: number; y: number }) =>
    `${point.x}:${point.y}`
  const obstaclesByCenter = new Map<string, Obstacle[]>()
  for (const obstacle of obstacles) {
    const centerKey = getCenterKey(obstacle.center)
    const centeredObstacles = obstaclesByCenter.get(centerKey) ?? []
    centeredObstacles.push(obstacle)
    obstaclesByCenter.set(centerKey, centeredObstacles)
  }
  const terminalLayerIndicesByPcbPortId = new Map<string, Set<number>>()
  for (const connection of connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue
      const terminalLayerIndices =
        terminalLayerIndicesByPcbPortId.get(point.pcb_port_id) ?? new Set()
      const layerNames = "layers" in point ? point.layers : [point.layer]
      for (const layerName of layerNames) {
        terminalLayerIndices.add(mapLayerNameToZ(layerName, layerCount))
      }
      // A plated-hole connection point may name only its preferred layer. A
      // single exactly centered multilayer obstacle proves every physical layer
      // the terminal spans. Coincident same-net single-layer pads do not.
      for (const obstacle of obstaclesByCenter.get(getCenterKey(point)) ?? []) {
        if (
          obstacle.layers.length <= 1 ||
          !obstacle.connectedTo.includes(point.pcb_port_id)
        ) {
          continue
        }
        for (const layerName of obstacle.layers) {
          terminalLayerIndices.add(mapLayerNameToZ(layerName, layerCount))
        }
      }
      terminalLayerIndicesByPcbPortId.set(
        point.pcb_port_id,
        terminalLayerIndices,
      )
    }
  }
  return terminalLayerIndicesByPcbPortId
}
