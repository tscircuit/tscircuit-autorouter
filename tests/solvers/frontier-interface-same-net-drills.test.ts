import { expect, test } from "bun:test"
import { FrontierIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/FrontierIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("future compatibility preserves same-net drill resources and exact shared-site reuse", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-net", center: { x: 0, y: 0 }, width: 0.6, height: 0.6, availableZ: [0, 1],
    portPoints: [
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 0 },
      { connectionName: "pair-a", rootConnectionName: "root", x: -0.1, y: 0, z: 1 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 0 },
      { connectionName: "pair-b", rootConnectionName: "root", x: 0.1, y: 0, z: 1 },
    ],
  }
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.2, obstacleMargin: 0.1, layerCount: 2 }
  const shared = new FrontierIntraNodeSolver(params)
  shared.solve()
  expect(shared.solved, shared.error ?? "failed").toBe(true)
  expect(shared.solvedRoutes).toHaveLength(2)
  const sites = shared.solvedRoutes.flatMap((route) => route.vias)
  expect(sites).toHaveLength(2)
  expect(sites[0]).toEqual(sites[1])
  expect(shared.solvedRoutes.every((route) => route.regionId === node.capacityMeshNodeId)).toBe(true)
  const tooCloseFamily = new FrontierIntraNodeSolver({ ...params, nodeWithPortPoints: { ...node, width: 2, height: 2 } })
  tooCloseFamily.solve()
  expect(tooCloseFamily.solved).toBe(false)
  expect(tooCloseFamily.error).toContain("board feasibility remains unknown")
  expect(tooCloseFamily.counters.frontierInterfaceFiniteDomainExhaustionCount).toBe(1)
  expect(tooCloseFamily.counters.frontierInterfaceAcceptedCount).toBeUndefined()
  expect(tooCloseFamily.counters.frontierInterfaceDrillGeometryCheckCount).toBeGreaterThan(0)
})
