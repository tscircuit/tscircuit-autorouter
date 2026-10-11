import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reference cache bounds empty-preload candidates and preserves preloaded misses", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point, index) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pointId: `${route.connectionName}_${index}`,
      })),
    })),
    obstacles: [],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: [],
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const reference = solver as unknown as {
    cachedReferenceDrcEvaluator: DrcEvaluator
    referenceDrcValidationCount: number
  }
  const evaluate = reference.cachedReferenceDrcEvaluator
  const first = evaluate({ traces: [], routes })
  const changedRoutes = structuredClone(routes)
  for (const point of changedRoutes[1]!.route) point.x = 0.5
  const second = evaluate({ traces: [], routes: changedRoutes })
  const validationCount = reference.referenceDrcValidationCount
  expect(evaluate({ traces: [], routes: structuredClone(routes) })).toBe(first)
  expect(reference.referenceDrcValidationCount).toBe(validationCount)

  for (const point of changedRoutes[1]!.route) point.x = 0.75
  const mutated = evaluate({ traces: [], routes: changedRoutes })
  expect(mutated).not.toBe(second)
  expect(reference.referenceDrcValidationCount).toBe(validationCount + 1)
  if (Array.isArray(mutated))
    throw new Error("Expected reference errors with centers")
  expect(
    mutated.errorsWithCenters!.find(
      (error) => error.pcb_trace_error_id === "overlap_horizontal_0_vertical_0",
    ),
  ).toMatchObject({ center: { x: 0.75, y: 0 } })

  // Sixteen distinct newer candidates must evict the initial geometry.
  for (let index = 0; index < 16; index++) {
    const candidate = structuredClone(routes)
    for (const point of candidate[1]!.route) point.x = 0.01 * (index + 1)
    evaluate({ traces: [], routes: candidate })
  }
  const afterEviction = evaluate({ traces: [], routes })
  expect(afterEviction).not.toBe(first)
  expect(afterEviction).toEqual(first)
  expect(evaluate({ traces: [], routes: structuredClone(routes) })).toBe(
    afterEviction,
  )

  const preloaded: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preload",
    connection_name: "preloaded",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: -0.6, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: -0.6,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
      { route_type: "wire", x: -0.6, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const preloadedSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [
      {
        name: "new",
        pointsToConnect: [
          { x: 0, y: -1, layer: "bottom", pointId: "new_a" },
          { x: 0, y: 1, layer: "bottom", pointId: "new_b" },
        ],
      },
      {
        name: "preloaded",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "pre_a" },
          { x: 2, y: 0, layer: "bottom", pointId: "pre_b" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top", "bottom"],
        connectedTo: ["foreign_pad"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
      },
    ],
    traces: [preloaded],
  }
  const newRoute: HighDensityRoute = {
    connectionName: "new",
    rootConnectionName: "new",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -1, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
    vias: [],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(preloadedSrj)
  const originalAreIdsConnected = connMap.areIdsConnected.bind(connMap)
  let armed = false
  let connectivityCalls = 0
  connMap.areIdsConnected = (a: string, b: string): boolean => {
    if (
      armed &&
      a.startsWith("pipeline9_preloaded_drc_") &&
      b === "foreign_pad"
    ) {
      connectivityCalls++
      return connectivityCalls >= 3
    }
    return originalAreIdsConnected(a, b)
  }
  const preloadedSolver = new Pipeline9JointDrcRepairSolver({
    srj: preloadedSrj,
    srjWithPointPairs: preloadedSrj,
    originalSrj: preloadedSrj,
    newConnections: [preloadedSrj.connections[0]!],
    newHdRoutes: [newRoute],
    updatedPreloadedTraces: [preloaded],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: preloadedSrj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(preloadedSolver.movablePreloadedSections).toHaveLength(1)
  const preloadedReference = preloadedSolver as unknown as {
    cachedReferenceDrcEvaluator: DrcEvaluator
    referenceDrcValidationCount: number
  }
  const evaluatePreloaded = preloadedReference.cachedReferenceDrcEvaluator
  const candidateA = structuredClone([
    newRoute,
    ...preloadedSolver.movablePreloadedSections.map(
      (section) => section.hdRoute,
    ),
  ])
  for (const point of candidateA[1]!.route) {
    if (point.x === -0.6) point.x = 0
  }
  for (const via of candidateA[1]!.vias) via.x = 0
  const candidateB = structuredClone(candidateA)
  for (const point of candidateB[0]!.route) point.x = -0.75
  armed = true
  const preloadedFirst = evaluatePreloaded({ traces: [], routes: candidateA })
  expect(connectivityCalls).toBe(1)
  expect(
    evaluatePreloaded({ traces: [], routes: structuredClone(candidateA) }),
  ).toBe(preloadedFirst)
  expect(connectivityCalls).toBe(1)
  expect(preloadedReference.referenceDrcValidationCount).toBe(1)
  evaluatePreloaded({ traces: [], routes: candidateB })
  expect(connectivityCalls).toBe(2)
  const preloadedThird = evaluatePreloaded({
    traces: [],
    routes: structuredClone(candidateA),
  })
  expect(connectivityCalls).toBe(3)
  expect(preloadedReference.referenceDrcValidationCount).toBe(3)
  expect(preloadedThird).not.toBe(preloadedFirst)
  if (Array.isArray(preloadedFirst) || Array.isArray(preloadedThird)) {
    throw new Error("Expected reference errors with centers")
  }
  expect(
    preloadedFirst.errors.map((error) => error.pcb_trace_error_id),
  ).toContain("overlap_new_0_via_0")
  expect(preloadedThird.errors).toEqual(
    preloadedFirst.errors.filter(
      (error) => error.pcb_trace_error_id !== "overlap_new_0_via_0",
    ),
  )
  expect(preloadedThird.errorsWithCenters).toEqual(
    preloadedFirst.errorsWithCenters!.filter(
      (error) => error.pcb_trace_error_id !== "overlap_new_0_via_0",
    ),
  )
  expect(
    evaluatePreloaded({ traces: [], routes: structuredClone(candidateA) }),
  ).toBe(preloadedThird)
  expect(connectivityCalls).toBe(3)
  expect(preloadedReference.referenceDrcValidationCount).toBe(3)
})
