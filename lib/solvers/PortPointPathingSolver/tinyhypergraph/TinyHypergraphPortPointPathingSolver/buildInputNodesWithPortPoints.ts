import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getPortPointLinkIds,
  getTinyPortMetadata,
  getTinyRegionMetadata,
} from "./tinyHypergraphMetadata"
import type {
  HgPortPointPathingSolverParams,
  InputNodeWithPortPoints,
  InputPortPoint,
} from "./types"

export const buildInputNodesWithPortPoints = (
  pathingProblem: HgPortPointPathingSolverParams,
  serializedHyperGraph: SerializedHyperGraph,
): InputNodeWithPortPoints[] => {
  const serializedRegionById = new Map(
    serializedHyperGraph.regions.map((region) => [region.regionId, region]),
  )
  const serializedPortById = new Map(
    serializedHyperGraph.ports.map((port) => [port.portId, port]),
  )

  return pathingProblem.graph.regions.map((region) => {
    const serializedRegion = serializedRegionById.get(region.regionId)
    const regionMetadata = getTinyRegionMetadata(region.d)
    const portPoints = (
      serializedRegion?.pointIds ?? region.ports.map((port) => port.d.portId)
    )
      .flatMap((portId) => {
        const port = serializedPortById.get(portId)
        if (!port || getTinyPortMetadata(port.d)._tinyTerminal) {
          return []
        }

        const portMetadata = getTinyPortMetadata(port.d)
        const { prevPortPointId, nextPortPointId } =
          getPortPointLinkIds(portMetadata)
        const region1 = serializedRegionById.get(port.region1Id)
        const region2 = serializedRegionById.get(port.region2Id)
        const connectsToOffBoardNode = Boolean(
          getTinyRegionMetadata(region1?.d)._offBoardConnectionId ??
            getTinyRegionMetadata(region2?.d)._offBoardConnectionId,
        )

        return [
          {
            portPointId: port.portId,
            x: Number(portMetadata.x ?? 0),
            y: Number(portMetadata.y ?? 0),
            z: Number(portMetadata.z ?? 0),
            prevPortPointId,
            nextPortPointId,
            connectionNodeIds: [port.region1Id, port.region2Id],
            distToCentermostPortOnZ: Number(
              portMetadata.distToCentermostPortOnZ ?? 0,
            ),
            cramped: Boolean(portMetadata.cramped),
            connectsToOffBoardNode,
          } satisfies InputPortPoint,
        ]
      })

    return {
      capacityMeshNodeId: region.d.capacityMeshNodeId,
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      portPoints,
      availableZ: region.d.availableZ,
      _containsObstacle: region.d._containsObstacle,
      _containsTarget: region.d._containsTarget,
      _offBoardConnectionId: region.d._offBoardConnectionId,
      _offBoardConnectedCapacityMeshNodeIds:
        region.d._offBoardConnectedCapacityMeshNodeIds,
      _qfpRegionType: regionMetadata._qfpRegionType,
      _isNarrowQfpPadGap: regionMetadata._isNarrowQfpPadGap,
    }
  })
}
