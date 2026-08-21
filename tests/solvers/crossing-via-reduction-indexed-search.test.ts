import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver";
import type { Obstacle } from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";

const createSeparatedDetours = (count: number): HighDensityRoute[] => {
  return Array.from({ length: count }, (_, index) => {
    const x = index * 5;
    return {
      connectionName: `detour_${index}`,
      traceThickness: 0.15,
      viaDiameter: 0.4,
      route: [
        { x, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 1 },
        { x: x + 1, y: 1, z: 1 },
        { x: x + 1, y: 1, z: 0 },
        { x: x + 2, y: 1, z: 0 },
      ],
      vias: [
        { x: x + 1, y: 0 },
        { x: x + 1, y: 1 },
      ],
    };
  });
};

const createBlockedCrossings = (
  count: number,
): { routes: HighDensityRoute[]; obstacles: Obstacle[] } => {
  const routes: HighDensityRoute[] = [];
  const obstacles: Obstacle[] = [];
  for (let index = 0; index < count; index++) {
    const offset = index * 10;
    routes.push(
      {
        connectionName: `detour_${index}`,
        traceThickness: 0.15,
        viaDiameter: 0.4,
        route: [
          { x: offset - 3, y: 3, z: 0 },
          { x: offset - 2, y: 3, z: 0 },
          { x: offset - 2, y: 3, z: 1 },
          { x: offset - 2, y: -2, z: 1 },
          { x: offset - 1, y: -3, z: 1 },
          { x: offset - 1, y: -3, z: 0 },
          { x: offset + 1, y: -5, z: 0 },
        ],
        vias: [
          { x: offset - 2, y: 3 },
          { x: offset - 1, y: -3 },
        ],
      },
      {
        connectionName: `transition_${index}`,
        traceThickness: 0.15,
        viaDiameter: 0.4,
        route: [
          { x: offset, y: 4, z: 1 },
          { x: offset, y: 0, z: 1 },
          { x: offset, y: 0, z: 0 },
          { x: offset - 3, y: 0, z: 0 },
        ],
        vias: [{ x: offset, y: 0 }],
      },
    );
    obstacles.push({
      type: "rect",
      layers: ["bottom"],
      __zLayers: [1],
      center: { x: offset - 2.375, y: 0 },
      width: 0.2,
      height: 0.2,
      connectedTo: [`blocked_${index}`],
    });
  }
  return { routes, obstacles };
};

test("indexes crossing discovery and repeated candidate clearance checks", () => {
  const routeCount = 1000;
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createSeparatedDetours(routeCount),
    obstacles: [],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  });

  solver.solve();

  expect(solver.failed).toBe(false);
  expect(solver.iterations).toBe(1);
  expect(solver.stats.transitionSegmentsIndexed).toBe(routeCount * 2);
  expect(solver.stats.indexedDetourSegmentQueries).toBe(routeCount);
  expect(solver.stats.exactSegmentIntersectionChecks ?? 0).toBe(0);
  expect(solver.timeToSolve).toBeLessThan(1000);
  expect(
    solver.getReducedHdRoutes().every((route) => route.vias.length === 2),
  ).toBe(true);

  const blockedCrossingCount = 500;
  const { routes, obstacles } = createBlockedCrossings(blockedCrossingCount);
  const clearanceSolver = new CrossingViaReductionSolver({
    inputHdRoutes: routes,
    obstacles,
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  });

  clearanceSolver.solve();

  expect(clearanceSolver.failed).toBe(false);
  expect(clearanceSolver.iterations).toBe(1);
  expect(clearanceSolver.stats.exactSegmentIntersectionChecks).toBe(
    blockedCrossingCount,
  );
  expect(clearanceSolver.stats.candidateClearanceChecks).toBe(
    blockedCrossingCount,
  );
  expect(clearanceSolver.timeToSolve).toBeLessThan(1000);
  expect(
    clearanceSolver
      .getReducedHdRoutes()
      .every((route) => route.vias.length > 0),
  ).toBe(true);
});
