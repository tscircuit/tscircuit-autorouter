import {
  findRouteGeometryViolations,
  HighDensitySolverB02,
} from "@tscircuit/high-density-b01"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-cm5-spi-dominant-high-density-node.json" with {
  type: "json",
}
import { HighDensitySolverB02IntraNodeAdapter } from "lib/solvers/HighDensitySolver/HighDensitySolverB02IntraNodeAdapter"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const node = structuredClone(nodeJson) as NodeWithPortPoints
const [metadataStart, metadataEnd] = node.portPointsInPairs![0]!
metadataStart.pcb_port_id = "terminal-a"
metadataEnd.pcb_port_id = "terminal-b"
for (const portPoint of node.portPoints) {
  if (portPoint.portPointId === metadataStart.portPointId) {
    portPoint.pcb_port_id = metadataStart.pcb_port_id
  }
  if (portPoint.portPointId === metadataEnd.portPointId) {
    portPoint.pcb_port_id = metadataEnd.pcb_port_id
  }
}

const endpointIdentity = (
  point: HighDensityIntraNodeRoute["route"][number],
): string => {
  const portPointId = (point as { portPointId?: string }).portPointId ?? ""
  return `${point.x},${point.y},${point.z},${portPointId}`
}

const solveNode = (): {
  routes: HighDensityIntraNodeRoute[]
  winner: HighDensitySolverB02IntraNodeAdapter
} => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.winningSolver).toBeInstanceOf(
    HighDensitySolverB02IntraNodeAdapter,
  )
  return {
    routes: solver.solvedRoutes,
    winner: solver.winningSolver as HighDensitySolverB02IntraNodeAdapter,
  }
}

const createAutomaticPolicyNode = (
  pairCount: number,
  availableZ: number[],
): NodeWithPortPoints => {
  const portPointsInPairs = Array.from({ length: pairCount }, (_, index) => {
    const z = availableZ[index % availableZ.length]!
    const connectionName = `policy-connection-${index}`
    const start: PortPoint = {
      x: -5,
      y: -3.5 + index,
      z,
      connectionName,
      rootConnectionName: connectionName,
      portPointId: `${connectionName}-start`,
    }
    const end: PortPoint = {
      x: 5,
      y: -3.5 + index,
      z,
      connectionName,
      rootConnectionName: connectionName,
      portPointId: `${connectionName}-end`,
    }
    return [start, end] as [PortPoint, PortPoint]
  })

  return {
    capacityMeshNodeId: "automatic-b02-policy-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ,
    portPoints: portPointsInPairs.flat(),
    portPointsInPairs,
  }
}

test("bugreport101 portfolio selects HighDensitySolverB02 by default", () => {
  const first = solveNode()
  const second = solveNode()
  const pairs = node.portPointsInPairs!
  const originalPortPointIds = new Set(
    pairs
      .flat()
      .map((portPoint) => portPoint.portPointId)
      .filter(
        (portPointId): portPointId is string => portPointId !== undefined,
      ),
  )

  expect(first.routes).toHaveLength(11)
  expect(first.winner.upstreamSolver).toBeInstanceOf(HighDensitySolverB02)
  expect(second.routes).toEqual(first.routes)
  expect(
    getSvgFromGraphicsObject(first.winner.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
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
    expect(route.route[0]!.pcb_port_id).toBe(expectedStart.pcb_port_id)
    expect(route.route.at(-1)!.pcb_port_id).toBe(expectedEnd.pcb_port_id)
    for (const point of route.route) {
      const portPointId = (point as { portPointId?: string }).portPointId
      if (portPointId !== undefined) {
        expect(originalPortPointIds.has(portPointId)).toBeTrue()
      }
    }
  }

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

  const scaledPortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
    effort: 1,
    nodeScaleFactor: 1.25,
  })
  scaledPortfolio.initializeSolvers()
  expect(
    scaledPortfolio.supervisedSolvers?.some(
      ({ solver }) => solver instanceof HighDensitySolverB02IntraNodeAdapter,
    ),
  ).toBeFalse()

  for (const { policyNode, expectedSelected } of [
    {
      policyNode: createAutomaticPolicyNode(8, [0, 1]),
      expectedSelected: false,
    },
    {
      policyNode: createAutomaticPolicyNode(7, [0, 1, 2, 3]),
      expectedSelected: true,
    },
  ]) {
    const adapterParams = {
      nodeWithPortPoints: policyNode,
      traceWidth: 0.15,
      viaDiameter: 0.3,
      clearance: 0.1,
      obstacles: [],
      effort: 1,
    }
    expect(
      HighDensitySolverB02IntraNodeAdapter.isApplicable(adapterParams),
    ).toBeTrue()

    const policyPortfolio = new PortfolioSingleIntraNodeSolver({
      ...adapterParams,
      obstacleMargin: 0.15,
      layerCount: policyNode.availableZ!.length,
    })
    policyPortfolio.initializeSolvers()
    expect(
      policyPortfolio.supervisedSolvers?.some(
        ({ solver }) => solver instanceof HighDensitySolverB02IntraNodeAdapter,
      ),
    ).toBe(expectedSelected)
  }
})
