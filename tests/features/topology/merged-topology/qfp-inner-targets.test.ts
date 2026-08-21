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

function createQfpMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = [];
  const positions = [-1.2, 0, 1.2];

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
    );
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
  };
}

test("merged topology preserves inner targets in QFP center", async (): Promise<void> => {
  const inputSrj = createQfpMergedTopologySrj();
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj);
  const planningFrames = getSolverGraphicsFrames({
    solver: topologyPlanningSolver,
    frames: [
      {
        type: "solver",
        solverName: "globalTopologySolver",
        step: 80,
        layer: "split",
      },
      {
        type: "solver",
        solverName: "globalTopologySolver",
        layer: "split",
      },
      {
        type: "solver",
        solverName: "componentTopologyBatchSolver",
        step: 2,
        layer: "split",
      },
      {
        type: "solver",
        solverName: "componentTopologyBatchSolver",
        layer: "split",
      },
      { type: "pipeline", step: 218, layer: "split" },
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
