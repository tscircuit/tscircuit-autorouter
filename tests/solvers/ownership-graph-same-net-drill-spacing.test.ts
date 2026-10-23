import { expect, test } from "bun:test"
import { OwnershipGraphIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/OwnershipGraphIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("same-net pair tasks share one physical drill instead of using close distinct drill sites", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-net-drills", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 0 },
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 1 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 0 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 1 },
    ],
  }
  const solver = new OwnershipGraphIntraNodeSolver({
    nodeWithPortPoints: node, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3,
    viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.2, obstacleMargin: 0.1,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "failed").toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes.every((route) => route.regionId === node.capacityMeshNodeId)).toBe(true)
  const sites = solver.solvedRoutes.flatMap((route) => route.vias)
  expect(sites).toHaveLength(2)
  expect(sites[0]).toEqual(sites[1])
  expect(solver.counters.ownershipGraphDrillGeometryConflictCount).toBeGreaterThan(0)
  expect(solver.counters.ownershipGraphFinalDrillIssueCount).toBe(0)
  expect(solver.validationSrj.minViaHoleDiameter).toBe(0.2)
  expect(solver.validationSrj.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
})
