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

function createQfpThermalPadMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  const positions = [-1.2, 0, 1.2]

  for (const x of positions) {
    obstacles.push(
      createObstacle({
        id: `u_qfp_thermal_${obstacles.length}`,
        componentId: "u_qfp_thermal",
        x,
        y: -2,
        width: 0.36,
        height: 0.9,
      }),
      createObstacle({
        id: `u_qfp_thermal_${obstacles.length + 1}`,
        componentId: "u_qfp_thermal",
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
        id: `u_qfp_thermal_${obstacles.length}`,
        componentId: "u_qfp_thermal",
        x: -2,
        y,
        width: 0.9,
        height: 0.36,
      }),
      createObstacle({
        id: `u_qfp_thermal_${obstacles.length + 1}`,
        componentId: "u_qfp_thermal",
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
        id: "u_qfp_thermal_thermal_pad",
        componentId: "u_qfp_thermal",
        x: 0,
        y: 0,
        width: 0.72,
        height: 0.72,
      }),
      createObstacle({
        id: "thermal_inner_right",
        x: 1.15,
        y: 0.1,
        width: 0.36,
        height: 0.36,
        connectedTo: ["thermal_inner_right_port"],
      }),
      createObstacle({
        id: "thermal_inner_top",
        x: -0.35,
        y: -1.1,
        width: 0.36,
        height: 0.36,
        connectedTo: ["thermal_inner_top_port"],
      }),
    ],
    connections: [
      {
        name: "thermal_inner_right_net",
        pointsToConnect: [
          {
            pointId: "thermal_inner_right_port",
            x: 1.15,
            y: 0.1,
            layer: "top",
          },
          {
            pointId: "thermal_inner_right_outside",
            x: 3.2,
            y: 2.4,
            layer: "top",
          },
        ],
      },
      {
        name: "thermal_inner_top_net",
        pointsToConnect: [
          {
            pointId: "thermal_inner_top_port",
            x: -0.35,
            y: -1.1,
            layer: "top",
          },
          {
            pointId: "thermal_inner_top_outside",
            x: -3.2,
            y: -2.4,
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

test("merged topology preserves inner targets around QFP thermal pad", async (): Promise<void> => {
  await expect(
    getSolverSvgFrames({
      solver: createMergedTopologySolver(
        createQfpThermalPadMergedTopologySrj(),
      ),
      frames: [
        { type: "solver", solverName: "globalTopologySolver" },
        {
          type: "solver",
          solverName: "componentTopologyBatchSolver",
          layer: 0,
        },
        { type: "pipeline", step: "end", layer: "split" },
      ],
      columns: 3,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
