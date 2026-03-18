import {
  CreateSectionSolverInput,
  GraphEdgeId,
  HyperGraphSectionOptimizer2,
  HyperGraphSolver,
  Region,
  SerializedConnection,
  SerializedHyperGraph,
  SerializedSolvedRoute,
} from "@tscircuit/hypergraph"
import { HgPortPointPathingSolver } from "../PortPointPathingSolver/hgportpointpathingsolver"
import {
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
  SerializedConnectionHg,
  SerializedRegionHg,
  SerializedRegionPortHg,
  SolvedRoutesHg,
} from "../PortPointPathingSolver/hgportpointpathingsolver/types"
import { GraphicsObject } from "graphics-debug"

type SerializedHyperGraphHg = Omit<
  SerializedHyperGraph,
  "regions" | "ports"
> & {
  regions: SerializedRegionHg[]
  ports: SerializedRegionPortHg[]
}

const convertSerializedHgHyperGraphToHyperGraphHg = (
  serializedHyperGraph: SerializedHyperGraphHg,
): HyperGraphHg => {
  const { regions: sRegions, ports: sPorts } = serializedHyperGraph

  const regionMap = new Map<string, RegionHg>()
  const portMap = new Map<string, RegionPortHg>()

  for (const region of sRegions) {
    const {
      ports: _ports,
      assignments: _assignments,
      ...regionWithoutAssignments
    } = region as SerializedRegionHg & { assignments?: unknown }

    regionMap.set(region.regionId, {
      ...regionWithoutAssignments,
      d: regionWithoutAssignments.d
        ? structuredClone(regionWithoutAssignments.d)
        : regionWithoutAssignments.d,
      ports: [],
      assignments: undefined,
    })
  }

  const resolveRegion = (
    regionRef?: string | RegionHg | Region | null,
  ): RegionHg | undefined => {
    if (!regionRef) return undefined
    if (typeof regionRef === "string") {
      return regionMap.get(regionRef)
    }
    return regionMap.get(regionRef.regionId) ?? (regionRef as RegionHg)
  }

  const serializedPorts =
    sPorts.length > 0
      ? sPorts
      : sRegions.flatMap((region) => region.ports ?? [])

  for (const port of serializedPorts) {
    const { region1Id, region2Id, region1, region2, d, ...rest } =
      port as SerializedRegionPortHg & {
        region1Id?: string
        region2Id?: string
        region1?: Region | RegionHg | string
        region2?: Region | RegionHg | string
      }

    const resolvedRegion1 = resolveRegion(region1Id ?? region1)
    const resolvedRegion2 = resolveRegion(region2Id ?? region2)

    const serializedRawPort = d as SerializedRegionPortHg["d"] | undefined
    const rawPortRegions = Array.isArray(serializedRawPort?.regions)
      ? serializedRawPort.regions
          .map((regionRef) => resolveRegion(regionRef as string | Region))
          .filter((region): region is RegionHg => Boolean(region))
      : []

    const rawPortBase = serializedRawPort ?? (port as unknown as RegionPortHg).d

    const deserializedPort: RegionPortHg = {
      ...rest,
      portId: port.portId,
      region1: resolvedRegion1 as RegionHg,
      region2: resolvedRegion2 as RegionHg,
      d: {
        ...rawPortBase,
        regions:
          rawPortRegions.length > 0
            ? rawPortRegions
            : [resolvedRegion1, resolvedRegion2].filter(
                (region): region is RegionHg => Boolean(region),
              ),
      },
    }

    portMap.set(deserializedPort.portId, deserializedPort)
    resolvedRegion1?.ports.push(deserializedPort)
    resolvedRegion2?.ports.push(deserializedPort)
  }

  return {
    regions: Array.from(regionMap.values()),
    ports: Array.from(portMap.values()),
  }
}

const convertSerializedConnectionHgToConnectionHg = (
  serializedConnections: SerializedConnectionHg[],
  graph: HyperGraphHg,
): ConnectionHg[] => {
  const connections: ConnectionHg[] = []

  for (const inputConn of serializedConnections) {
    const startRegionId = inputConn.startRegion
    const endRegionId = inputConn.endRegion

    const startRegion = graph.regions.find(
      (region) => region.regionId === startRegionId,
    )
    const endRegion = graph.regions.find(
      (region) => region.regionId === endRegionId,
    )

    if (!startRegion || !endRegion) {
      throw new Error(
        `Missing region for connection ${inputConn.connectionId} (start: ${String(
          startRegionId,
        )}, end: ${String(endRegionId)})`,
      )
    }

    connections.push({
      connectionId: inputConn.connectionId,
      mutuallyConnectedNetworkId:
        inputConn.mutuallyConnectedNetworkId ?? inputConn.connectionId,
      startRegion,
      endRegion,
      simpleRouteConnection: (inputConn as SerializedConnectionHg)
        .simpleRouteConnection,
    })
  }

  return connections
}

