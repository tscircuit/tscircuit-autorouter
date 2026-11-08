import {
  getConnectionPointLayers,
  type ConnectionPoint,
  type Obstacle,
  type SimpleRouteJson,
} from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { isPointInRect } from "lib/utils/isPointInRect"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Reuse actual retained trace-to-plane connections across routing phases. */
export const getPreloadedPourPointGroups = ({
  srj,
  points,
  matchingPours,
  connectedPourByObstacle,
}: {
  srj: SimpleRouteJson
  points: ConnectionPoint[]
  matchingPours: Obstacle[]
  connectedPourByObstacle: Map<Obstacle, Obstacle>
}): Map<Obstacle, string[]> => {
  const initiallyConnected = getInitiallyConnectedMapFromSimpleRouteJson(srj)
  const pointIdsByGroup = new Map<string, string[]>()
  for (const point of points) {
    if (!point.pointId) continue
    const group = initiallyConnected.getNetConnectedToId(point.pointId)
    if (!group) continue
    const ids = pointIdsByGroup.get(group) ?? []
    ids.push(point.pointId)
    pointIdsByGroup.set(group, ids)
  }
  const groups = new Map<Obstacle, string[]>()
  for (const trace of srj.traces ?? []) {
    const group = initiallyConnected.getNetConnectedToId(trace.pcb_trace_id)
    if (!group) continue
    const pointIds = pointIdsByGroup.get(group)
    if (!pointIds?.length) continue
    for (const via of trace.route) {
      if (via.route_type !== "via") continue
      const fromZ = mapLayerNameToZ(via.from_layer, srj.layerCount)
      const toZ = mapLayerNameToZ(via.to_layer, srj.layerCount)
      for (const pour of matchingPours) {
        const z = mapLayerNameToZ(pour.layers[0]!, srj.layerCount)
        const spansLayer =
          srj.allowBlindAndBuriedVias !== true ||
          (via.layers
            ? via.layers.includes(pour.layers[0]!)
            : z >= Math.min(fromZ, toZ) && z <= Math.max(fromZ, toZ))
        if (!spansLayer || !isPointInRect(via, pour)) continue
        const representative = connectedPourByObstacle.get(pour)
        if (!representative) throw new Error("Missing copper pour connectivity")
        groups.set(representative, [
          ...new Set([...(groups.get(representative) ?? []), ...pointIds]),
        ])
      }
    }
  }
  // Standalone plated vias/holes are physical connections too. They need not
  // appear as a layer transition in a retained trace. Verify both the terminal
  // contact and the actual layer span before reusing its plane connection.
  for (const obstacle of srj.obstacles) {
    if (
      obstacle.shape !== "circle" ||
      obstacle.isCopperPour ||
      obstacle.isNonPlatedHole ||
      obstacle.layers.length < 2
    )
      continue
    for (const point of points) {
      if (
        !point.pointId ||
        !obstacle.connectedTo.includes(point.pointId) ||
        !getConnectionPointLayers(point).some((layer) =>
          obstacle.layers.includes(layer),
        ) ||
        Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) >
          obstacle.width / 2 + 1e-9
      )
        continue
      const group = initiallyConnected.getNetConnectedToId(point.pointId)
      const pointIds = group ? pointIdsByGroup.get(group)! : [point.pointId]
      for (const pour of matchingPours) {
        if (
          !obstacle.layers.includes(pour.layers[0]!) ||
          !isPointInRect(obstacle.center, pour)
        )
          continue
        const representative = connectedPourByObstacle.get(pour)
        if (!representative) throw new Error("Missing copper pour connectivity")
        groups.set(representative, [
          ...new Set([...(groups.get(representative) ?? []), ...pointIds]),
        ])
      }
    }
  }
  return groups
}
