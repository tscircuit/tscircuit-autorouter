import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export const createBoundedRegionalRepairFixture = (): {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
} => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
    obstacles: [
      {
        type: "rect",
        center: { x: -4, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal", "start"],
        circuitJsonMetadata: { pcb_smtpad_id: "start_pad", pcb_port_id: "start" },
      },
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal", "end"],
        circuitJsonMetadata: { pcb_smtpad_id: "end_pad", pcb_port_id: "end" },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["foreign_pad"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "start", pcb_port_id: "start" },
          { x: 4, y: 0, layer: "top", pointId: "end", pcb_port_id: "end" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate geometry")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: evaluatedRoutes,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  return { originalSrj, routes, syntheticConnectionNames: new Set(), drcEvaluator }
}
