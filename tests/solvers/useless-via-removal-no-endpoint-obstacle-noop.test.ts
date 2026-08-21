import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex";
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree";
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver";
import type { HighDensityRoute } from "lib/types/high-density-types";

test("does not move endpoint sections when no endpoint obstacle proves layer support", () => {
  const route: HighDensityRoute = {
    connectionName: "source_trace_3__source_trace_4_mst1",
    rootConnectionName: "source_trace_3__source_trace_4",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -6.040228, y: -4.167, z: 1 },
      { x: -5.5, y: -4, z: 1 },
      { x: -5.5, y: -4, z: 0 },
      { x: -4.5, y: -4, z: 0 },
    ],
    vias: [{ x: -5.5, y: -4 }],
  };
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({
      net0: ["source_trace_3__source_trace_4_mst1"],
    }),
  });

  solver.solve();

  const optimizedRoute = solver.getOptimizedHdRoute();
  expect(solver.failed).toBe(false);
  expect(solver.solved).toBe(true);
  expect(optimizedRoute.vias).toEqual([{ x: -5.5, y: -4 }]);
  expect(optimizedRoute.route).toEqual(route.route);
});
