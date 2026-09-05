import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimplifiedPcbTrace as RepairSimplifiedPcbTrace,
} from "high-density-repair03/lib"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type Pipeline9Repair04Fixture = {
  // This fixture uses the wire/via/jumper subset understood by both packages.
  srj: Omit<SimpleRouteJson, "traces"> & {
    traces: Array<SimplifiedPcbTrace & RepairSimplifiedPcbTrace>
  }
  hdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  referenceDrcEvaluator: DrcEvaluator
}

export function createPipeline9Repair04Fixture(): Pipeline9Repair04Fixture {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [],
      route: [
        { x: -20, y: 1, z: 0, pcb_port_id: "pcb_port_signal_start" },
        { x: -8, y: 1, z: 0 },
        { x: -1, y: 0.6, z: 0 },
        { x: 0, y: 0.6, z: 0 },
        { x: 1, y: 0.6, z: 0 },
        { x: 8, y: 1, z: 0 },
        { x: 20, y: 1, z: 0, pcb_port_id: "pcb_port_signal_end" },
      ],
    },
    {
      connectionName: "distant-signal",
      rootConnectionName: "distant-signal",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [],
      route: [
        { x: -20, y: 20, z: 0, pcb_port_id: "pcb_port_distant_start" },
        { x: 20, y: 20, z: 0, pcb_port_id: "pcb_port_distant_end" },
      ],
    },
  ]
  const srj: Pipeline9Repair04Fixture["srj"] = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -30, minY: -30, maxX: 30, maxY: 30 },
    connections: [
      ...hdRoutes.map((route) => ({
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point, index) => ({
            x: point.x,
            y: point.y,
            layer: "top",
            pointId: point.pcb_port_id ?? `${route.connectionName}_${index}`,
            pcb_port_id: point.pcb_port_id,
          }),
        ),
      })),
      {
        name: "distant-preload",
        pointsToConnect: [
          {
            x: -20,
            y: 25,
            layer: "top",
            pointId: "pcb_port_preload_start",
            pcb_port_id: "pcb_port_preload_start",
          },
          {
            x: 20,
            y: 25,
            layer: "top",
            pointId: "pcb_port_preload_end",
            pcb_port_id: "pcb_port_preload_end",
          },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign", "foreign-net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
      },
      {
        type: "rect",
        center: { x: 25, y: 25 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_distant", "distant-pad-net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_distant" },
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_distant_preload",
        connection_name: "distant-preload",
        connectsTo: ["pcb_port_preload_start", "pcb_port_preload_end"],
        route: [
          {
            route_type: "wire",
            x: -20,
            y: 25,
            width: 0.15,
            layer: "top",
            start_pcb_port_id: "pcb_port_preload_start",
          },
          {
            route_type: "wire",
            x: 20,
            y: 25,
            width: 0.15,
            layer: "top",
            end_pcb_port_id: "pcb_port_preload_end",
          },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const referenceDrcEvaluator = createPipeline9RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
    mutatedPreloadedTraces: [],
  })
  return { srj, hdRoutes, connMap, referenceDrcEvaluator }
}
