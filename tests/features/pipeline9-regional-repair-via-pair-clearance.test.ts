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

test("Pipeline9 regional repair clears a real via pair without moving fixed copper", (): void => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_via_trace",
    connection_name: "fixed_via",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0.35,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
        via_hole_diameter: 0.3,
      },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [-2, 2].map(
      (x: number, index: number): Obstacle => ({
        type: "rect",
        center: { x, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: [index === 0 ? "top" : "bottom"],
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
          { x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 2, y: 0, layer: "bottom", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "pcb_port_0" },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1, pcb_port_id: "pcb_port_1" },
      ],
      vias: [{ x: 0, y: 0 }],
    },
  ]
  const connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson> =
    getConnectivityMapFromSimpleRouteJson(srj)
  const fixedRoutes: PreloadedHighDensityRoute[] =
    convertPreloadedTraceToHdRoutes(fixedTrace, 0, 2, 0.4, connMap)
  const fixedSnapshot: PreloadedHighDensityRoute[] =
    structuredClone(fixedRoutes)
  const routeSnapshot: HighDensityRoute[] = structuredClone(routes)
  const inputSnapshot: SimpleRouteJson = structuredClone(srj)
  const drcEvaluator: DrcEvaluator = createPipeline9RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
    mutatedPreloadedTraces: [],
  })
  const initialErrors: ReturnType<typeof getPipeline9DrcErrors> =
    getPipeline9DrcErrors(drcEvaluator, routes)
  expect(initialErrors, JSON.stringify(initialErrors)).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    minimum_clearance: 0.1,
    center: { x: 0, y: 0.175 },
  })
  expect(initialErrors[0]!.actual_clearance).toBeCloseTo(0.05, 12)

  const result: ReturnType<typeof applyPipeline9RegionalB01Repairs> =
    applyPipeline9RegionalB01Repairs({
      srj,
      routes,
      fixedObstacleRoutes: fixedRoutes,
      newConnections: srj.connections,
      syntheticConnectionNames: new Set(),
      drcEvaluator,
      preloadRepairTraceIds: new Set(["signal_0"]),
      additionalRepairConnectionNames: new Set(),
      connMap,
      colorMap: {},
      viaDiameter: 0.4,
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
