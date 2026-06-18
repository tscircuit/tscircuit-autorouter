import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getTinyRegionMetadata } from "./tinyHypergraphMetadata"
import type { HgPortPointPathingSolverParams } from "./types"

export const toSerializedRegionData = (
  region: HgPortPointPathingSolverParams["graph"]["regions"][number],
): SerializedHyperGraph["regions"][number]["d"] => {
  const regionMetadata = getTinyRegionMetadata(region.d)
  const bounds = regionMetadata.bounds

  return {
    capacityMeshNodeId: region.d.capacityMeshNodeId,
    center: {
      x: region.d.center.x,
      y: region.d.center.y,
    },
    width: region.d.width,
    height: region.d.height,
    availableZ: [...region.d.availableZ],
    ...(bounds
      ? {
          bounds: {
            minX: bounds.minX,
            maxX: bounds.maxX,
            minY: bounds.minY,
            maxY: bounds.maxY,
          },
        }
      : {}),
    _containsObstacle: region.d._containsObstacle,
    _containsTarget: region.d._containsTarget,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds === undefined
        ? undefined
        : [...region.d._offBoardConnectedCapacityMeshNodeIds],
    _qfpRegionType: regionMetadata._qfpRegionType,
    _isNarrowQfpPadGap: regionMetadata._isNarrowQfpPadGap,
  }
}
