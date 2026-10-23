import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getConnectionPointLayers, type SimpleRouteConnection } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"

export type ElectricalTreeTerminalWitness = {
  connectionId: string
  netId: string
  pcbPortId: string
  x: number
  y: number
  z: number
}

type TerminalSourceConnection = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: SimpleRouteConnection
}

/** Immutable source witnesses survive section solvers reloading numeric IDs. */
export function createElectricalTreeTerminalWitnesses(
  graph: SerializedHyperGraph,
  layerCount: number,
): Map<string, ElectricalTreeTerminalWitness> {
  const connections = new Map((graph.connections ?? []).map((connection) => [
    connection.connectionId,
    connection as TerminalSourceConnection,
  ]))
  const ports = new Map(graph.ports.map((port) => [port.portId, port]))
  const witnesses = new Map<string, ElectricalTreeTerminalWitness>()
  for (const route of graph.solvedRoutes ?? []) {
    const connection = connections.get(route.connection.connectionId)
    if (hasPreloadedTraceSectionMetadata(connection)) continue
    for (const endpointIndex of [0, 1] as const) {
      const endpoint = endpointIndex === 0 ? route.path[0] : route.path.at(-1)
      if (!endpoint) continue
      const port = ports.get(endpoint.portId)
      const data = port?.d as Record<string, unknown> | undefined
      if (data?._tinyTerminal !== true || typeof data.pcb_port_id !== "string") continue
      const point = connection?.simpleRouteConnection?.pointsToConnect[endpointIndex]
      const netId = connection?.mutuallyConnectedNetworkId
      const { x, y, z } = data
      if (
        !point || typeof netId !== "string" || netId.length === 0 ||
        data.pcb_port_id.length === 0 ||
        data.pcb_port_id !== point.pcb_port_id ||
        typeof x !== "number" || typeof y !== "number" || typeof z !== "number" ||
        ![x, y, z].every(Number.isFinite) || x !== point.x || y !== point.y ||
        !getConnectionPointLayers(point).some((layer) => mapLayerNameToZ(layer, layerCount) === z)
      ) {
        throw new Error(`Electrical tree cannot certify original terminal ${endpoint.portId}`)
      }
      witnesses.set(endpoint.portId, {
        connectionId: connection!.connectionId,
        netId,
        pcbPortId: data.pcb_port_id,
        x, y, z,
      })
    }
  }
  return witnesses
}
