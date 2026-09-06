import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 regional repair targets the colliding via instead of the long trace midpoint", (): void => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_via_trace",
    connection_name: "fixed_via",
    route: [
      {
        route_type: "via",
        x: 8,
        y: 0.25,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -11, minY: -2, maxX: 11, maxY: 2 },
    obstacles: [-10, 10].map(
      (x: number, index: number): Obstacle => ({
        type: "rect",
        center: { x, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [`pcb_port_${index}`, "signal"],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pcb_smtpad_${index}`,
          pcb_port_id: `pcb_port_${index}`,
        },
      }),
    ),
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -10, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 10, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -10, y: 0, z: 0, pcb_port_id: "pcb_port_0" },
        { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_1" },
      ],
      vias: [],
    },
  ]
  const connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson> =
    getConnectivityMapFromSimpleRouteJson(srj)
  const fixedRoutes: PreloadedHighDensityRoute[] =
    convertPreloadedTraceToHdRoutes(fixedTrace, 0, 2, 0.3, connMap)
  const fixedSnapshot: PreloadedHighDensityRoute[] =
    structuredClone(fixedRoutes)
  const routeSnapshot: HighDensityRoute[] = structuredClone(routes)
  const inputSnapshot: SimpleRouteJson = structuredClone(srj)
  const drcEvaluator: DrcEvaluator = createPipeline9RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
    mutatedPreloadedTraces: [],
  })
  const feedback: ReturnType<DrcEvaluator> = drcEvaluator({
    hdRoutes: routes,
    traces: [],
  })
  if (Array.isArray(feedback)) {
    throw new Error("Expected repair feedback with exact error centers")
  }
  expect(feedback.errors, JSON.stringify(feedback.errors)).toHaveLength(1)
  expect(feedback.errors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "signal_0",
    center: { x: 0, y: 0 },
    minimum_clearance: 0.1,
  })
  expect(feedback.errors[0]!.actual_clearance).toBeCloseTo(0.05, 12)
  expect(feedback.errorsWithCenters).toHaveLength(1)
  expect(feedback.errorsWithCenters![0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    center: { x: 8, y: 0.25 },
  })

  const result: ReturnType<typeof applyPipeline9RegionalB01Repairs> =
    applyPipeline9RegionalB01Repairs({
      srj,
      routes,
      fixedObstacleRoutes: fixedRoutes,
      newConnections: srj.connections,
      syntheticConnectionNames: new Set(),
      drcEvaluator,
      preloadRepairTraceIds: new Set(["signal_0"]),
      connMap,
      colorMap: {},
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.1,
      effort: 1,
    })

  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  expect(result.routes).toHaveLength(1)
  expect(getPipeline9DrcErrors(drcEvaluator, result.routes)).toHaveLength(0)
  expect(result.routes[0]!.route[0]).toEqual(routeSnapshot[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routeSnapshot[0]!.route.at(-1))
  expect(fixedRoutes).toEqual(fixedSnapshot)
  expect(routes).toEqual(routeSnapshot)
  expect(srj).toEqual(inputSnapshot)
})
