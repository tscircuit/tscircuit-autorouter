import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "../../utils/mapLayerNameToZ"
import { getXyPointKey } from "./getXyPointKey"

export const isAssignableViaObstacle = (obstacle: Obstacle) =>
  obstacle.netIsAssignable === true && (obstacle.layers?.length ?? 0) > 1

export const getAssignableViaId = (obstacle: Obstacle, index: number) =>
  obstacle.connectedTo?.find((connectedId) =>
    connectedId.startsWith("pcb_via"),
  ) ??
  obstacle.obstacleId ??
  `assignable_via_${index}`

export const getAssignableViaAvailableZ = (params: {
  obstacle: Obstacle
  layerCount: number
}) =>
  [
    ...new Set(
      params.obstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, params.layerCount),
      ),
    ),
  ].sort((a, b) => a - b)

export const getAssignableViaPointKey = (obstacle: Obstacle) =>
  getXyPointKey(obstacle.center)

export const getAssignableViaPointKeys = (obstacles: Obstacle[]) =>
  new Set(
    obstacles.filter(isAssignableViaObstacle).map(getAssignableViaPointKey),
  )
