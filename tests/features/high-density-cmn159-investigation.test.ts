import { expect, test } from "bun:test"
import { CurvyTraceSolver } from "@tscircuit/curvy-trace-solver"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createSrjFromNodeWithPortPoints } from "lib/utils/createSrjFromNodeWithPortPoints"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import cmn159Data from "../../fixtures/bug-reports/dataset01-circuit102-cmn_159/cmn_159-node-data.json" with {
  type: "json",
}

const getBounds = () => {
  const node = cmn159Data.nodeWithPortPoints
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

const getPerimeterPosition = (point: { x: number; y: number }) => {
  const bounds = getBounds()
  if (Math.abs(point.y - bounds.minY) < 1e-6) {
    return point.x - bounds.minX
  }
  if (Math.abs(point.x - bounds.maxX) < 1e-6) {
    return bounds.maxX - bounds.minX + (point.y - bounds.minY)
  }
  if (Math.abs(point.y - bounds.maxY) < 1e-6) {
    return (
      bounds.maxX -
      bounds.minX +
      bounds.maxY -
      bounds.minY +
      (bounds.maxX - point.x)
    )
  }
  return (
    2 * (bounds.maxX - bounds.minX) +
    (bounds.maxY - bounds.minY) +
    (bounds.maxY - point.y)
  )
}

test("cmn_159 is solved directly by the single-layer no-different-root-intersection fallback", () => {
  const node = structuredClone(cmn159Data.nodeWithPortPoints)

  const perimeterOrder = [...node.portPoints]
    .sort((a, b) => getPerimeterPosition(a) - getPerimeterPosition(b))
    .map((point) => point.connectionName)

  expect(perimeterOrder).toEqual([
    "source_net_3_mst1",
    "source_net_2_mst1",
    "source_net_3_mst1",
    "source_net_6_mst2",
    "source_net_6_mst2",
    "source_net_3_mst1",
    "source_net_2_mst1",
    "source_net_3_mst1",
  ])

  const hyperSolver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    effort: 1,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    cacheProvider: null,
  })

  hyperSolver.solve()

  expect(hyperSolver.solved).toBe(true)
  expect(hyperSolver.failed).toBe(false)
  expect(hyperSolver.error).toBeNull()
  expect(hyperSolver.winningSolver?.getSolverName()).toBe(
    "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver",
  )
  expect(hyperSolver.solvedRoutes).toHaveLength(5)
}, 60_000)

test("cmn_159 net6 route is sensitive to the current obstacle margin", () => {
  const node = structuredClone(cmn159Data.nodeWithPortPoints)
  const bounds = getBounds()
  const connectionGroups = new Map<
    string,
    Array<{ x: number; y: number; z: number }>
  >()

  for (const portPoint of node.portPoints) {
    const points = connectionGroups.get(portPoint.connectionName) ?? []
    points.push({ x: portPoint.x, y: portPoint.y, z: portPoint.z })
    connectionGroups.set(portPoint.connectionName, points)
  }

  const net3 = connectionGroups.get("source_net_3_mst1")!
  const net6 = connectionGroups.get("source_net_6_mst2")!

  const topRoute = {
    connectionName: "source_net_3_mst1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      net3[0]!,
      { x: 9.450000000000001, y: 10.325000000000001, z: 1 },
      { x: 9.500000000000002, y: 10.375000000000002, z: 1 },
      { x: 9.550000000000002, y: 10.425000000000002, z: 1 },
      { x: 9.600000000000003, y: 10.475000000000003, z: 1 },
      { x: 9.650000000000004, y: 10.525000000000004, z: 1 },
      { x: 9.700000000000005, y: 10.475000000000003, z: 1 },
      { x: 9.750000000000005, y: 10.475000000000003, z: 1 },
      { x: 9.800000000000006, y: 10.525000000000004, z: 1 },
      { x: 9.850000000000007, y: 10.525000000000004, z: 1 },
      { x: 9.900000000000007, y: 10.525000000000004, z: 1 },
      { x: 9.950000000000008, y: 10.575000000000005, z: 1 },
      { x: 10.000000000000009, y: 10.575000000000005, z: 1 },
      { x: 10.05000000000001, y: 10.625000000000005, z: 1 },
      { x: 10.10000000000001, y: 10.625000000000005, z: 1 },
      { x: 10.150000000000011, y: 10.625000000000005, z: 1 },
      { x: 10.200000000000012, y: 10.625000000000005, z: 1 },
      { x: 10.250000000000012, y: 10.575000000000005, z: 1 },
      { x: 10.300000000000013, y: 10.525000000000004, z: 1 },
      { x: 10.350000000000014, y: 10.475000000000003, z: 1 },
      { x: 10.400000000000015, y: 10.425000000000002, z: 1 },
      { x: 10.450000000000015, y: 10.375000000000002, z: 1 },
      net3[3]!,
    ],
    vias: [],
  }

  const rightRoute = {
    connectionName: "source_net_3_mst1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      net3[3]!,
      { x: 10.5, y: 10.325000000000001, z: 1 },
      { x: 10.5, y: 10.375000000000002, z: 1 },
      { x: 10.5, y: 10.425000000000002, z: 1 },
      { x: 10.45, y: 10.475000000000003, z: 1 },
      { x: 10.45, y: 10.525000000000004, z: 1 },
      { x: 10.45, y: 10.575000000000005, z: 1 },
      { x: 10.45, y: 10.625000000000005, z: 1 },
      { x: 10.45, y: 10.675000000000006, z: 1 },
      { x: 10.45, y: 10.725000000000007, z: 1 },
      { x: 10.5, y: 10.775000000000007, z: 1 },
      net3[2]!,
    ],
    vias: [],
  }

  const leftRoute = {
    connectionName: "source_net_3_mst1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      net3[0]!,
      { x: 9.450000000000001, y: 10.325000000000001, z: 1 },
      { x: 9.450000000000001, y: 10.375000000000002, z: 1 },
      { x: 9.450000000000001, y: 10.425000000000002, z: 1 },
      { x: 9.450000000000001, y: 10.475000000000003, z: 1 },
      { x: 9.450000000000001, y: 10.525000000000004, z: 1 },
      { x: 9.450000000000001, y: 10.575000000000005, z: 1 },
      { x: 9.450000000000001, y: 10.625000000000005, z: 1 },
      { x: 9.450000000000001, y: 10.675000000000006, z: 1 },
      { x: 9.450000000000001, y: 10.725000000000007, z: 1 },
      net3[1]!,
    ],
    vias: [],
  }

  const failedAtDefaultMargin =
    new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      connectionName: "source_net_6_mst2",
      A: net6[0]!,
      B: net6[1]!,
      bounds,
      obstacleRoutes: [topRoute, rightRoute, leftRoute],
      minDistBetweenEnteringPoints: 0.1,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.2,
      availableZ: [1],
      layerCount: 2,
      futureConnections: [],
      connMap: { areIdsConnected: (a: string, b: string) => a === b } as any,
      hyperParameters: {},
    })

  failedAtDefaultMargin.solve()

  expect(failedAtDefaultMargin.solved).toBe(false)
  expect(failedAtDefaultMargin.failed).toBe(true)

  const solvedAtLowerMargin =
    new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      connectionName: "source_net_6_mst2",
      A: net6[0]!,
      B: net6[1]!,
      bounds,
      obstacleRoutes: [topRoute, rightRoute, leftRoute],
      minDistBetweenEnteringPoints: 0.1,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.05,
      availableZ: [1],
      layerCount: 2,
      futureConnections: [],
      connMap: { areIdsConnected: (a: string, b: string) => a === b } as any,
      hyperParameters: {},
    })

  solvedAtLowerMargin.solve()

  expect(solvedAtLowerMargin.solved).toBe(true)
  expect(solvedAtLowerMargin.failed).toBe(false)
}, 60_000)

