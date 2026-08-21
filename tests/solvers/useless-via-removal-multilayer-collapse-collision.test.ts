import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex";
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree";
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver";
import type { Obstacle } from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";

test("keeps a multilayer section when both adjacent layers are blocked", () => {
  const route: HighDensityRoute = {
    connectionName: "blocked_multilayer_net",
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
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    __zLayers: [0, 2],
    center: { x: 1.5, y: 0 },
    width: 0.5,
    height: 0.5,
    connectedTo: ["other_net"],
  };
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [obstacle]),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  });

  solver.solve();

  const optimizedRoute = solver.getOptimizedHdRoute();
  expect(optimizedRoute.vias).toEqual(route.vias);
  expect(optimizedRoute.route).toEqual(route.route);
  expect(solver.stats.viasRemovedByMultilayerSectionCollapses).toBeUndefined();
});
