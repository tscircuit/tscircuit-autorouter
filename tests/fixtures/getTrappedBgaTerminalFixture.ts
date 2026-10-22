import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson } from "lib/types"

export function getTrappedBgaTerminalFixture(): {
  srj: SimpleRouteJson
  components: DetectedComponent[]
} {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "center" },
          { x: 1.5, y: 0, layer: "top", pcb_port_id: "target" },
        ],
      },
    ],
    obstacles: [],
  }
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      srj.obstacles.push({
        type: "rect",
        componentId: "bga",
        obstacleId: `pad-${row}-${col}`,
        layers: ["top"],
        center: { x: col * 0.4, y: row * 0.4 },
        width: 0.208,
        height: 0.208,
        connectedTo: [row === 0 && col === 0 ? "signal" : "ground"],
      })
    }
  }
  return {
    srj,
    components: [
      {
        componentId: "bga",
        componentKind: "bga",
        bounds: {
          __type: "rect",
          minX: -0.504,
          maxX: 0.504,
          minY: -0.504,
          maxY: 0.504,
        },
      },
    ],
  }
}
