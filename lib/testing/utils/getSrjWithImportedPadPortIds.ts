import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"

/** Preserve terminal ownership when importing pads without PCB port ids. */
export function getSrjWithImportedPadPortIds(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  const hasTerminalsWithoutPcbPortIds = srj.connections.some((connection) =>
    connection.pointsToConnect.some(
      (point) => !point.pcb_port_id && point.pointId,
    ),
  )
  if (!hasTerminalsWithoutPcbPortIds) return srj

  const importedPadsByReference = new Map<string, Obstacle[]>()
  for (const obstacle of srj.obstacles) {
    const metadata = obstacle.circuitJsonMetadata
    if (
      !metadata?.source_component_name ||
      !metadata.source_port_name ||
      metadata.pcb_via_id ||
      obstacle.isNonPlatedHole
    ) {
      continue
    }
    const references = new Set([
      obstacle.obstacleId,
      `${metadata.source_component_name}.${metadata.source_port_name}`,
      ...obstacle.connectedTo,
    ])
    for (const reference of references) {
      if (!reference) continue
      const pads = importedPadsByReference.get(reference)
      if (pads) pads.push(obstacle)
      else importedPadsByReference.set(reference, [obstacle])
    }
  }
  if (importedPadsByReference.size === 0) return srj

  let addedPortIds = false
  const projected = {
    ...srj,
    connections: srj.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => {
        if (point.pcb_port_id || !point.pointId) return point
        const layers = getConnectionPointLayers(point)
        const references = [
          point.pointId,
          point.port_selector,
          connection.name,
          connection.__netConnectionName,
          ...(connection.__rootConnectionNames ?? []),
        ]
        const hasImportedPad = references.some(
          (reference) =>
            reference &&
            importedPadsByReference
              .get(reference)
              ?.some(
                (obstacle) =>
                  Math.hypot(
                    point.x - obstacle.center.x,
                    point.y - obstacle.center.y,
                  ) < 1e-6 &&
                  layers.some((layer) => obstacle.layers.includes(layer)),
              ),
        )
        if (!hasImportedPad) return point
        addedPortIds = true
        return { ...point, pcb_port_id: point.pointId }
      }),
    })),
  }
  return addedPortIds ? projected : srj
}
