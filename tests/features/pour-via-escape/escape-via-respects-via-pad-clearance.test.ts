import { expect, test } from "bun:test";
import { pointToBoxDistance } from "@tscircuit/math-utils";
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver";
import type { Obstacle, SimpleRouteJson } from "../../../lib/types";

test("escape vias honor the explicit via-to-pad clearance", () => {
  const requiredClearance = 0.1;
  const viaDiameter = 0.6;
  const neighboringPads: Obstacle[] = [-0.2, 0.2].map((y) => ({
    obstacleId: `neighbor-${y}`,
    type: "rect",
    layers: ["top"],
    center: { x: 0, y },
    width: 0.65,
    height: 0.15,
    connectedTo: [`other-${y}`],
  }));
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: viaDiameter,
    minViaEdgeToPadEdgeClearance: requiredClearance,
    defaultObstacleMargin: 0.01,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        obstacleId: "source-pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.65,
        height: 0.15,
        connectedTo: ["net.GND", "source-pad"],
      },
      ...neighboringPads,
      {
        obstacleId: "gnd-pour",
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 5,
        height: 5,
        connectedTo: ["net.GND"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "net.GND",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "source-pad" }],
      },
    ],
  };

  const solver = new EscapeViaLocationSolver(srj);
  solver.solve();

  const escapePoint = solver
    .getOutputSimpleRouteJson()
    .connections[0]?.pointsToConnect.find((point) =>
      point.pointId?.startsWith("escape-via:"),
    );

  expect(escapePoint).toBeDefined();
  for (const pad of neighboringPads) {
    const clearance = pointToBoxDistance(escapePoint!, pad) - viaDiameter / 2;
    expect(clearance).toBeGreaterThanOrEqual(requiredClearance - 1e-4);
  }
});
