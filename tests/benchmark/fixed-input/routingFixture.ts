import type { SimpleRouteJson } from "../../../lib/types/srj-types"

export function routingFixture(): SimpleRouteJson {
  return {
    layerCount: 2, minTraceWidth: 0.15, nominalTraceWidth: 0.15,
    defaultObstacleMargin: 0.15, minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15, minBoardEdgeClearance: 0.15,
    minViaPadDiameter: 0.6, minViaHoleDiameter: 0.3, allowViaInPad: false,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      { obstacleId: "left", type: "rect", center: { x: -3, y: 0 }, width: 0.8, height: 0.6, layers: ["top"], connectedTo: ["signal"] },
      { obstacleId: "right", type: "rect", center: { x: 3, y: 0 }, width: 0.8, height: 0.6, layers: ["bottom"], connectedTo: ["signal"] },
    ],
    connections: [{ name: "signal", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "bottom" }] }],
  }
}
