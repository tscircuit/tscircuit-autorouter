import { expect, test } from "bun:test"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 autorouting DRC finds every reference trace collision", () => {
  const srjWithPointPairs: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "horizontal_start" },
          { x: 1, y: 0, layer: "top", pointId: "horizontal_end" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pointId: "vertical_start" },
          { x: 0, y: 1, layer: "top", pointId: "vertical_end" },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srjWithPointPairs)
  const conversionOptions = {
    connections: srjWithPointPairs.connections,
    originalConnections: srjWithPointPairs.connections,
    layerCount: srjWithPointPairs.layerCount,
    obstacles: srjWithPointPairs.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs,
    originalSrj: srjWithPointPairs,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "vertical",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    ...conversionOptions,
    hdRoutes: routes,
  })
  const referenceResult = evaluateRelaxedDrc({
    inputSrj: srjWithPointPairs,
    srjWithPointPairs,
    routedTraces: traces,
  })
  const evaluator = createPipeline7AutoroutingDrcEvaluator(conversionOptions)
  const optimizedResult = evaluator({ traces: [], routes })

  if (Array.isArray(optimizedResult)) {
    throw new Error("Autorouting DRC evaluator returned errors without centers")
  }

  const referenceTraceCollisions = referenceResult.errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  )

  expect(referenceTraceCollisions.length).toBe(1)
  expect(optimizedResult.errors.length).toBe(1)
  expect(optimizedResult.errors[0]?.error_type).toBe(
    referenceTraceCollisions[0]?.error_type,
  )
  expect(optimizedResult.errorsWithCenters?.[0]?.center).toEqual({
    x: 0,
    y: 0,
  })
})

test("Pipeline7 candidate conversion reuses static obstacle connectivity", () => {
  let connectivityChecks = 0
  const connMap = {
    areIdsConnected: (left: string, right: string) => {
      connectivityChecks += 1
      return left === "route" && right === "pad"
    },
  } as any
  const connection = {
    name: "route",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "start" },
      { x: 2, y: 0, layer: "bottom", pointId: "end" },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      vias: [{ x: 1, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const convertCandidateRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
      connections: [connection],
      originalConnections: [connection],
      layerCount: 2,
      obstacles: [
        {
          type: "rect",
          layers: ["top", "bottom"],
          center: { x: 1, y: 0 },
          width: 0.5,
          height: 0.5,
          connectedTo: ["pad"],
        },
      ],
      defaultViaHoleDiameter: 0.15,
      connMap,
    })

  const firstResult = convertCandidateRoutes(routes)
  const secondResult = convertCandidateRoutes(structuredClone(routes))

  expect(firstResult).toEqual(secondResult)
  expect(
    firstResult[0]?.route.some(
      (routePoint) => routePoint.route_type === "through_obstacle",
    ),
  ).toBe(true)
  expect(connectivityChecks).toBe(1)
})
