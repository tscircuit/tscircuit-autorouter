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

function createSoicVerticalMergedTopologySrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = [];
  const xs = [-1.8, 1.8];
  const ys = [-2.25, -0.75, 0.75, 2.25];

  for (const x of xs) {
    for (const y of ys) {
      obstacles.push(
        createObstacle({
          id: `u_soic_vertical_${obstacles.length}`,
          componentId: "u_soic_vertical",
          x,
          y,
          width: 0.75,
          height: 0.55,
        }),
      );
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
        id: "inner_top",
        x: 0,
        y: 0.65,
        width: 0.52,
        height: 0.42,
        connectedTo: ["inner_top_port"],
      }),
      createObstacle({
        id: "inner_bottom",
        x: 0,
        y: -0.65,
        width: 0.52,
        height: 0.42,
        connectedTo: ["inner_bottom_port"],
      }),
    ],
    connections: [
      {
        name: "inner_top_net",
        pointsToConnect: [
          { pointId: "inner_top_port", x: 0, y: 0.65, layer: "top" },
          { pointId: "inner_top_outside", x: 3.2, y: 3.1, layer: "top" },
        ],
      },
      {
        name: "inner_bottom_net",
        pointsToConnect: [
          { pointId: "inner_bottom_port", x: 0, y: -0.65, layer: "top" },
          { pointId: "inner_bottom_outside", x: -3.2, y: -3.1, layer: "top" },
        ],
      },
    ],
  };
}

test("merged topology preserves inner targets in vertical SOIC center", async (): Promise<void> => {
  const inputSrj = createSoicVerticalMergedTopologySrj();
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj);
  const planningFrames = getSolverGraphicsFrames({
    solver: topologyPlanningSolver,
    frames: [
      { type: "solver", solverName: "globalTopologySolver", layer: 1 },
      {
        type: "solver",
        solverName: "componentTopologyBatchSolver",
        layer: "split",
      },
      { type: "pipeline", step: "end" },
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
