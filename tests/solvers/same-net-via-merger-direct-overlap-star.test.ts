import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver";
import type { HighDensityRoute } from "lib/types/high-density-types";

const makeViaRoute = (connectionName: string, x: number): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: [{ x, y: 0 }],
});

test("SameNetViaMergerSolver consolidates a chain within the near-merge radius", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute("route-a", 0),
      makeViaRoute("route-b", 0.25),
      makeViaRoute("route-c", 0.5),
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["route-a", "route-b", "route-c"],
    }),
  });

  solver.solve();

  expect(solver.failed).toBe(false);
  expect(solver.iterations).toBeLessThan(10);

  const routes = solver.getMergedViaHdRoutes();
  if (!routes) {
    throw new Error("Expected SameNetViaMergerSolver to emit merged routes");
  }
  expect(routes.flatMap((route) => route.vias)).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
});
