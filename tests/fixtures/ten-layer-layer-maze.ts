import type { Obstacle, SimpleRouteJson } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

const LAYER_COUNT = 10
const ALL_Z_LAYERS = Array.from({ length: LAYER_COUNT }, (_, z) => z)
const GATE_X_POSITIONS = [-6, -3, 0, 3, 6]

export function createTenLayerLayerMaze(
  passableZLayers: readonly number[],
): SimpleRouteJson {
  if (passableZLayers.length !== GATE_X_POSITIONS.length) {
    throw new Error(
      `Expected ${GATE_X_POSITIONS.length} passable layers, received ${passableZLayers.length}`,
    )
  }

  const obstacles: Obstacle[] = GATE_X_POSITIONS.map((x, index) => {
    const passableZ = passableZLayers[index]!
    const blockedZLayers = ALL_Z_LAYERS.filter((z) => z !== passableZ)

    // Each gate spans the board height and blocks every copper layer except
    // its assigned one, so a route cannot bypass the required layer in 2D.
    return {
      obstacleId: `gate-${index + 1}-only-z${passableZ}`,
      type: "rect",
      center: { x, y: 0 },
      width: 0.8,
      height: 8,
      layers: blockedZLayers.map((z) => mapZToLayerName(z, LAYER_COUNT)),
      __zLayers: blockedZLayers,
      connectedTo: [],
    }
  })

  const endpointZ = passableZLayers[0]!
  const endpointLayer = mapZToLayerName(endpointZ, LAYER_COUNT)

  return {
    layerCount: LAYER_COUNT,
    minTraceWidth: 0.1,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    defaultObstacleMargin: 0.05,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -9, maxX: 9, minY: -4, maxY: 4 },
    obstacles,
    connections: [
      {
        name: `maze-${passableZLayers.join("-")}`,
        pointsToConnect: [
          { x: -8, y: 0, layer: endpointLayer, pointId: "start" },
          { x: 8, y: 0, layer: endpointLayer, pointId: "end" },
        ],
      },
    ],
  }
}
