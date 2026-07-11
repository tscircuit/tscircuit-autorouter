import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import {
  getGraphicsSvgFrames,
  getSolverGraphicsFrames,
} from "../../../fixtures/solver-svg-frames"
import {
  createTopologyMergingSolverFromPlanning,
  createTopologyPlanningSolverForMerging,
} from "../../../fixtures/topology-merging-test-utils"

type RectSpec = {
  id: string
  x: number
  y: number
  width: number
  height: number
  componentId?: string
  connectedTo?: string[]
}

function createObstacle({
  id,
  x,
  y,
  width,
  height,
  componentId,
  connectedTo = [],
}: RectSpec): Obstacle {
  return {
    obstacleId: id,
    componentId,
    type: "rect",
    layers: ["top"],
    zLayers: [0],
    center: { x, y },
    width,
    height,
    connectedTo,
  }
}

function createBgaMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  const positions = [-1.5, -0.5, 0.5, 1.5]

  for (const x of positions) {
    for (const y of positions) {
      obstacles.push(
        createObstacle({
          id: `u_bga_${obstacles.length}`,
          componentId: "u_bga",
          x,
          y,
          width: 0.25,
          height: 0.25,
        }),
      )
    }
  }

  return {
    layerCount: 2,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.35,
    defaultObstacleMargin: 0.12,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      ...obstacles,
      createObstacle({
        id: "bga_center_foreign",
        x: 0,
        y: 0,
        width: 0.28,
        height: 0.28,
        connectedTo: ["bga_center_foreign_port"],
      }),
    ],
    connections: [
      {
        name: "bga_center_foreign_net",
        pointsToConnect: [
          { pointId: "bga_center_foreign_port", x: 0, y: 0, layer: "top" },
          {
            pointId: "bga_center_foreign_outside",
            x: 3.2,
            y: 3.2,
            layer: "top",
          },
        ],
      },
    ],
  }
}

test("merged topology preserves inner targets in BGA grid", async (): Promise<void> => {
  const inputSrj = createBgaMergedTopologySrj()
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj)
  const planningFrames = getSolverGraphicsFrames({
    solver: topologyPlanningSolver,
    frames: [
      { type: "solver", solverName: "globalTopologySolver" },
      { type: "solver", solverName: "componentTopologyBatchSolver" },
      { type: "pipeline", step: "end" },
    ],
  })
  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj,
    topologyPlanningSolver,
  })
  const mergingFrames = getSolverGraphicsFrames({
    solver: topologyMergingSolver,
    frames: [{ type: "pipeline", step: "end" }],
  })

  expect(topologyPlanningSolver.getOutput().componentMeshNodes).toHaveLength(1)
  expect(topologyMergingSolver.solved).toBe(true)
  expect(topologyMergingSolver.failed).toBe(false)
  expect(topologyMergingSolver.getOutput().length).toBeGreaterThan(0)
  await expect(
    getGraphicsSvgFrames({
      frames: [...planningFrames, ...mergingFrames],
      columns: 3,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
