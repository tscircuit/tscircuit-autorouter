import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import * as routeConversion from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("indexed-zero reference checks reuse preparation without losing continuity or preload identities", () => {
  const routes: HighDensityRoute[] = [{
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }],
    vias: [],
  }]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [
      ...[-2, 2].map((x, index) => ({
        type: "rect" as const, center: { x, y: 0 }, width: 0.2, height: 0.2,
        layers: ["top"], connectedTo: [index === 0 ? "route_start" : "route_end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: index === 0 ? "start_pad" : "end_pad",
          pcb_port_id: index === 0 ? "route_start" : "route_end",
        },
      })),
      { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2,
        layers: ["top"], connectedTo: ["foreign_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" } },
    ],
    connections: [
      { name: "route", pointsToConnect: [
        { x: -2, y: 0, layer: "top", pcb_port_id: "route_start" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "route_end" },
      ] },
      { name: "preloaded", pointsToConnect: [
        { x: -2, y: 3, layer: "top", pcb_port_id: "preloaded_start" },
        { x: 2, y: 3, layer: "top", pcb_port_id: "preloaded_end" },
      ] },
    ],
    traces: [{
      type: "pcb_trace",
      pcb_trace_id: "route_0",
      connection_name: "preloaded",
      connectsTo: ["preloaded_start", "preloaded_end"],
      route: [
        { route_type: "wire", x: -2, y: 3, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 3, layer: "top", width: 0.1 },
      ],
    }],
  }
  const params = {
    srj, srjWithPointPairs: srj, originalSrj: srj,
    newConnections: [srj.connections[0]!], newHdRoutes: routes,
    updatedPreloadedTraces: srj.traces!, mutatedPreloadedTraceIds: new Set<string>(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), obstacles: srj.obstacles,
    layerCount: 2, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15,
    effort: 1, colorMap: {},
  }
  const indexedSolver = new Pipeline9JointDrcRepairSolver(params)
  const referenceSolver = new Pipeline9JointDrcRepairSolver(params)
  const indexedEvaluate = indexedSolver.exactRepairSolver!.params.drcEvaluator!
  const referenceEvaluate = (referenceSolver as unknown as {
    cachedReferenceDrcEvaluator: DrcEvaluator
  }).cachedReferenceDrcEvaluator
  const candidate = structuredClone(routes)
  candidate[0]!.route[1]!.y = 0.5
  candidate[0]!.route[2]!.x = 2
  const conversion = spyOn(routeConversion, "convertHdRouteToSimplifiedRoute")
  try {
    const clean = indexedEvaluate({ traces: [], routes: candidate })
    expect(conversion.mock.calls).toHaveLength(1)
    conversion.mockClear()
    expect(clean).toEqual(referenceEvaluate({ traces: [], routes: candidate }))
    expect(conversion.mock.calls).toHaveLength(1)
    expect(Array.isArray(clean) ? clean : clean.errors).toHaveLength(0)
    conversion.mockClear()
    expect(indexedEvaluate({ traces: [], routes: structuredClone(candidate) })).toBe(clean)
    expect(conversion.mock.calls).toHaveLength(0)

    // In-place endpoint edits invalidate the exact key. The indexed engine
    // sees no collision, but complete reference DRC must retain continuity.
    candidate[0]!.route[2]!.x = 1.5
    const disconnected = indexedEvaluate({ traces: [], routes: candidate })
    expect(conversion.mock.calls).toHaveLength(1)
    conversion.mockClear()
    expect(disconnected).toEqual(referenceEvaluate({ traces: [], routes: candidate }))
    expect(conversion.mock.calls).toHaveLength(1)
    expect(Array.isArray(disconnected) ? disconnected : disconnected.errors).toMatchObject([
      { pcb_trace_id: "route_0", pcb_trace_error_id: "missing_connection_route_0_routed_route_end" },
    ])
  } finally {
    conversion.mockRestore()
  }
})
