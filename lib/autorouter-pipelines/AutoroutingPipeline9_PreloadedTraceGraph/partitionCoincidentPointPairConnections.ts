import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type CoincidentPointPairPartition = {
  routingSrj: SimpleRouteJson
  directHdRoutes: HighDensityRoute[]
}

/** Materialize same-layer zero-length paths without sending them through congestion routing. */
export const partitionCoincidentPointPairConnections = (
  srj: SimpleRouteJson,
  viaDiameter: number,
): CoincidentPointPairPartition => {
  const routingConnections: SimpleRouteConnection[] = []
  const directHdRoutes: HighDensityRoute[] = []
  for (const connection of srj.connections) {
    const [start, end] = connection.pointsToConnect
    const buses = (srj.buses ?? []).filter((bus) =>
      bus.connectionNames.some(
        (name) =>
          name === connection.name ||
          connection.__rootConnectionNames?.includes(name) ||
          name === connection.__netConnectionName,
      ),
    )
    const commonLayer =
      connection.pointsToConnect.length === 2 &&
      start.x === end.x &&
      start.y === end.y &&
      !("terminalVia" in start && start.terminalVia) &&
      !("terminalVia" in end && end.terminalVia)
        ? getConnectionPointLayers(start).find(
            (layer) =>
              getConnectionPointLayers(end).includes(layer) &&
              buses.every(
                (bus) =>
                  !bus.allowedLayers || bus.allowedLayers.includes(layer),
              ),
          )
        : undefined
    if (commonLayer === undefined) {
      routingConnections.push(connection)
      continue
    }
    const z = mapLayerNameToZ(commonLayer, srj.layerCount)
    if (!Number.isInteger(z) || z < 0 || z >= srj.layerCount) {
      throw new Error(
        `Coincident connection "${connection.name}" has invalid layer "${commonLayer}"`,
      )
    }
    directHdRoutes.push({
      connectionName: connection.name,
      rootConnectionName: connection.__netConnectionName ?? connection.name,
      startPcbPortId: start.pcb_port_id,
      endPcbPortId: end.pcb_port_id,
      traceThickness: connection.nominalTraceWidth ?? srj.minTraceWidth,
      viaDiameter,
      route: [start, end].map((point) => ({
        x: point.x,
        y: point.y,
        z,
        pcb_port_id: point.pcb_port_id,
      })),
      vias: [],
    })
  }
  return {
    routingSrj: { ...srj, connections: routingConnections },
    directHdRoutes,
  }
}
