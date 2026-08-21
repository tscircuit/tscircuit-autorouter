import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex";
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree";
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver";
import type { HighDensityRoute } from "lib/types/high-density-types";

test("collapses a clear intermediate section between different outer layers", () => {
  const route: HighDensityRoute = {
    connectionName: "multilayer_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  };
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  });

  solver.solve();

  const optimizedRoute = solver.getOptimizedHdRoute();
  expect(optimizedRoute.vias).toHaveLength(1);
  expect(optimizedRoute.route.some((point) => point.z === 1)).toBe(false);
  expect(solver.stats.viasRemovedByMultilayerSectionCollapses).toBe(1);
});
