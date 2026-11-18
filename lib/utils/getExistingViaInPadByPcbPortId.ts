import type { ConnectionPoint, Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectionPointLayers } from "lib/types"

export type PcbPortId = NonNullable<ConnectionPoint["pcb_port_id"]>
type BoardPointKey = string

/** Finds fixed vias centered in their own SMT terminal pads. Centers are
 * board-world points in mm, +X right and +Y up; no transform is applied. */
export function getExistingViaInPadByPcbPortId(
  srj: Pick<SimpleRouteJson, "connections" | "obstacles">,
): ReadonlyMap<PcbPortId, Obstacle> {
  const { connections, obstacles } = srj
  const obstaclesByCenter = new Map<BoardPointKey, Obstacle[]>()
  for (const obstacle of obstacles) {
    const metadata = obstacle.circuitJsonMetadata
    if (!metadata?.pcb_smtpad_id && !metadata?.pcb_via_id) continue
    const key = `${obstacle.center.x}:${obstacle.center.y}`
    const centered = obstaclesByCenter.get(key)
    if (centered) centered.push(obstacle)
    else obstaclesByCenter.set(key, [obstacle])
  }
  const existingViaByPcbPortId = new Map<PcbPortId, Obstacle>()
  for (const connection of connections) {
    for (const point of connection.pointsToConnect) {
      const pcbPortId = point.pcb_port_id
      if (!pcbPortId) continue
      const centered = obstaclesByCenter.get(`${point.x}:${point.y}`)
      if (!centered) continue
      const pointLayers = getConnectionPointLayers(point)
      const pad = centered.find(
        (obstacle) =>
          obstacle.circuitJsonMetadata?.pcb_smtpad_id &&
          obstacle.connectedTo.includes(pcbPortId) &&
          obstacle.layers.some((layer) => pointLayers.includes(layer)),
      )
      if (!pad) continue
      const via = centered.find(
        (obstacle) =>
          obstacle.circuitJsonMetadata?.pcb_via_id &&
          !obstacle.netIsAssignable &&
          obstacle.connectedTo.includes(pcbPortId) &&
          obstacle.layers.some((layer) => !pad.layers.includes(layer)),
      )
      if (via) existingViaByPcbPortId.set(pcbPortId, via)
    }
  }
  return existingViaByPcbPortId
}
