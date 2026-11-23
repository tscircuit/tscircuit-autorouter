import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import {
  doRoutesClearForeignObstacleVias,
  pointToObstacleSignedDistance,
  prepareNodeObstacleContext,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/foreignObstacleGeometry"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import {
  loadScenarioBySampleNumber,
  toSimpleRouteJson,
} from "../../scripts/benchmark/scenarios"

type CapturedHdNodeInput = {
  nodeWithPortPoints: NodeWithPortPoints
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  connMapNetMap: Record<string, string[]>
  traceWidth: number
  viaDiameter: number
  viaHoleDiameter: number
  obstacleMargin: number
  effort: number
  layerCount: number
  allowBlindAndBuriedVias: boolean
  minViaHoleEdgeToViaHoleEdgeClearance: number
}

const getViaToRectPadGap = (
  via: { x: number; y: number; viaDiameter: number },
  pad: Obstacle,
): number => {
  const halfW = pad.width / 2
  const halfH = pad.height / 2
  const dx = Math.max(
    pad.center.x - halfW - via.x,
    0,
    via.x - (pad.center.x + halfW),
  )
  const dy = Math.max(
    pad.center.y - halfH - via.y,
    0,
    via.y - (pad.center.y + halfH),
  )
  return Math.hypot(dx, dy) - via.viaDiameter / 2
}

const findForeignPadViaViolations = (
  routes: HighDensityIntraNodeRoute[],
  obstacles: Obstacle[],
  connMap: ConnectivityMap,
  requiredClearance: number,
) => {
  const violations: Array<{
    connectionName: string
    obstacleId?: string
    x: number
    y: number
    gap: number
  }> = []
  for (const route of routes) {
    for (const via of route.vias) {
      for (const obstacle of obstacles) {
        if (isObstacleConnectedToRoute(obstacle, route, connMap)) continue
        const gap = getViaToRectPadGap(
          { x: via.x, y: via.y, viaDiameter: route.viaDiameter },
          obstacle,
        )
        if (gap < requiredClearance - 1e-6) {
          violations.push({
            connectionName: route.connectionName,
            obstacleId: obstacle.obstacleId,
            x: via.x,
            y: via.y,
            gap,
          })
        }
      }
    }
  }
  return violations
}

test("srj16 sample 37 high-density node solver keeps vias clear of foreign BGA pads", () => {
  const raw = gunzipSync(
    new Uint8Array(
      readFileSync(
        new URL(
          "../fixtures/assets/srj16-sample37-hd-node-via-pad.json.gz",
          import.meta.url,
        ),
      ),
    ),
  ).toString("utf8")
  const input = JSON.parse(raw) as CapturedHdNodeInput
  const connMap = new ConnectivityMap(input.connMapNetMap)

  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: input.nodeWithPortPoints,
    obstacles: input.obstacles,
    colorMap: input.colorMap,
    connMap,
    fixedHdRoutes: [],
    preservePhysicalGeometry: false,
    traceWidth: input.traceWidth,
    viaDiameter: input.viaDiameter,
    viaHoleDiameter: input.viaHoleDiameter,
    obstacleMargin: input.obstacleMargin,
    effort: input.effort,
    layerCount: input.layerCount,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias,
    minViaHoleEdgeToViaHoleEdgeClearance:
      input.minViaHoleEdgeToViaHoleEdgeClearance,
  })

  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const violations = findForeignPadViaViolations(
    solver.solvedRoutes,
    input.obstacles,
    connMap,
    input.obstacleMargin,
  )
  expect(violations).toEqual([])
})

test(
  "Pipeline 9 routes srj16 sample 37 with zero via-to-pad or relaxed DRC errors",
  async () => {
    const { scenario } = await loadScenarioBySampleNumber("srj16", 37)
    const srj = toSimpleRouteJson(scenario)
    if (!srj) throw new Error("Expected srj16 sample 37 SimpleRouteJson")
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(srj),
    )
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    if (!solver.srjWithPointPairs) {
      throw new Error("Expected srjWithPointPairs after solve")
    }

    const drc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    })
    expect(drc.errors).toEqual([])
  },
  { timeout: 120_000 },
)

test("foreignObstacleGeometry distinguishes full-stack vs blind/buried vias and same-net pads", () => {
  const connMap = new ConnectivityMap({
    net_a: ["conn_a", "pad_a"],
    net_b: ["conn_b", "pad_b"],
  })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_test",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      {
        x: -0.2,
        y: 0,
        z: 1,
        connectionName: "conn_a_mst0",
        rootConnectionName: "conn_a",
      },
      {
        x: 0.2,
        y: 0,
        z: 2,
        connectionName: "conn_a_mst0",
        rootConnectionName: "conn_a",
      },
    ],
  }
  const topForeignPad: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 0.35, y: 0 },
    width: 0.3,
    height: 0.3,
    connectedTo: ["pad_b"],
  }
  const sameNetPad: Obstacle = {
    type: "rect",
    layers: ["inner1"],
    center: { x: 0.15, y: 0 },
    width: 0.3,
    height: 0.3,
    connectedTo: ["pad_a"],
  }
  const routeWithBuriedVia: HighDensityIntraNodeRoute = {
    connectionName: "conn_a_mst0",
    rootConnectionName: "conn_a",
    traceThickness: 0.1,
    viaDiameter: 0.24,
    route: [
      { x: -0.2, y: 0, z: 1 },
      { x: 0.15, y: 0, z: 1 },
      { x: 0.15, y: 0, z: 2 },
      { x: 0.2, y: 0, z: 2 },
    ],
    vias: [{ x: 0.15, y: 0 }],
  }

  const fullStackCtx = prepareNodeObstacleContext({
    nodeWithPortPoints: node,
    obstacles: [topForeignPad, sameNetPad],
    connMap,
    layerCount: 4,
    viaDiameter: 0.24,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    coordinateScale: 1,
    allowBlindAndBuriedVias: false,
  })
  expect(
    doRoutesClearForeignObstacleVias({
      routes: [routeWithBuriedVia],
      context: fullStackCtx,
      defaultViaDiameter: 0.24,
      onlyCheckBoundaryOverhangVias: true,
    }),
  ).toBe(false)

  const blindBuriedCtx = prepareNodeObstacleContext({
    nodeWithPortPoints: node,
    obstacles: [topForeignPad, sameNetPad],
    connMap,
    layerCount: 4,
    viaDiameter: 0.24,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    coordinateScale: 1,
    allowBlindAndBuriedVias: true,
  })
  expect(
    doRoutesClearForeignObstacleVias({
      routes: [routeWithBuriedVia],
      context: blindBuriedCtx,
      defaultViaDiameter: 0.24,
      onlyCheckBoundaryOverhangVias: true,
    }),
  ).toBe(true)

  const rotatedCircle = pointToObstacleSignedDistance(1, 0, {
    type: "rect",
    shape: "circle",
    layers: ["top"],
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.6,
    connectedTo: [],
  })
  expect(rotatedCircle.signedDistanceToEdge).toBeCloseTo(0.7, 6)
})
