import type { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export function createParallelGlobalDrcFixture(withPreload: boolean): ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] {
  const routes: HighDensityRoute[] = [{ connectionName: "horizontal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }]
  const horizontal = { name: "horizontal", pointsToConnect: [
    { x: -1, y: 0, layer: "top", pointId: "pcb_port_h0", pcb_port_id: "pcb_port_h0" },
    { x: 1, y: 0, layer: "top", pointId: "pcb_port_h1", pcb_port_id: "pcb_port_h1" },
  ] }
  const vertical = { name: "vertical", pointsToConnect: [
    { x: 0, y: -1, layer: "top", pointId: "pcb_port_v0", pcb_port_id: "pcb_port_v0" },
    { x: 0, y: 1, layer: "top", pointId: "pcb_port_v1", pcb_port_id: "pcb_port_v1" },
  ] }
  const preload: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "horizontal_0", connection_name: "vertical",
    connectsTo: ["pcb_port_v0", "pcb_port_v1"], route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ] }
  if (!withPreload) routes.push({ connectionName: "vertical", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] })
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 }, connections: [horizontal, vertical], obstacles: [],
    traces: withPreload ? [preload] : [] }
  return { srj, srjWithPointPairs: srj, originalSrj: srj,
    newConnections: withPreload ? [horizontal] : srj.connections, newHdRoutes: routes,
    updatedPreloadedTraces: withPreload ? [preload] : [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), obstacles: srj.obstacles, layerCount: 2,
    defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {} }
}
