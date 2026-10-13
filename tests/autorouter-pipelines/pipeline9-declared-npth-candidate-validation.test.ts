import { expect, test } from "bun:test"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import capturedInput from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"

test("regular nodes honor explicit non-plated-hole clearance before growth", (): void => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.minTraceToHoleEdgeClearance).toBe(0.2)
  const hole = input.obstacles.find(
    (obstacle) => obstacle.obstacleId === "pcb_hole_7",
  )
  if (!hole || !hole.isNonPlatedHole) {
    throw new Error("Captured non-plated hole is missing")
  }
  expect(hole.center).toEqual({ x: -67.99999999999999, y: 21.35 })
  expect(hole.width).toBe(1.2)
  expect(hole.height).toBe(1.2)
  // Actual regional passage and rejected raw-HD route from the captured board.
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_64",
    center: { x: -67.6, y: 19.112499999999997 },
    width: 2.450000000000003,
    height: 3.2749999999999986,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "ce1027_pp4_z0::0",
        x: -68.82499999999999,
        y: 20.204166666666666,
        z: 0,
        connectionName: "source_net_6_mst17",
        rootConnectionName: "source_net_6",
        nextPortPointId: "ce1658_pp0_z0::0",
      },
      {
        portPointId: "ce1658_pp0_z0::0",
        x: -66.8875,
        y: 20.75,
        z: 0,
        connectionName: "source_net_6_mst17",
        rootConnectionName: "source_net_6",
        prevPortPointId: "ce1027_pp4_z0::0",
      },
    ],
  }
  const rejected: HighDensityIntraNodeRoute = {
    connectionName: "source_net_6_mst17",
    rootConnectionName: "source_net_6",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -68.82499999999999, y: 20.204166666666666, z: 0 },
      { x: -68.71847826086955, y: 20.43306451612903, z: 0 },
      { x: -68.61195652173912, y: 20.538709677419348, z: 0 },
      { x: -68.50543478260869, y: 20.644354838709674, z: 0 },
      { x: -68.39891304347825, y: 20.749999999999996, z: 0 },
      { x: -68.29239130434782, y: 20.749999999999996, z: 0 },
      { x: -68.18586956521737, y: 20.749999999999996, z: 0 },
      { x: -68.07934782608694, y: 20.749999999999996, z: 0 },
      { x: -67.97282608695652, y: 20.749999999999996, z: 0 },
      { x: -67.86630434782607, y: 20.749999999999996, z: 0 },
      { x: -67.75978260869564, y: 20.749999999999996, z: 0 },
      { x: -67.65326086956519, y: 20.749999999999996, z: 0 },
      { x: -67.54673913043476, y: 20.749999999999996, z: 0 },
      { x: -67.44021739130433, y: 20.749999999999996, z: 0 },
      { x: -67.33369565217389, y: 20.749999999999996, z: 0 },
      { x: -67.22717391304346, y: 20.749999999999996, z: 0 },
      { x: -67.12065217391302, y: 20.749999999999996, z: 0 },
      { x: -67.01413043478259, y: 20.749999999999996, z: 0 },
      { x: -66.90760869565216, y: 20.749999999999996, z: 0 },
      { x: -66.8875, y: 20.75, z: 0 }
    ],
    vias: [],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(input)
  connMap.addConnections([["source_net_6_mst17", "source_net_6"]])
  const params = {
    nodeWithPortPoints: node,
    connMap,
    colorMap: { source_net_6_mst17: "red" },
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map<string, number>(),
    obstacles: input.obstacles,
    boardGeometry: {
      bounds: input.bounds,
      outline: input.outline,
      minBoardEdgeClearance: input.minBoardEdgeClearance,
      minTraceToHoleEdgeClearance: input.minTraceToHoleEdgeClearance,
    },
    layerCount: 2,
    physicalViaMode: false,
  }
  const solver = createPipeline9RegularNodeSolver(params)
  expect(solver.validateCandidatesBeforeGrowth).toBe(true)
  const validate = solver.growShrinkSolutionValidator
  if (!validate) throw new Error("Declared hole rule has no candidate validator")
  expect(validate([rejected])).toBe(false)
  const barelyClear: HighDensityIntraNodeRoute = {
    ...rejected,
    route: [{ x: -68.1, y: 20.56, z: 0 }, { x: -67.9, y: 20.56, z: 0 }],
  }
  // This wire clears the actual drilled material by 0.115 mm, below 0.2 mm.
  expect(validate([barelyClear])).toBe(false)
  const legal: HighDensityIntraNodeRoute = {
    ...rejected,
    route: [
      node.portPoints[0]!,
      { x: -68.2, y: 20.45, z: 0 },
      { x: -67.8, y: 20.45, z: 0 },
      node.portPoints[1]!,
    ],
  }
  expect(validate([legal])).toBe(true)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes.length).toBeGreaterThan(0)
  const { traces: _originalCopper, ...obstacleInput } = input
  expect(
    getFixedObstacleViolations({ srj: obstacleInput, routes: solver.routes }),
  ).toEqual([])
  for (const route of solver.routes) expect(route.traceThickness).toBe(0.15)
  const legacy = createPipeline9RegularNodeSolver({
    ...params,
    nodeWithPortPoints: { ...node, availableZ: [0, 1, 2, 3] },
    boardGeometry: { bounds: input.bounds, outline: input.outline },
    layerCount: 4,
  })
  expect(legacy.validateCandidatesBeforeGrowth).toBe(false)
  expect(legacy.growShrinkSolutionValidator).toBeUndefined()
})
