import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  applyPipeline9RegionalB01Repairs,
  getPipeline9FixedRouteObstacles,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-regional-b01-repairs"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

const crossesFixedPreload = (
  route: HighDensityRoute,
  fixedRoute: PreloadedHighDensityRoute,
): boolean => {
  for (
    let routePointIndex = 1;
    routePointIndex < route.route.length;
    routePointIndex++
  ) {
    const start = route.route[routePointIndex - 1]!
    const end = route.route[routePointIndex]!
    if (start.z !== 0 || end.z !== 0) continue
    const routeSegmentWidth = Math.max(
      start.traceThickness ?? route.traceThickness,
      end.traceThickness ?? route.traceThickness,
    )
    if (
      minimumDistanceBetweenSegments(
        start,
        end,
        fixedRoute.route[0]!,
        fixedRoute.route[1]!,
      ) <
      (routeSegmentWidth + fixedRoute.traceThickness) / 2 + 0.15
    ) {
      return true
    }
  }
  return false
}

test("Pipeline9 regular regional fallback keeps immutable preloads as obstacles", () => {
  const route: HighDensityRoute = {
    connectionName: "movable",
    rootConnectionName: "movable-root",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: -1.25, z: 0 },
      { x: 0, y: -1.25, z: 1 },
      { x: 0, y: 1.25, z: 1 },
      { x: 0, y: 1.25, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    vias: [
      { x: 0, y: -1.25 },
      { x: 0, y: 1.25 },
    ],
  }
  const fixedRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "fixed-root",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 1, z: 1 },
    ],
    vias: [],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "movable",
        rootConnectionName: "movable-root",
        pointsToConnect: [
          { x: 0, y: -2, layer: "top" },
          { x: 0, y: 2, layer: "top" },
        ],
      },
    ],
  }
  const connMap = new ConnectivityMap({
    "movable-root": ["movable"],
    "fixed-root": ["fixed"],
  })
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes ?? []
    const errors = evaluatedRoutes.some((candidate) =>
      crossesFixedPreload(candidate, fixedRoute),
    )
      ? [
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "immutable_preload_collision",
            center: { x: 0, y: 0 },
          },
        ]
      : [
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "force_regular_fallback_a",
            center: { x: 0, y: 0 },
          },
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "force_regular_fallback_b",
            center: { x: 0, y: 0 },
          },
        ]
    return { errors, errorsWithCenters: errors }
  }
  const fixedRouteBeforeRepair = structuredClone(fixedRoute)
  const routeBeforeRepair = structuredClone(route)

  const fixedRouteObstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: [fixedRoute],
    layerCount: srj.layerCount,
  })
  expect(fixedRouteObstacles).toHaveLength(4)
  expect(fixedRouteObstacles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 2,
        height: 0.1,
        connectedTo: ["fixed", "fixed-root"],
      }),
      expect.objectContaining({
        layers: ["top", "bottom"],
        center: { x: 2, y: 1 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["fixed", "fixed-root"],
      }),
    ]),
  )
  const diagonalObstacles = fixedRouteObstacles.filter((obstacle) =>
    obstacle.obstacleId?.includes("wire_1"),
  )
  expect(diagonalObstacles.map((obstacle) => obstacle.center)).toEqual([
    { x: 1.25, y: 0.25 },
    { x: 1.75, y: 0.75 },
  ])
  expect(
    diagonalObstacles.every(
      (obstacle) =>
        obstacle.layers[0] === "top" &&
        obstacle.width < 0.75 &&
        obstacle.height < 0.75 &&
        obstacle.ccwRotationDegrees === undefined,
    ),
  ).toBeTrue()

  const result = applyPipeline9RegionalB01Repairs({
    srj,
    routes: [route],
    fixedObstacleRoutes: [fixedRoute],
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    preloadRepairTraceIds: new Set([
      "immutable_preload_collision",
      "force_regular_fallback_a",
      "force_regular_fallback_b",
    ]),
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  expect(result).toMatchObject({
    attemptedCandidateCount: 0,
    acceptedCandidateCount: 0,
    fallbackCandidateCount: 0,
  })
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0]!.connectionName).toBe("movable")
  expect(crossesFixedPreload(result.routes[0]!, fixedRoute)).toBeFalse()
  expect(result.routes[0]).toEqual(routeBeforeRepair)
  expect(fixedRoute).toEqual(fixedRouteBeforeRepair)

  const wideRoute: HighDensityRoute = {
    connectionName: "wide-movable",
    rootConnectionName: "wide-movable-root",
    traceThickness: 1,
    viaDiameter: 0.3,
    route: route.route.map((point) => ({ ...point, x: 1.5 })),
    vias: route.vias.map((via) => ({ ...via, x: 1.5 })),
  }
  const wideFixedRoute: PreloadedHighDensityRoute = {
    connectionName: "wide-fixed",
    rootConnectionName: "wide-fixed-root",
    preloadedTraceIndex: 1,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 2.05, y: -0.5, z: 0 },
      { x: 2.05, y: 0.5, z: 0 },
    ],
    vias: [],
  }
  const wideSrj: SimpleRouteJson = {
    ...srj,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      {
        name: "wide-movable",
        rootConnectionName: "wide-movable-root",
        pointsToConnect: [
          { x: 1.5, y: -2, layer: "top" },
          { x: 1.5, y: 2, layer: "top" },
        ],
      },
    ],
  }
  const wideConnMap = new ConnectivityMap({
    "wide-movable-root": ["wide-movable"],
    "wide-fixed-root": ["wide-fixed"],
  })
  const wideDrcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes ?? []
    const errors = evaluatedRoutes.some((candidate) =>
      crossesFixedPreload(candidate, wideFixedRoute),
    )
      ? [
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "immutable_wide_preload_collision",
            center: { x: 0, y: 0 },
          },
        ]
      : [
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "force_wide_regular_fallback_a",
            center: { x: 0, y: 0 },
          },
          {
            type: "pcb_via_trace_clearance_error",
            pcb_trace_id: "force_wide_regular_fallback_b",
            center: { x: 0, y: 0 },
          },
        ]
    return { errors, errorsWithCenters: errors }
  }
  const wideRouteBeforeRepair = structuredClone(wideRoute)
  const fixedCopperMinX =
    wideFixedRoute.route[0]!.x - wideFixedRoute.traceThickness / 2
  expect(fixedCopperMinX).toBeGreaterThan(1.5 + 0.15 + 0.3 / 2)
  expect(fixedCopperMinX).toBeLessThan(1.5 + 0.15 + 1 / 2)

  const wideResult = applyPipeline9RegionalB01Repairs({
    srj: wideSrj,
    routes: [wideRoute],
    fixedObstacleRoutes: [wideFixedRoute],
    newConnections: wideSrj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator: wideDrcEvaluator,
    preloadRepairTraceIds: new Set([
      "immutable_wide_preload_collision",
      "force_wide_regular_fallback_a",
      "force_wide_regular_fallback_b",
    ]),
    connMap: wideConnMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  expect(crossesFixedPreload(wideResult.routes[0]!, wideFixedRoute)).toBeFalse()
  expect(wideResult.routes[0]).toEqual(wideRouteBeforeRepair)
})