test("cmn_159 still produces DRC overlap with a whole-node curvy chain construction", () => {
  const node = structuredClone(cmn159Data.nodeWithPortPoints)
  const bounds = getBounds()
  const connectionGroups = new Map<
    string,
    Array<{
      x: number
      y: number
      z: number
      connectionName: string
      rootConnectionName?: string
    }>
  >()

  for (const portPoint of node.portPoints) {
    const points = connectionGroups.get(portPoint.connectionName) ?? []
    points.push(portPoint)
    connectionGroups.set(portPoint.connectionName, points)
  }

  const net2 = connectionGroups.get("source_net_2_mst1")!
  const net3 = connectionGroups.get("source_net_3_mst1")!
  const net6 = connectionGroups.get("source_net_6_mst2")!

  const curvySolver = new CurvyTraceSolver({
    bounds,
    waypointPairs: [
      {
        start: { x: net6[0]!.x, y: net6[0]!.y },
        end: { x: net6[1]!.x, y: net6[1]!.y },
        networkId: "source_net_6_mst2",
      },
      {
        start: { x: net2[0]!.x, y: net2[0]!.y },
        end: { x: net2[1]!.x, y: net2[1]!.y },
        networkId: "source_net_2_mst1",
      },
      {
        start: { x: net3[0]!.x, y: net3[0]!.y },
        end: { x: net3[1]!.x, y: net3[1]!.y },
        networkId: "source_net_3_mst1",
      },
      {
        start: { x: net3[1]!.x, y: net3[1]!.y },
        end: { x: net3[2]!.x, y: net3[2]!.y },
        networkId: "source_net_3_mst1",
      },
      {
        start: { x: net3[2]!.x, y: net3[2]!.y },
        end: { x: net3[3]!.x, y: net3[3]!.y },
        networkId: "source_net_3_mst1",
      },
    ],
    obstacles: [],
    preferredTraceToTraceSpacing: 0.3,
    preferredObstacleToTraceSpacing: 0.3,
  })

  curvySolver.solve()

  expect(curvySolver.solved).toBe(true)
  expect(curvySolver.failed).toBe(false)

  const rootConnectionNameByConnectionName = new Map<
    string,
    string | undefined
  >(
    node.portPoints.map((portPoint: (typeof node.portPoints)[number]) => [
      portPoint.connectionName,
      portPoint.rootConnectionName,
    ]),
  )

  const routes: HighDensityIntraNodeRoute[] = curvySolver.outputTraces.map(
    (trace) => ({
      connectionName: trace.networkId!,
      rootConnectionName: rootConnectionNameByConnectionName.get(
        trace.networkId!,
      ),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: trace.points.map((point) => ({ ...point, z: 1 })),
      vias: [],
    }),
  )

  const srj = createSrjFromNodeWithPortPoints(node)
  const drc = getDrcErrors(convertToCircuitJson(srj, routes, srj.minTraceWidth))

  expect(drc.errors.length).toBeGreaterThan(0)
  expect(
    drc.errors.some(
      (error) =>
        "message" in error &&
        typeof error.message === "string" &&
        error.message.includes("is too close to trace"),
    ),
  ).toBe(true)
}, 60_000)
