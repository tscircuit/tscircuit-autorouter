import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getSolverSvgFrames } from "../../../fixtures/solver-svg-frames"

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

function createMergedTopologySolver(
  inputSrj: SimpleRouteJson,
): MultiGraphTopologyPlannerSolver {
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  return new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: inputSrj.minViaPadDiameter,
    obstacleMargin: inputSrj.defaultObstacleMargin,
  })
}

test("merged topology preserves inner targets in BGA grid", async (): Promise<void> => {
  await expect(
    getSolverSvgFrames({
      solver: createMergedTopologySolver(createBgaMergedTopologySrj()),
      frames: [
        { type: "solver", solverName: "globalTopologySolver" },
        { type: "solver", solverName: "componentTopologyBatchSolver" },
        { type: "pipeline", step: "end" },
      ],
      columns: 3,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
