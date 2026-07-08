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

function createQfpMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  const positions = [-1.2, 0, 1.2]

  for (const x of positions) {
    obstacles.push(
      createObstacle({
        id: `u_qfp_${obstacles.length}`,
        componentId: "u_qfp",
        x,
        y: -2,
        width: 0.36,
        height: 0.9,
      }),
      createObstacle({
        id: `u_qfp_${obstacles.length + 1}`,
        componentId: "u_qfp",
        x,
        y: 2,
        width: 0.36,
        height: 0.9,
      }),
    )
  }

  for (const y of positions) {
    obstacles.push(
      createObstacle({
        id: `u_qfp_${obstacles.length}`,
        componentId: "u_qfp",
        x: -2,
        y,
        width: 0.9,
        height: 0.36,
      }),
      createObstacle({
        id: `u_qfp_${obstacles.length + 1}`,
        componentId: "u_qfp",
        x: 2,
        y,
        width: 0.9,
        height: 0.36,
      }),
    )
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
        id: "qfp_inner_a",
        x: -0.45,
        y: -0.25,
        width: 0.42,
        height: 0.42,
        connectedTo: ["qfp_inner_a_port"],
      }),
      createObstacle({
        id: "qfp_inner_b",
        x: 0.55,
        y: 0.55,
        width: 0.42,
        height: 0.42,
        connectedTo: ["qfp_inner_b_port"],
      }),
    ],
    connections: [
      {
        name: "qfp_inner_a_net",
        pointsToConnect: [
          { pointId: "qfp_inner_a_port", x: -0.45, y: -0.25, layer: "top" },
          { pointId: "qfp_inner_a_outside", x: -3.2, y: 0, layer: "top" },
        ],
      },
      {
        name: "qfp_inner_b_net",
        pointsToConnect: [
          { pointId: "qfp_inner_b_port", x: 0.55, y: 0.55, layer: "top" },
          { pointId: "qfp_inner_b_outside", x: 3.2, y: 0, layer: "top" },
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

test("merged topology preserves inner targets in QFP center", async (): Promise<void> => {
  await expect(
    getSolverSvgFrames({
      solver: createMergedTopologySolver(createQfpMergedTopologySrj()),
      frames: [
        { type: "solver", solverName: "globalTopologySolver" },
        { type: "solver", solverName: "componentTopologyBatchSolver" },
        { type: "pipeline", step: "end" },
      ],
      columns: 3,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
