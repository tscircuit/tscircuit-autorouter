import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("native pair events solve without adding a local electrical branch or exposing event IDs", (): void => {
  const points: PortPoint[] = [
    {
      x: -0.8,
      y: -0.4,
      z: 0,
      connectionName: "net",
      rootConnectionName: "root",
    },
    {
      x: 0.8,
      y: -0.4,
      z: 0,
      connectionName: "net",
      rootConnectionName: "root",
    },
    {
      x: -0.8,
      y: 0.4,
      z: 0,
      connectionName: "net",
      rootConnectionName: "root",
    },
    {
      x: 0.8,
      y: 0.4,
      z: 0,
      connectionName: "net",
      rootConnectionName: "root",
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "two-local-events",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: points,
    portPointsInPairs: [
      [points[0], points[1]],
      [points[2], points[3]],
    ],
  }
  const params = {
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ owner: ["net", "root"] }),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    cacheProvider: null,
    captureSearchDebug: false,
    priorityFamilySize: 4,
  }
  for (const solver of [
    new CachedIntraNodeRouteSolver(params),
    new PriorityDagIntraNodeSolver(params),
  ]) {
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.solvedRoutes).toHaveLength(2)
    for (const [a, b] of node.portPointsInPairs!) {
      expect(
        solver.solvedRoutes.some((route) => {
          const start = route.route[0]
          const end = route.route.at(-1)!
          return (
            start.x === a.x &&
            start.y === a.y &&
            start.z === a.z &&
            end.x === b.x &&
            end.y === b.y &&
            end.z === b.z
          )
        }),
      ).toBe(true)
    }
    for (const route of solver.solvedRoutes) {
      expect(route.connectionName).toBe("net")
      expect(route.rootConnectionName).toBe("root")
      expect("routeEventId" in route).toBe(false)
    }
  }
})
