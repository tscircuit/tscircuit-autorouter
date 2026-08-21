import { test, expect } from "bun:test";
import { TraceKeepoutSolver } from "lib/solvers/TraceKeepoutSolver/TraceKeepoutSolver";
import { ConnectivityMap } from "connectivity-map";
import input from "../../../fixtures/features/keepoutsolver/keepoutsolver-jumpers-input.json" with { type: "json" };

test(
  "TraceKeepoutSolver - preserves jumper positions",
  () => {
    const data = (input as any)[0];

    const connMap = new ConnectivityMap(data.connMap.netMap);

    const solver = new TraceKeepoutSolver({
      hdRoutes: data.hdRoutes,
      obstacles: data.obstacles,
      connMap,
      colorMap: data.colorMap,
      keepoutRadiusSchedule: data.keepoutRadiusSchedule,
      srj: data.srj,
    });

    solver.solve();

    expect(solver.solved).toBe(true);

    const redrawnRoutes = solver.getRedrawnHdRoutes();
    expect(redrawnRoutes.length).toBeGreaterThan(0);

    // Find the route that originally had jumpers
    const originalRouteWithJumper = data.hdRoutes.find(
      (r: any) => r.jumpers && r.jumpers.length > 0,
    );
    expect(originalRouteWithJumper).toBeDefined();

    const redrawnRouteWithJumper = redrawnRoutes.find(
      (r) => r.connectionName === originalRouteWithJumper.connectionName,
    );
    expect(redrawnRouteWithJumper).toBeDefined();

    // The redrawn route should still have jumpers
    expect(redrawnRouteWithJumper!.jumpers).toBeDefined();
    expect(redrawnRouteWithJumper!.jumpers!.length).toBe(
      originalRouteWithJumper.jumpers.length,
    );

    // The jumper positions should be preserved in the route
    const jumper = originalRouteWithJumper.jumpers[0];
    const route = redrawnRouteWithJumper!.route;

    // Find the jumper start and end points in the route
    const tolerance = 0.001;
    const hasJumperStart = route.some(
      (p) =>
        Math.abs(p.x - jumper.start.x) < tolerance &&
        Math.abs(p.y - jumper.start.y) < tolerance,
    );
    const hasJumperEnd = route.some(
      (p) =>
        Math.abs(p.x - jumper.end.x) < tolerance &&
        Math.abs(p.y - jumper.end.y) < tolerance,
    );

    expect(hasJumperStart).toBe(true);
    expect(hasJumperEnd).toBe(true);

    // The jumper start and end should be consecutive points in the route
    // (with at most one intermediate point if there's a connecting segment)
    let jumperStartIndex = -1;
    let jumperEndIndex = -1;

    for (let i = 0; i < route.length; i++) {
      const p = route[i]!;
      if (
        Math.abs(p.x - jumper.start.x) < tolerance &&
        Math.abs(p.y - jumper.start.y) < tolerance
      ) {
        jumperStartIndex = i;
      }
      if (
        Math.abs(p.x - jumper.end.x) < tolerance &&
        Math.abs(p.y - jumper.end.y) < tolerance
      ) {
        jumperEndIndex = i;
      }
    }

    expect(jumperStartIndex).toBeGreaterThanOrEqual(0);
    expect(jumperEndIndex).toBeGreaterThanOrEqual(0);

    // The jumper start and end should be consecutive (directly adjacent)
    // because jumper segments should not be subdivided
    const segmentLength = Math.abs(jumperEndIndex - jumperStartIndex);
    expect(segmentLength).toBe(1);
  },
  { timeout: 60_000 },
);

test(
  "TraceKeepoutSolver - produces valid SVG with jumpers",
  () => {
    const data = (input as any)[0];

    const connMap = new ConnectivityMap(data.connMap.netMap);

    const solver = new TraceKeepoutSolver({
      hdRoutes: data.hdRoutes,
      obstacles: data.obstacles,
      connMap,
      colorMap: data.colorMap,
      keepoutRadiusSchedule: data.keepoutRadiusSchedule,
      srj: data.srj,
    });

    solver.solve();

    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path);
  },
  { timeout: 60_000 },
);
