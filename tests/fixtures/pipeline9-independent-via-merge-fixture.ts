import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

export const createIndependentViaMergeFixture = (): {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
} => {
  const { originalSrj, routes } = createBoundedRegionalRepairFixture()
  for (const [name, x] of [
    ["power_left", -0.02],
    ["power_right", 0.02],
  ] as const) {
    originalSrj.connections.push({
      name,
      __netConnectionName: "power",
      pointsToConnect: [
        {
          x: -3,
          y: -3,
          layer: "top",
          pointId: "power_start",
          pcb_port_id: "power_start",
        },
        {
          x: 3,
          y: -3,
          layer: "bottom",
          pointId: "power_end",
          pcb_port_id: "power_end",
        },
      ],
    })
    routes.push({
      connectionName: name,
      rootConnectionName: "power",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -3, y: -3, z: 0 },
        { x, y: -3, z: 0 },
        { x, y: -3, z: 1 },
        { x: 3, y: -3, z: 1 },
      ],
      vias: [{ x, y: -3 }],
    })
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate routes")
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: originalSrj.connections,
      originalConnections: originalSrj.connections,
      hdRoutes: evaluatedRoutes,
      layerCount: originalSrj.layerCount,
      obstacles: originalSrj.obstacles,
      defaultViaHoleDiameter: 0.15,
      connMap,
    })
    const result = evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: traces,
      includeBoardClearance: true,
    })
    return {
      ...result,
      errors: addAutoroutingViaTraceIds({
        errors: result.errors as unknown as Array<Record<string, unknown>>,
        circuitJson: result.circuitJson,
        evaluatedTraceIds: new Set(traces.map((trace) => trace.pcb_trace_id)),
      }),
    } as unknown as ReturnType<DrcEvaluator>
  }
  return { originalSrj, routes, connMap, drcEvaluator }
}
