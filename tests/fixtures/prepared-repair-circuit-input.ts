import type { PreparedCircuitJsonStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const createPreparedRepairCircuitStats = (): PreparedCircuitJsonStats => ({
  contextBuilds: 0,
  conversions: 0,
  sourceResolverBuilds: 0,
  routeResolverBuilds: 0,
  staticPortBuilds: 0,
  staticPadBuilds: 0,
  sourceConnectivityReuses: 0,
  sourceTraceBuilds: 0,
  sourceConnectivityBuilds: 0,
  routeConnectivityBuilds: 0,
  endpointQueries: 0,
  endpointCacheHits: 0,
  endpointCacheMisses: 0,
  endpointObstacleTests: 0,
  endpointCacheEntries: 0,
  endpointCacheDeclines: 0,
})

export const createPreparedRepairCircuitInput = (seed: number): {
  srj: SimpleRouteJson
  originalSrj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
  hdRoutes: HighDensityRoute[]
} => {
  const layerCount = seed % 2 ? 4 : 2
  const srj: SimpleRouteJson = {
    layerCount,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.25,
    allowBlindAndBuriedVias: seed % 3 === 0,
    bounds: { minX: -10, minY: -10, maxX: 25, maxY: 25 },
    connections: Array.from({ length: 5 }, (_, index) => ({
      name: `net_${index}`,
      __netConnectionName: seed % 3 === 0 ? `root_${index % 3}` : `net_${index}`,
      __rootConnectionNames: [`root_${index % 3}`],
      pointsToConnect: [-2, 2].map((x, endpoint) => ({
        x,
        y: index * 2,
        layer: "top",
        pointId: `point_${index}_${endpoint}`,
        ...(seed % 2 ? {} : { pcb_port_id: `port_${index}_${endpoint}` }),
      })),
    })),
    obstacles: Array.from({ length: 10 }, (_, index) => ({
      type: "rect" as const,
      obstacleId: `point_${Math.floor(index / 2)}_${index % 2}`,
      center: { x: index % 2 ? 2 : -2, y: Math.floor(index / 2) * 2 },
      width: 0.4 + (index % 3) / 10,
      height: 0.5,
      layers: index % 3 === 0 ? ["top", "bottom"] : ["top"],
      connectedTo: [`net_${Math.floor(index / 2)}`, `point_${Math.floor(index / 2)}_${index % 2}`],
      ...(index % 2 ? { ccwRotationDegrees: 30 } : {}),
      circuitJsonMetadata: {
        source_component_name: `U${index}`,
        source_port_name: "1",
        ...(index % 3 === 0
          ? { pcb_plated_hole_id: `plated_${index}` }
          : { pcb_smtpad_id: `pad_${Math.floor(index / 3)}` }),
      },
    })),
  }
  srj.obstacles.push({
    type: "rect",
    obstacleId: "non_plated",
    isNonPlatedHole: true,
    center: { x: 15, y: 15 },
    width: 1,
    height: 2,
    layers: ["top", "bottom"],
    connectedTo: [],
    ccwRotationDegrees: seed % 2 ? 90 : 0,
  })
  const originalSrj = {
    ...srj,
    connections: [
      ...srj.connections,
      { name: "original_only", pointsToConnect: [{ x: 20, y: 20, layer: "top", pcb_port_id: "original_port" }] },
    ],
  }
  const traces: SimplifiedPcbTrace[] = srj.connections.map((connection, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `candidate_${index}`,
    connection_name: connection.name,
    connectsTo: [connection.pointsToConnect[0]!.pointId!, `root_${index % 3}`],
    route: [
      { route_type: "wire", x: -2, y: index * 2, layer: "top", width: 0.12 },
      { route_type: "wire", x: 0, y: index * 2, layer: "top", width: 0.12 },
      { route_type: "via", x: 0, y: index * 2, from_layer: "top", to_layer: "bottom", via_diameter: 0.6, via_hole_diameter: 0.3 },
      { route_type: "wire", x: 2, y: index * 2, layer: "bottom", width: 0.12 },
    ],
  }))
  // Repeated connection names exercise first-route endpoint ownership.
  traces.push({
    ...structuredClone(traces[0]!),
    pcb_trace_id: "duplicate_name",
    route: [
      { route_type: "wire", x: 9, y: 9, layer: "top", width: 0.1 },
      { route_type: "wire", x: 10, y: 10, layer: "top", width: 0.1 },
    ],
  })
  const hdRoutes: HighDensityRoute[] = srj.connections.map((connection, index) => ({
    connectionName: connection.name,
    rootConnectionName: `root_${index % 3}`,
    traceThickness: 0.12,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: index * 2, z: 0 },
      { x: -0.5, y: index * 2, z: 0 },
      { x: 0.5, y: index * 2, z: 0 },
      { x: 2, y: index * 2, z: 0 },
    ],
    vias: [],
    ...(index % 2 ? { jumpers: [{ route_type: "jumper" as const, start: { x: -0.5, y: index * 2 }, end: { x: 0.5, y: index * 2 }, footprint: "0603" as const }] } : {}),
  }))
  return { srj, originalSrj, traces, hdRoutes }
}
