import { findRouteGeometryViolations } from "@tscircuit/high-density-b01"
import { expect, test } from "bun:test"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-cm5-spi-cmn133-physical-capacity-high-density-node.json" with {
  type: "json",
}
import { ConflictDirectedB01IntraNodeSolver } from "lib/solvers/HighDensitySolver/ConflictDirectedB01IntraNodeSolver"
import { findIntraNodePhysicalConflicts } from "lib/solvers/HighDensitySolver/find-intra-node-physical-conflicts"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const node = {
  ...nodeJson,
  portPoints: nodeJson.portPointsInPairs.flat(),
} as NodeWithPortPoints
const EPSILON = 1e-8

const endpointIdentity = (
  point: HighDensityIntraNodeRoute["route"][number],
): string => {
  const portPointId = (point as { portPointId?: string }).portPointId ?? ""
  return `${point.x},${point.y},${point.z},${portPointId}`
}

const solveNode = (): ConflictDirectedB01IntraNodeSolver => {
  const solver = new ConflictDirectedB01IntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    clearance: 0.1,
    obstacles: [],
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  return solver
}

test("bugreport101 conflict-directed solver repairs the exact physical cmn133 node", () => {
  const first = solveNode()
  const second = solveNode()
  const firstRoutes = first.getOutput()
  const secondRoutes = second.getOutput()
  const pairs = node.portPointsInPairs!
  const availableZ = new Set(node.availableZ!)
  const bounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }

  expect(firstRoutes).toHaveLength(9)
  expect(secondRoutes).toEqual(firstRoutes)
  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const [expectedStart, expectedEnd] = pairs[pairIndex]!
    const route = firstRoutes[pairIndex]!
    expect(endpointIdentity(route.route[0]!)).toBe(
      endpointIdentity(expectedStart),
    )
    expect(endpointIdentity(route.route.at(-1)!)).toBe(
      endpointIdentity(expectedEnd),
    )
    expect(route.rootConnectionName).toBe(
      expectedStart.rootConnectionName ?? expectedStart.connectionName,
    )
    expect(route.regionId).toBe(node.capacityMeshNodeId)

    const transitionKeys: string[] = []
    for (let pointIndex = 0; pointIndex < route.route.length; pointIndex += 1) {
      const point = route.route[pointIndex]!
      expect(availableZ.has(point.z)).toBeTrue()
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX - EPSILON)
      expect(point.x).toBeLessThanOrEqual(bounds.maxX + EPSILON)
      expect(point.y).toBeGreaterThanOrEqual(bounds.minY - EPSILON)
      expect(point.y).toBeLessThanOrEqual(bounds.maxY + EPSILON)
      if (pointIndex === 0) continue
      const previous = route.route[pointIndex - 1]!
      if (previous.z === point.z) continue
      expect(point.x).toBe(previous.x)
      expect(point.y).toBe(previous.y)
      transitionKeys.push(`${point.x},${point.y}`)
    }
    const viaKeys = route.vias.map((via) => `${via.x},${via.y}`)
    expect(transitionKeys.sort()).toEqual(viaKeys.sort())
    const viaRadius = route.viaDiameter / 2
    for (const via of route.vias) {
      expect(via.x).toBeGreaterThanOrEqual(
        bounds.minX + viaRadius - EPSILON,
      )
      expect(via.x).toBeLessThanOrEqual(
        bounds.maxX - viaRadius + EPSILON,
      )
      expect(via.y).toBeGreaterThanOrEqual(
        bounds.minY + viaRadius - EPSILON,
      )
      expect(via.y).toBeLessThanOrEqual(
        bounds.maxY - viaRadius + EPSILON,
      )
    }
  }

  expect(findRouteGeometryViolations(firstRoutes as any)).toHaveLength(0)
  expect(findIntraNodePhysicalConflicts(firstRoutes, 0.1)).toHaveLength(
    0,
  )
  expect(first.stats).toMatchObject({
    applicable: true,
    initialRouteCount: 7,
    missingPairCount: 2,
    blockerRouteCount: 5,
    repairPairCount: 7,
    alternateInitialSolverCount: 2,
    selectedInitialShuffleSeed: 4,
  })
  expect(first.stats.initialIterations).toBeLessThanOrEqual(350)
  expect(first.stats.alternateInitialIterations).toBeLessThanOrEqual(550)
  expect(first.stats.repairIterations).toBeLessThanOrEqual(2_150)
  expect(second.stats.initialIterations).toBe(first.stats.initialIterations)
  expect(second.stats.alternateInitialIterations).toBe(
    first.stats.alternateInitialIterations,
  )
  expect(second.stats.repairIterations).toBe(first.stats.repairIterations)

  const infeasiblePortalSpacingNode = structuredClone(node)
  const pointA = infeasiblePortalSpacingNode.portPointsInPairs![3]![0]
  const pointB = infeasiblePortalSpacingNode.portPointsInPairs![4]![0]
  pointB.x = pointA.x
  pointB.y = pointA.y + 0.225
  pointB.z = pointA.z
  expect(
    ConflictDirectedB01IntraNodeSolver.isApplicable({
      nodeWithPortPoints: infeasiblePortalSpacingNode,
      traceWidth: 0.15,
      viaDiameter: 0.3,
      clearance: 0.1,
      obstacles: [],
    }),
  ).toBeFalse()
})
