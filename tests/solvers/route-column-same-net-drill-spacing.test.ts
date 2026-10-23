import { expect, test } from "bun:test"
import { RouteColumnIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/RouteColumnIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("same-net pair tasks use legal distinct drill sites or reuse one physical drill", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-net-drills", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 0 },
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 1 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 0 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 1 },
    ],
  }
  const solver = new RouteColumnIntraNodeSolver({
    nodeWithPortPoints: node, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3,
    viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.2, obstacleMargin: 0.1,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "failed").toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes.every((route) => route.regionId === node.capacityMeshNodeId)).toBe(true)
  const sites = solver.solvedRoutes.flatMap((route) => route.vias)
  expect(sites).toHaveLength(2)
  const distance = Math.hypot(sites[0]!.x - sites[1]!.x, sites[0]!.y - sites[1]!.y)
  expect(distance < 1e-9 || distance >= 0.4 - 1e-9).toBe(true)
  expect(solver.counters.routeColumnCapacityRowCount).toBeGreaterThan(0)
  expect(solver.counters.routeColumnFinalDrillIssueCount).toBe(0)
  expect(solver.validationSrj.minViaHoleDiameter).toBe(0.2)
  expect(solver.validationSrj.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
  const shared = new RouteColumnIntraNodeSolver({ ...solver.params, nodeWithPortPoints: { ...node, width: 0.6, height: 0.6 } })
  shared.solve()
  expect(shared.solved, shared.error ?? "failed").toBe(true)
  const sharedSites = shared.solvedRoutes.flatMap((route) => route.vias)
  expect(sharedSites).toHaveLength(2)
  expect(sharedSites[0]).toEqual(sharedSites[1])
})
