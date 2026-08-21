import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex";
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree";
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver";
import type { Obstacle } from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";

test("uses connMap to prove endpoint layer support for synthetic route ids", () => {
  const route: HighDensityRoute = {
    connectionName: "source_net_0_mst1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -6.175, y: -4, z: 0 },
      { x: -5.5, y: -4, z: 0 },
      { x: -5.5, y: -4, z: 1 },
      { x: -4.5, y: -4, z: 1 },
    ],
    vias: [{ x: -5.5, y: -4 }],
  };
  const endpointObstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    __zLayers: [0, 1],
    center: { x: -6.175, y: -4 },
    width: 0.8,
    height: 0.95,
    connectedTo: ["source_net_0"],
  };
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [endpointObstacle]),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({
      net0: ["source_net_0_mst1", "source_net_0"],
    }),
  });

  solver.solve();

  const optimizedRoute = solver.getOptimizedHdRoute();
  expect(solver.failed).toBe(false);
  expect(solver.solved).toBe(true);
  expect(optimizedRoute.vias).toHaveLength(0);
});
