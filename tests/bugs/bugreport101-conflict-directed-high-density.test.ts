import { findRouteGeometryViolations } from "@tscircuit/high-density-b01"
import { expect, test } from "bun:test"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-cm5-spi-dominant-high-density-node.json" with {
  type: "json",
}
import { ConflictDirectedB01IntraNodeSolver } from "lib/solvers/HighDensitySolver/ConflictDirectedB01IntraNodeSolver"
import { findIntraNodePhysicalConflicts } from "lib/solvers/HighDensitySolver/find-intra-node-physical-conflicts"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const node = nodeJson as NodeWithPortPoints

const endpointIdentity = (
  point: HighDensityIntraNodeRoute["route"][number],
): string => {
  const portPointId = (point as { portPointId?: string }).portPointId ?? ""
  return `${point.x},${point.y},${point.z},${portPointId}`
}

const solveNode = (): {
  routes: HighDensityIntraNodeRoute[]
  winner: ConflictDirectedB01IntraNodeSolver
} => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
    effort: 1,
    enableConflictDirectedB01Solver: true,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.winningSolver).toBeInstanceOf(
    ConflictDirectedB01IntraNodeSolver,
  )
  return {
    routes: solver.solvedRoutes,
    winner: solver.winningSolver as ConflictDirectedB01IntraNodeSolver,
  }
}

test("bugreport101 conflict-directed solver repairs the dominant high-density node", () => {
  const first = solveNode()
  const second = solveNode()
  const pairs = node.portPointsInPairs!

  expect(first.routes).toHaveLength(11)
  expect(second.routes).toEqual(first.routes)
  for (let index = 0; index < pairs.length; index += 1) {
    const [expectedStart, expectedEnd] = pairs[index]!
    const route = first.routes[index]!
    expect(endpointIdentity(route.route[0]!)).toBe(
      endpointIdentity(expectedStart),
    )
    expect(endpointIdentity(route.route.at(-1)!)).toBe(
      endpointIdentity(expectedEnd),
    )
    expect(route.regionId).toBe(node.capacityMeshNodeId)
    expect(route.startPcbPortId).toBe(expectedStart.pcb_port_id)
    expect(route.endPcbPortId).toBe(expectedEnd.pcb_port_id)
  }

  expect(findIntraNodePhysicalConflicts(first.routes, 0.1)).toHaveLength(0)
  const clearanceInflatedRoutes = first.routes.map((route) => ({
    ...route,
    traceThickness: route.traceThickness + 0.1,
    viaDiameter: route.viaDiameter + 0.1,
  }))
  expect(
    findRouteGeometryViolations(clearanceInflatedRoutes as any),
  ).toHaveLength(0)

  expect(first.winner.stats).toMatchObject({
    applicable: true,
    initialRouteCount: 10,
    missingPairCount: 1,
    blockerRouteCount: 2,
    repairPairCount: 3,
  })
  expect(first.winner.stats.initialIterations).toBeLessThanOrEqual(600)
  expect(first.winner.stats.repairIterations).toBeLessThanOrEqual(200)
})
