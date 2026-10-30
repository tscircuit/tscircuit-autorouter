import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

export const makeOriginalOwnerCopperFeedbackFixture = (gap = 0.06151): {
  params: ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
  evaluate: (routes: HighDensityRoute[]) => { traces: ReturnType<typeof convertPipeline7HdRoutesToSimplifiedPcbTraces>; native: ReturnType<typeof evaluateRelaxedDrc> }
} => {
  const y = gap + 0.25
  const originalSrj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.2,
    minViaDiameter: 0.3, minViaHoleDiameter: 0.15, minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1, minBoardEdgeClearance: 0,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 2 },
    connections: [
      { name: "via_owner", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "a0" }, { x: 1, y: 0, layer: "inner1", pcb_port_id: "a1" }] },
      { name: "wire_owner", pointsToConnect: [{ x: -1, y, layer: "inner2", pcb_port_id: "b0" }, { x: 1, y, layer: "bottom", pcb_port_id: "b1" }] },
      { name: "bottom_pad_owner", pointsToConnect: [{ x: -1, y: y / 2, layer: "bottom", pcb_port_id: "pad_port" }] },
    ], obstacles: [{ type: "rect", center: { x: -1, y: y / 2 }, width: 0.15, height: y + 0.2,
      layers: ["bottom"], connectedTo: ["pad_port"],
      circuitJsonMetadata: { pcb_smtpad_id: "original_bottom_pad", pcb_port_id: "pad_port" } }],
  }
  const srjWithPointPairs: SimpleRouteJson = { ...structuredClone(originalSrj), connections: structuredClone(originalSrj.connections.slice(0, 2)) }
  const routes: HighDensityRoute[] = [
    { connectionName: "via_owner", rootConnectionName: "via_owner", traceThickness: 0.2, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0, pcb_port_id: "a0" }, { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1, pcb_port_id: "a1" }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "wire_owner", rootConnectionName: "wire_owner", traceThickness: 0.2, viaDiameter: 0.3,
      route: [{ x: -1, y, z: 2, pcb_port_id: "b0" }, { x: -1.5, y, z: 2 },
        { x: -1.5, y, z: 3 }, { x: -1.5, y: 0.8, z: 3 }, { x: -0.4, y: 0.8, z: 3 },
        { x: -0.4, y, z: 3 }, { x: 1, y, z: 3, pcb_port_id: "b1" }], vias: [{ x: -1.5, y }] },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  if (!(connMap instanceof ConnectivityMap)) throw new Error("Expected actual declared connectivity")
  const params: ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] = {
    srj: structuredClone(originalSrj), srjWithPointPairs, originalSrj,
    newConnections: srjWithPointPairs.connections, newHdRoutes: routes, updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(), connMap, obstacles: originalSrj.obstacles, layerCount: 4,
    defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  }
  const evaluate = (hdRoutes: HighDensityRoute[]): { traces: ReturnType<typeof convertPipeline7HdRoutesToSimplifiedPcbTraces>; native: ReturnType<typeof evaluateRelaxedDrc> } => {
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({ connections: params.newConnections,
      originalConnections: originalSrj.connections, hdRoutes, layerCount: 4,
      obstacles: originalSrj.obstacles, defaultViaHoleDiameter: 0.15, connMap })
    const native = evaluateRelaxedDrc({ inputSrj: originalSrj, srjWithPointPairs, routedTraces: traces,
      includeBoardClearance: true, drcOptions: { traceClearance: 0.1, viaClearance: 0.1 } })
    return { traces, native }
  }
  return { params, evaluate }
}
