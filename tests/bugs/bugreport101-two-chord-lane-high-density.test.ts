import { findRouteGeometryViolations } from "@tscircuit/high-density-b01"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-two-chord-lane-high-density-node.json" with {
  type: "json",
}
import { findIntraNodePhysicalConflicts } from "lib/solvers/HighDensitySolver/findIntraNodePhysicalConflicts"
import { TwoChordLaneIntraNodeSolver } from "lib/solvers/HighDensitySolver/TwoChordLaneIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const node = nodeJson as NodeWithPortPoints
const EPSILON = 1e-8

const endpointIdentity = (
  point: HighDensityIntraNodeRoute["route"][number],
): string => {
  const portPointId = (point as { portPointId?: string }).portPointId ?? ""
  return `${point.x},${point.y},${point.z},${portPointId}`
}

const solveNode = (): {
  portfolio: PortfolioSingleIntraNodeSolver
  winner: TwoChordLaneIntraNodeSolver
  routes: HighDensityIntraNodeRoute[]
} => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
    effort: 1,
    enableTwoChordLaneSolver: true,
  })
  portfolio.solve()
  expect(portfolio.solved).toBeTrue()
  expect(portfolio.failed).toBeFalse()
  expect(portfolio.winningSolver).toBeInstanceOf(TwoChordLaneIntraNodeSolver)
  return {
    portfolio,
    winner: portfolio.winningSolver as TwoChordLaneIntraNodeSolver,
    routes: portfolio.solvedRoutes,
  }
}

test("bugreport101 exact two-chord lane solver routes the narrow node", () => {
  const first = solveNode()
  const second = solveNode()
  const pairs = node.portPointsInPairs!
  const availableZ = new Set(node.availableZ!)
  const bounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }

  expect(first.routes).toHaveLength(2)
  expect(second.routes).toEqual(first.routes)
  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const [expectedStart, expectedEnd] = pairs[pairIndex]!
    const route = first.routes[pairIndex]!
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
    expect(route.startPcbPortId).toBe(expectedStart.pcb_port_id)
    expect(route.endPcbPortId).toBe(expectedEnd.pcb_port_id)

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
      expect(via.x).toBeGreaterThanOrEqual(bounds.minX + viaRadius - EPSILON)
      expect(via.x).toBeLessThanOrEqual(bounds.maxX - viaRadius + EPSILON)
      expect(via.y).toBeGreaterThanOrEqual(bounds.minY + viaRadius - EPSILON)
      expect(via.y).toBeLessThanOrEqual(bounds.maxY - viaRadius + EPSILON)
    }
  }

  expect(findRouteGeometryViolations(first.routes as any)).toHaveLength(0)
  expect(findIntraNodePhysicalConflicts(first.routes, 0.1)).toHaveLength(0)
  expect(first.portfolio.iterations).toBe(1)
  expect(first.winner.iterations).toBe(1)
  expect(first.winner.stats).toEqual({
    applicable: true,
    candidateLaneCount: 2,
    candidateValidationCount: 1,
    selectedLane: "right",
    routeCount: 2,
    viaCount: 2,
  })
  expect(second.portfolio.iterations).toBe(first.portfolio.iterations)
  expect(second.winner.iterations).toBe(first.winner.iterations)
  expect(second.winner.stats).toEqual(first.winner.stats)
  expect(
    getSvgFromGraphicsObject(first.winner.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)

  const legacyPortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
    effort: 1,
  })
  legacyPortfolio.initializeSolvers()
  expect(
    legacyPortfolio.supervisedSolvers?.some(
      ({ solver }) => solver instanceof TwoChordLaneIntraNodeSolver,
    ),
  ).toBeFalse()
})
