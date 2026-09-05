import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 resolves frozen preload fragments through explicit section metadata", (): void => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "new",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "fixed-net",
        pointsToConnect: [
          { x: -1, y: -2, layer: "top" },
          { x: 1, y: -2, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-trace",
        connection_name: "fixed-net",
        route: [
          { route_type: "wire", x: -1, y: -2, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: -2, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const sectionName =
    "opaque-section-alias" as ChangedPreloadedTraceSection["connectionName"]
  const newRoute: HighDensityRoute = {
    connectionName: "new",
    rootConnectionName: "new",
    regionId: "new-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const frozenRoute: HighDensityRoute = {
    connectionName: sectionName,
    rootConnectionName: sectionName,
    regionId: "preloaded-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    vias: [],
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [originalSrj.connections[0]!],
    originalConnections: originalSrj.connections,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj,
    srjWithPointPairs: originalSrj,
    originalFixedHdRoutes: convertPreloadedTraceToHdRoutes(
      originalSrj.traces![0]!,
      0,
      2,
      0.3,
      connMap,
    ),
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [
      {
        connectionName: sectionName,
        traceId: "fixed-trace",
        startRoutePosition: 0,
        endRoutePosition: 1,
        connection: {
          name: sectionName,
          pointsToConnect: [
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      },
    ],
    hdRoutes: [newRoute, frozenRoute],
  })

  const errors = getPipeline9DrcErrors(evaluator, [newRoute, frozenRoute])
  expect(errors.some((error) => error.pcb_trace_id === "new_0")).toBe(true)
  expect(
    getPipeline9DrcErrors(evaluator, [
      {
        ...newRoute,
        route: newRoute.route.map((point) => ({ ...point, y: -2 })),
      },
      frozenRoute,
    ]),
  ).toHaveLength(0)
})
