import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

export const makeNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "cn1",
  center: { x: 10, y: 20 },
  width: 1,
  height: 1,
  portPoints: [
    { connectionName: "a", x: 9.5, y: 20, z: 0 },
    { connectionName: "a", x: 10.5, y: 20, z: 0 },
  ],
})

export const makeStraightRoute = (): HighDensityIntraNodeRoute => ({
  connectionName: "a",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 9.5, y: 20, z: 0 },
    { x: 10.5, y: 20, z: 0 },
  ],
  vias: [],
})

export const makeScaledRoute = (): HighDensityIntraNodeRoute => ({
  connectionName: "a",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 9, y: 20, z: 0 },
    { x: 10, y: 22, z: 0 },
    { x: 11, y: 20, z: 0 },
  ],
  vias: [{ x: 10, y: 22 }],
})

export const emptyVisualization = () => ({
  lines: [],
  points: [],
  rects: [],
  circles: [],
})
