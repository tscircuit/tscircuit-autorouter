import { expect, test } from "bun:test";
import type { Obstacle, SimpleRouteJson } from "lib/types";
import {
  getGraphicsSvgFrames,
  getSolverGraphicsFrames,
} from "../../../fixtures/solver-svg-frames";
import {
  createTopologyMergingSolverFromPlanning,
  createTopologyPlanningSolverForMerging,
} from "../../../fixtures/topology-merging-test-utils";

type RectSpec = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  componentId?: string;
  connectedTo?: string[];
};

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
    __zLayers: [0],
    center: { x, y },
    width,
    height,
    connectedTo,
  };
}

function createQfpThermalPadMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = [];
  const positions = [-1.2, 0, 1.2];

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
    );
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
    );
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
  };
}

test("merged topology preserves inner targets around QFP thermal pad", async (): Promise<void> => {
  const inputSrj = createQfpThermalPadMergedTopologySrj();
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj);
  const planningFrames = getSolverGraphicsFrames({
    solver: topologyPlanningSolver,
    frames: [
      { type: "solver", solverName: "globalTopologySolver" },
      {
        type: "solver",
        solverName: "componentTopologyBatchSolver",
        layer: 0,
      },
      { type: "pipeline", step: "end", layer: "split" },
    ],
  });
  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj,
    topologyPlanningSolver,
  });
  const mergingFrames = getSolverGraphicsFrames({
    solver: topologyMergingSolver,
    frames: [{ type: "pipeline", step: "end", layer: "split" }],
  });

  expect(topologyPlanningSolver.getOutput().componentMeshNodes).toHaveLength(1);
  expect(topologyMergingSolver.solved).toBe(true);
  expect(topologyMergingSolver.failed).toBe(false);
  expect(topologyMergingSolver.getOutput().length).toBeGreaterThan(0);
  await expect(
    getGraphicsSvgFrames({
      frames: [...planningFrames, ...mergingFrames],
      columns: 3,
    }),
  ).toMatchSvgSnapshot(import.meta.path);
});
