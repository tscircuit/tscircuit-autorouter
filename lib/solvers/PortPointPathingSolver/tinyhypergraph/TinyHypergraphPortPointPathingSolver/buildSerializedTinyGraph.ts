import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  TINY_TERMINAL_REGION_SIZE,
  type HgPortPointPathingSolverParams,
  type RouteMetadata,
  type SerializedTinyConnection,
  type SerializedTinySolvedRoute,
} from "./types"
import { getRoutePoint, getSharedConnectionZ } from "./routeMetadata"
import { toSerializedPortData } from "./toSerializedPortData"
import { toSerializedRegionData } from "./toSerializedRegionData"

export const buildSerializedTinyGraph = (
  pathingProblem: HgPortPointPathingSolverParams,
): SerializedHyperGraph => {
  const regions: SerializedHyperGraph["regions"] = pathingProblem.graph.regions.map(
    (region) => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: toSerializedRegionData(region),
    }),
  )

  const ports: SerializedHyperGraph["ports"] = pathingProblem.graph.ports.map(
    (port) => ({
      portId: port.d.portId,
      region1Id: port.region1.regionId,
      region2Id: port.region2.regionId,
      d: toSerializedPortData(port),
    }),
  )

  const connections: SerializedTinyConnection[] = pathingProblem.connections.map(
    (connection) => ({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }),
  )

  const solvedRoutes: SerializedTinySolvedRoute[] = []
  const netIndexById = new Map<string, number>()
  const getNetIndex = (routeMetadata: RouteMetadata): number => {
    const netId =
      routeMetadata.mutuallyConnectedNetworkId ?? routeMetadata.connectionId
    let netIndex = netIndexById.get(netId)
    if (netIndex === undefined) {
      netIndex = netIndexById.size
      netIndexById.set(netId, netIndex)
    }
    return netIndex
  }

  for (const connection of pathingProblem.connections) {
    const routeMetadata: RouteMetadata = {
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }
    const routeNetIndex = getNetIndex(routeMetadata)
    const startPoint = getRoutePoint(routeMetadata, 0)
    const endPoint = getRoutePoint(routeMetadata, 1)
    const fallbackStartZ = connection.startRegion.d.availableZ[0] ?? 0
    const fallbackEndZ = connection.endRegion.d.availableZ[0] ?? 0
    const startZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 0,
      fallbackZ: fallbackStartZ,
      regionAvailableZ: connection.startRegion.d.availableZ,
      layerCount: pathingProblem.layerCount,
    })
    const endZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 1,
      fallbackZ: fallbackEndZ,
      regionAvailableZ: connection.endRegion.d.availableZ,
      layerCount: pathingProblem.layerCount,
    })

    const startTerminalRegionId = `tiny-terminal:start-region:${connection.connectionId}`
    const endTerminalRegionId = `tiny-terminal:end-region:${connection.connectionId}`
    const startTerminalPortId = `tiny-terminal:start-port:${connection.connectionId}`
    const endTerminalPortId = `tiny-terminal:end-port:${connection.connectionId}`

    regions.push({
      regionId: startTerminalRegionId,
      pointIds: [startTerminalPortId],
      d: {
        capacityMeshNodeId: startTerminalRegionId,
        center: {
          x: startPoint?.x ?? connection.startRegion.d.center.x,
          y: startPoint?.y ?? connection.startRegion.d.center.y,
        },
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [startZ],
        _containsTarget: true,
        _tinyTerminal: true,
        _tinyTerminalNetId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
        netId: routeNetIndex,
      },
    })

    regions.push({
      regionId: endTerminalRegionId,
      pointIds: [endTerminalPortId],
      d: {
        capacityMeshNodeId: endTerminalRegionId,
        center: {
          x: endPoint?.x ?? connection.endRegion.d.center.x,
          y: endPoint?.y ?? connection.endRegion.d.center.y,
        },
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [endZ],
        _containsTarget: true,
        _tinyTerminal: true,
        _tinyTerminalNetId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
        netId: routeNetIndex,
      },
    })

    ports.push({
      portId: startTerminalPortId,
      region1Id: connection.startRegion.regionId,
      region2Id: startTerminalRegionId,
      d: {
        portId: startTerminalPortId,
        x: startPoint?.x ?? connection.startRegion.d.center.x,
        y: startPoint?.y ?? connection.startRegion.d.center.y,
        z: startZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })

    ports.push({
      portId: endTerminalPortId,
      region1Id: connection.endRegion.regionId,
      region2Id: endTerminalRegionId,
      d: {
        portId: endTerminalPortId,
        x: endPoint?.x ?? connection.endRegion.d.center.x,
        y: endPoint?.y ?? connection.endRegion.d.center.y,
        z: endZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })

    const startRegion = regions.find(
      (region) => region.regionId === connection.startRegion.regionId,
    )
    const endRegion = regions.find(
      (region) => region.regionId === connection.endRegion.regionId,
    )
    startRegion?.pointIds.push(startTerminalPortId)
    endRegion?.pointIds.push(endTerminalPortId)

    solvedRoutes.push({
      connection: {
        connectionId: connection.connectionId,
      },
      path: [{ portId: startTerminalPortId }, { portId: endTerminalPortId }],
    } as SerializedTinySolvedRoute)
  }

  return {
    regions,
    ports,
    connections,
    solvedRoutes,
  } satisfies SerializedHyperGraph
}