const convertSerializedSolvedToSolvedRoutes = (
  routes: SerializedSolvedRoute[],
  graph: HyperGraphHg,
  connections: ConnectionHg[],
): SolvedRoutesHg[] => {
  if (routes.length === 0) return []

  const portMap = new Map(graph.ports.map((port) => [port.portId, port]))
  const regionMap = new Map(
    graph.regions.map((region) => [region.regionId, region]),
  )

  const connectionMap = new Map(
    connections.map((connection) => [connection.connectionId, connection]),
  )
  const serializedRouteConnections = routes.map((route) =>
    toSerializedConnectionHg(route.connection),
  )
  const serializedConvertedConnections =
    serializedRouteConnections.length > 0
      ? convertSerializedConnectionHgToConnectionHg(
          serializedRouteConnections,
          graph,
        )
      : []

  for (const connection of serializedConvertedConnections) {
    if (!connectionMap.has(connection.connectionId)) {
      connectionMap.set(connection.connectionId, connection)
    }
  }

  return routes.map((route) => {
    const path: SolvedRoutesHg["path"] = []
    for (const originalCandidate of route.path) {
      const port = getRequiredPort(
        portMap,
        originalCandidate.portId,
        route.connection.connectionId,
      )
      const candidate: SolvedRoutesHg["path"][number] = {
        port,
        g: originalCandidate.g,
        h: originalCandidate.h,
        f: originalCandidate.f,
        hops: originalCandidate.hops,
        ripRequired: originalCandidate.ripRequired,
      }

      if (originalCandidate.lastPortId) {
        candidate.lastPort = getRequiredPort(
          portMap,
          originalCandidate.lastPortId,
          route.connection.connectionId,
        )
      }
      if (originalCandidate.lastRegionId) {
        candidate.lastRegion = getRequiredRegion(
          regionMap,
          originalCandidate.lastRegionId,
          route.connection.connectionId,
        )
      }
      if (originalCandidate.nextRegionId) {
        candidate.nextRegion = getRequiredRegion(
          regionMap,
          originalCandidate.nextRegionId,
          route.connection.connectionId,
        )
      }

      const parent = path[path.length - 1]
      if (parent) candidate.parent = parent

      path.push(candidate)
    }

    const connection = connectionMap.get(route.connection.connectionId)
    if (!connection) {
      throw new Error(
        `Connection ${route.connection.connectionId} not found while deserializing solved route`,
      )
    }

    return {
      path,
      connection,
      requiredRip: route.requiredRip,
    }
  })
}

const getRequiredPort = (
  portMap: Map<string, RegionPortHg>,
  portId: string,
  connectionId: string,
): RegionPortHg => {
  const port = portMap.get(portId)
  if (!port) {
    throw new Error(
      `Port ${portId} not found while deserializing solved route ${connectionId}`,
    )
  }
  return port
}

const getRequiredRegion = (
  regionMap: Map<string, RegionHg>,
  regionId: string,
  connectionId: string,
): RegionHg => {
  const region = regionMap.get(regionId)
  if (!region) {
    throw new Error(
      `Region ${regionId} not found while deserializing solved route ${connectionId}`,
    )
  }
  return region
}

const inferLayerCount = (graph: HyperGraphHg): number => {
  let maxZ = -1
  for (const region of graph.regions) {
    for (const z of region.d.availableZ ?? []) {
      if (z > maxZ) maxZ = z
    }
  }
  for (const port of graph.ports) {
    if (port.d.z > maxZ) maxZ = port.d.z
  }
  return Math.max(1, maxZ + 1)
}

const toSerializedConnectionHg = (
  connection: SerializedConnection,
): SerializedConnectionHg => {
  return {
    connectionId: connection.connectionId,
    mutuallyConnectedNetworkId:
      connection.mutuallyConnectedNetworkId ?? connection.connectionId,
    startRegion: connection.startRegionId,
    endRegion: connection.endRegionId,
  }
}


export class HgSectionSolver extends HyperGraphSectionOptimizer2 {
  protected override createHyperGraphSolver(
    input: CreateSectionSolverInput,
  ): HyperGraphSolver<RegionHg, RegionPortHg> {
    const {
      inputConnections: serializedInputConnection,
      inputGraph: serializedInputGraph,
      inputSolvedRoutes: serializedInputSolvedRoutes,
    } = input

    const hyperGraph = convertSerializedHgHyperGraphToHyperGraphHg(
      serializedInputGraph as unknown as SerializedHyperGraphHg,
    )
    const connections = convertSerializedConnectionHgToConnectionHg(
      serializedInputConnection as unknown as SerializedConnectionHg[],
      this.graph
    )
    const solvedRoutes = convertSerializedSolvedToSolvedRoutes(
      serializedInputSolvedRoutes as SerializedSolvedRoute[],
      hyperGraph,
      connections,
    )

    return new HgPortPointPathingSolver({
      graph: hyperGraph,
      connections,
      inputSolvedRoutes: solvedRoutes,
      layerCount: inferLayerCount(hyperGraph),
      effort: 1,
      flags: {
        FORCE_CENTER_FIRST: true,
        RIPPING_ENABLED: true,
      },
      weights: {
        SHUFFLE_SEED: 0,
        MEMORY_PF_FACTOR: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        CENTER_OFFSET_FOCUS_SHIFT: 0,
        NODE_PF_FACTOR: 0,
        LAYER_CHANGE_COST: 0,
        RIPPING_PF_COST: 0.0,
        NODE_PF_MAX_PENALTY: 100,
        BASE_CANDIDATE_COST: 0.6,
        MAX_ITERATIONS_PER_PATH: 0,
        RANDOM_WALK_DISTANCE: 0,
        START_RIPPING_PF_THRESHOLD: 0.3,
        END_RIPPING_PF_THRESHOLD: 1,
        MAX_RIPS: 1000,
        RANDOM_RIP_FRACTION: 0.3,
        STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
        GREEDY_MULTIPLIER: 0.7,
        MIN_ALLOWED_BOARD_SCORE: -10000,
      },
    })
  }


  visualize(): GraphicsObject {
    if(this.activeSubSolver){
        return this.activeSubSolver.visualize()
    }

    return {}
  }
}
