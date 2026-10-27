import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

// SRJ18/8's rounded barrel is inside the pad; its incoming join lies outside.
export const nearBarrelSegments: HighDensityIntraNodeRoute[] = [
  {
    connectionName: "signal",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 20, y: -0.965, z: 1 },
      { x: 21.946, y: -0.965, z: 1 },
    ],
    vias: [],
  },
  {
    connectionName: "signal",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      {
        x: 21.947,
        y: -0.965,
        z: 1,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_plated_hole_id: "barrel",
        },
      },
      { x: 21.947, y: -0.965, z: 3 },
      { x: 22, y: -0.965, z: 3 },
    ],
    vias: [{ x: 21.947, y: -0.965 }],
  },
]

export const barrelObstacle: Obstacle = {
  type: "rect",
  center: { x: 22.7965, y: -1.27 },
  width: 1.7,
  height: 1.7,
  layers: ["top", "inner1", "inner2", "bottom"],
  connectedTo: ["signal"],
  circuitJsonMetadata: { pcb_plated_hole_id: "barrel" },
}
