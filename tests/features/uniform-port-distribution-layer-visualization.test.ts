import { expect, test } from "bun:test"
import { visualizeUniformPortDistribution } from "lib/solvers/UniformPortDistributionSolver/visualizeUniformPortDistribution"
import type { Obstacle } from "lib/types"

test("uniform port distribution visualizes obstacles on their copper layers", () => {
  const obstacles: Obstacle[] = [
    {
      obstacleId: "top-trace-segment",
      type: "rect",
      layers: ["top"],
      __zLayers: [0],
      center: { x: 0, y: 0 },
      width: 1,
      height: 0.15,
      connectedTo: [],
    },
    {
      obstacleId: "bottom-trace-segment",
      type: "rect",
      layers: ["bottom"],
      __zLayers: [1],
      center: { x: 0, y: 1 },
      width: 1,
      height: 0.15,
      connectedTo: [],
    },
  ]

  const graphics = visualizeUniformPortDistribution({
    obstacles,
    nodeWithPortPoints: [],
    mapOfOwnerPairToPortPoints: new Map(),
    mapOfOwnerPairToSharedEdge: new Map(),
    ownerPairsToProcess: [],
    currentOwnerPairBeingProcessed: null,
    mapOfNodeIdToBounds: new Map(),
    layerCount: 2,
  })

  expect(graphics.rects).toMatchObject([
    {
      obstacleId: "top-trace-segment",
      layer: "z0",
      fill: "rgba(255,0,0,0.44)",
    },
    {
      obstacleId: "bottom-trace-segment",
      layer: "z1",
      fill: "rgba(0,0,255,0.44)",
    },
  ])
})
