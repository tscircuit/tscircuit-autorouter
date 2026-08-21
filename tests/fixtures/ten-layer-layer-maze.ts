import type { Obstacle, SimpleRouteJson } from "lib/types";
import { mapZToLayerName } from "lib/utils/mapZToLayerName";

const LAYER_COUNT = 10;
const ALL_Z_LAYERS = Array.from({ length: LAYER_COUNT }, (_, z) => z);
const GATE_Y_POSITIONS = Array.from(
  { length: LAYER_COUNT },
  (_, index) => 9 - index * 2,
);
const CONNECTION_NAME = "ten-layer-maze";

export function createTenLayerLayerMaze(): SimpleRouteJson {
  const gates: Obstacle[] = GATE_Y_POSITIONS.map((y, passableZ) => {
    const blockedZLayers = ALL_Z_LAYERS.filter((z) => z !== passableZ);

    // Each gate spans the board width and blocks every copper layer except
    // its assigned one, so crossing all ten gates requires all ten layers.
    return {
      obstacleId: `gate-${passableZ + 1}-only-z${passableZ}`,
      type: "rect",
      center: { x: 0, y },
      width: 8,
      height: 0.8,
      layers: blockedZLayers.map((z) => mapZToLayerName(z, LAYER_COUNT)),
      __zLayers: blockedZLayers,
      connectedTo: [],
    };
  });

  return {
    layerCount: LAYER_COUNT,
    minTraceWidth: 0.1,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    defaultObstacleMargin: 0.05,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -4, maxX: 4, minY: -12, maxY: 12 },
    obstacles: [
      {
        obstacleId: "start-pad-top",
        type: "rect",
        center: { x: 0, y: 11 },
        width: 1,
        height: 1,
        layers: ["top"],
        __zLayers: [0],
        connectedTo: [CONNECTION_NAME, "start-pad"],
      },
      ...gates,
      {
        obstacleId: "end-pad-bottom",
        type: "rect",
        center: { x: 0, y: -11 },
        width: 1,
        height: 1,
        layers: ["bottom"],
        __zLayers: [LAYER_COUNT - 1],
        connectedTo: [CONNECTION_NAME, "end-pad"],
      },
    ],
    connections: [
      {
        name: CONNECTION_NAME,
        pointsToConnect: [
          { x: 0, y: 11, layer: "top", pointId: "start-pad" },
          { x: 0, y: -11, layer: "bottom", pointId: "end-pad" },
        ],
      },
    ],
  };
}
