import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type InheritedPadClearanceFixture = {
  srj: SimpleRouteJson
  originalSrj: SimpleRouteJson
  trace: SimplifiedPcbTrace
  solver: Pipeline9JointDrcRepairSolver
}

export const createPipeline9InheritedPadClearanceFixture = (
  includeThroughObstacle = false,
): InheritedPadClearanceFixture => {
  const routeY = -0.34
  const startX = includeThroughObstacle ? -4 : -2
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "inherited_trace",
    connection_name: "preloaded",
    connectsTo: ["preloaded_start", "preloaded_end"],
    route: [
      {
        route_type: "wire",
        x: startX,
        y: routeY,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "preloaded_start",
      },
      ...(includeThroughObstacle
        ? ([
            {
              route_type: "wire",
              x: -3,
              y: routeY,
              width: 0.1,
              layer: "top",
            },
            {
              route_type: "through_obstacle",
              start: { x: -3, y: routeY },
              end: { x: -2, y: routeY },
              from_layer: "top",
              to_layer: "top",
              width: 0.1,
              circuitJsonMetadata: { pcb_smtpad_id: "pad_through" },
            },
            {
              route_type: "wire",
              x: -2,
              y: routeY,
              width: 0.1,
              layer: "top",
            },
          ] satisfies SimplifiedPcbTrace["route"])
        : []),
      { route_type: "wire", x: -0.6, y: routeY, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.6, y: routeY, width: 0.1, layer: "top" },
      {
        route_type: "wire",
        x: 2,
        y: routeY,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "preloaded_end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: startX, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["preloaded_start"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_start",
        pcb_port_id: "preloaded_start",
      },
    },
    {
      type: "rect",
      center: { x: 2, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["preloaded_end"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_end",
        pcb_port_id: "preloaded_end",
      },
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
    },
  ]
  if (includeThroughObstacle) {
    obstacles.push({
      type: "rect",
      center: { x: -2.5, y: routeY },
      width: 1,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["preloaded"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_through" },
    })
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: startX - 1, minY: -2, maxX: 3, maxY: 2 },
    obstacles,
    connections: [
      {
        name: "preloaded",
        pointsToConnect: [
          {
            x: startX,
            y: routeY,
            layer: "top",
            pointId: "preloaded_start",
            pcb_port_id: "preloaded_start",
          },
          {
            x: 2,
            y: routeY,
            layer: "top",
            pointId: "preloaded_end",
            pcb_port_id: "preloaded_end",
          },
        ],
      },
    ],
    traces: [trace],
  }
  const originalSrj = structuredClone(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [],
    newHdRoutes: [],
    updatedPreloadedTraces: [trace],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  return { srj, originalSrj, trace, solver }
}
