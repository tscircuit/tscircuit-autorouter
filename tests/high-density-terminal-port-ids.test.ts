import { expect, test } from "bun:test";
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver";
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types";

test("HighDensitySolver carries PCB terminal identities onto route endpoints", () => {
  const start = {
    connectionName: "terminal-test",
    portPointId: "start",
    pcb_port_id: "pcb_port_start",
    x: 0,
    y: 0,
    z: 0,
  };
  const end = {
    connectionName: "terminal-test",
    portPointId: "end",
    pcb_port_id: "pcb_port_end",
    x: 2,
    y: 0,
    z: 0,
  };
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-node",
    center: { x: 1, y: 0 },
    width: 2,
    height: 1,
    availableZ: [0, 1],
    portPoints: [start, end],
    portPointsInPairs: [[start, end]],
  };
  const solver = new HighDensitySolver({
    nodePortPoints: [node],
    layerCount: 2,
    obstacles: [],
    preserveTerminalPcbPortIds: true,
  });

  solver.solve();

  expect(solver.failed).toBe(false);
  expect(solver.routes).toHaveLength(1);
  const route = solver.routes[0]!;
  expect([route.startPcbPortId, route.endPcbPortId].sort()).toEqual([
    "pcb_port_end",
    "pcb_port_start",
  ]);
});

test("HighDensitySolver allows routed fan-out from one PCB terminal", () => {
  const terminal = {
    connectionName: "terminal-fanout",
    portPointId: "terminal",
    pcb_port_id: "pcb_port_shared",
    x: 0,
    y: 0,
    z: 0,
  };
  const branchA = {
    connectionName: "terminal-fanout",
    portPointId: "branch-a",
    x: 2,
    y: -1,
    z: 0,
  };
  const branchB = {
    connectionName: "terminal-fanout",
    portPointId: "branch-b",
    x: 2,
    y: 1,
    z: 0,
  };
  const node = {
    capacityMeshNodeId: "terminal-fanout-node",
    center: { x: 1, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [terminal, branchA, branchB],
    portPointsInPairs: [
      [terminal, branchA],
      [terminal, branchB],
    ],
  } satisfies NodeWithPortPoints;
  const solver = new HighDensitySolver({
    nodePortPoints: [],
    layerCount: 2,
    obstacles: [],
    preserveTerminalPcbPortIds: true,
  });
  const makeRoute = (end: { x: number; y: number; z: number }) =>
    ({
      connectionName: "terminal-fanout",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: terminal.x, y: terminal.y, z: terminal.z }, end],
      vias: [],
    }) satisfies HighDensityIntraNodeRoute;
  const solvedRoutes = [
    makeRoute({ x: branchA.x, y: branchA.y, z: branchA.z }),
    makeRoute({ x: branchB.x, y: branchB.y, z: branchB.z }),
  ];

  const routes = (
    solver as unknown as {
      getSolvedRoutesWithTerminalPcbPortIds: (solver: {
        nodeWithPortPoints: NodeWithPortPoints;
        solvedRoutes: HighDensityIntraNodeRoute[];
      }) => HighDensityIntraNodeRoute[];
    }
  ).getSolvedRoutesWithTerminalPcbPortIds({
    nodeWithPortPoints: node,
    solvedRoutes,
  });

  expect(routes).toHaveLength(2);
  expect(routes.map((route) => route.startPcbPortId)).toContainAllValues([
    "pcb_port_shared",
    "pcb_port_shared",
  ]);
});
