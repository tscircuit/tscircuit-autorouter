import type { InputNodeWithPortPoints } from "../PortPointPathingSolver"
import type { CapacityAwarePortPointPathingSolverParams } from "./types"

export const buildCapacityInputNodes = (
  params: CapacityAwarePortPointPathingSolverParams,
): InputNodeWithPortPoints[] =>
  params.graph.regions.map((region) => ({
    capacityMeshNodeId: region.regionId,
    center: region.d.center,
    width: region.d.width,
    height: region.d.height,
    portPoints: region.ports.map((port) => ({
      portPointId: port.d.portId,
      x: port.d.x,
      y: port.d.y,
      z: port.d.z,
      connectionNodeIds: [port.region1.regionId, port.region2.regionId],
      distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
      cramped: port.d.cramped,
      connectsToOffBoardNode: Boolean(
        port.region1.d._offBoardConnectionId ??
          port.region2.d._offBoardConnectionId,
      ),
    })),
    availableZ: region.d.availableZ,
    _containsTarget: region.d._containsTarget,
    _containsObstacle: region.d._containsObstacle,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds,
    _qfpRegionType: region.d._qfpRegionType,
    _isNarrowQfpPadGap: region.d._isNarrowQfpPadGap,
  }))
