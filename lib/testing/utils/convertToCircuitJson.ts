import { pointToBoxDistance } from "@tscircuit/math-utils"
import type {
  AnyCircuitElement,
  PcbBoard,
  PcbTrace,
  PcbVia,
} from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getViaLayers } from "high-density-repair03/lib"
import { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import type { LayerName } from "lib/utils/mapZToLayerName"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

/**
 * Convert a simplified PCB trace from the autorouter to a circuit-json compatible PCB trace
 */
function convertSimplifiedPcbTraceToCircuitJson(
  simplifiedTrace: SimplifiedPcbTrace,
  connectionName: string,
): PcbTrace {
  return {
    type: "pcb_trace",
    pcb_trace_id: simplifiedTrace.pcb_trace_id,
    source_trace_id: connectionName,
    route: simplifiedTrace.route
      .map((segment) => {
        if (segment.route_type === "wire") {
          if (!isLayerName(segment.layer)) return null
          const startPcbPortId =
            "start_pcb_port_id" in segment &&
            typeof segment.start_pcb_port_id === "string"
              ? segment.start_pcb_port_id
              : undefined
          const endPcbPortId =
            "end_pcb_port_id" in segment &&
            typeof segment.end_pcb_port_id === "string"
              ? segment.end_pcb_port_id
              : undefined
          return {
            route_type: "wire" as const,
            x: segment.x,
            y: segment.y,
            width: segment.width,
            layer: segment.layer,
            ...(startPcbPortId ? { start_pcb_port_id: startPcbPortId } : {}),
            ...(endPcbPortId ? { end_pcb_port_id: endPcbPortId } : {}),
          }
        } else if (segment.route_type === "via") {
          if (
            !isLayerName(segment.from_layer) ||
            !isLayerName(segment.to_layer)
          ) {
            return null
          }
          return {
            route_type: "via" as const,
            x: segment.x,
            y: segment.y,
            from_layer: segment.from_layer,
            to_layer: segment.to_layer,
          }
        } else {
          // jumper/through_obstacle - skip for now as circuit-json doesn't support these route types
          return null
        }
      })
      .filter((segment) => segment !== null),
  }
}

/**
 * Convert a high density route from the autorouter to circuit-json compatible PCB traces.
 * When a route contains jumpers, it splits into multiple disjoint traces that share the
 * same source_trace_id (since they're electrically connected through the jumper component).
 */
function convertHdRouteToCircuitJsonTraces(
  hdRoute: HighDensityRoute,
  baseId: string,
  connectionName: string,
  layerCount: number,
  width = 0.1,
): PcbTrace[] {
  const traces: PcbTrace[] = []

  // If no jumpers, return single trace
  if (!hdRoute.jumpers || hdRoute.jumpers.length === 0) {
    return [
      {
        type: "pcb_trace",
        pcb_trace_id: baseId,
        source_trace_id: connectionName,
        route: hdRoute.route.map((point, index) => {
          const isFirstPoint = index === 0
          const isLastPoint = index === hdRoute.route.length - 1
          return {
            route_type: "wire",
            x: point.x,
            y: point.y,
            width: point.traceThickness ?? width,
            layer: mapZToLayerName(point.z, layerCount),
            ...(isFirstPoint && (point as any).pcb_port_id
              ? { start_pcb_port_id: (point as any).pcb_port_id }
              : {}),
            ...(isLastPoint && (point as any).pcb_port_id
              ? { end_pcb_port_id: (point as any).pcb_port_id }
              : {}),
          }
        }),
      },
    ]
  }

  // Build a set of jumper endpoint indices (where we need to split the trace)
  // Each jumper creates a "gap" in the trace
  const jumperEndpoints: Array<{
    startIdx: number
    endIdx: number
  }> = []

  for (const jumper of hdRoute.jumpers) {
    let startIdx = -1
    let endIdx = -1

    for (let i = 0; i < hdRoute.route.length; i++) {
      const p = hdRoute.route[i]
      if (
        Math.abs(p.x - jumper.start.x) < 0.01 &&
        Math.abs(p.y - jumper.start.y) < 0.01
      ) {
        startIdx = i
      }
      if (
        Math.abs(p.x - jumper.end.x) < 0.01 &&
        Math.abs(p.y - jumper.end.y) < 0.01
      ) {
        endIdx = i
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      // Ensure startIdx < endIdx
      if (startIdx > endIdx) {
        ;[startIdx, endIdx] = [endIdx, startIdx]
      }
      jumperEndpoints.push({ startIdx, endIdx })
    }
  }

  // Sort jumper endpoints by startIdx
  jumperEndpoints.sort((a, b) => a.startIdx - b.startIdx)

  // Split the route into segments between jumpers
  let currentStart = 0
  let traceIndex = 0

  for (const { startIdx, endIdx } of jumperEndpoints) {
    // Create trace from currentStart to startIdx (inclusive)
    if (startIdx >= currentStart) {
      const segmentPoints = hdRoute.route.slice(currentStart, startIdx + 1)
      if (segmentPoints.length > 0) {
        traces.push({
          type: "pcb_trace",
          pcb_trace_id: `${baseId}_${traceIndex}`,
          source_trace_id: connectionName,
          route: segmentPoints.map((point, index) => {
            const isFirstPoint = index === 0 && currentStart === 0
            const isLastPoint = false // Not the overall last point
            return {
              route_type: "wire",
              x: point.x,
              y: point.y,
              width: point.traceThickness ?? width,
              layer: mapZToLayerName(point.z, layerCount),
              ...(isFirstPoint && (point as any).pcb_port_id
                ? { start_pcb_port_id: (point as any).pcb_port_id }
                : {}),
            }
          }),
        })
        traceIndex++
      }
    }
    // Skip from startIdx to endIdx (this is the jumper segment)
    currentStart = endIdx
  }

  // Create final trace from last jumper end to route end
  if (currentStart < hdRoute.route.length) {
    const segmentPoints = hdRoute.route.slice(currentStart)
    if (segmentPoints.length > 0) {
      const isLastSegment = true
      traces.push({
        type: "pcb_trace",
        pcb_trace_id: `${baseId}_${traceIndex}`,
        source_trace_id: connectionName,
        route: segmentPoints.map((point, index) => {
          const isLastPoint =
            isLastSegment && index === segmentPoints.length - 1
          return {
            route_type: "wire",
            x: point.x,
            y: point.y,
            width: point.traceThickness ?? width,
            layer: mapZToLayerName(point.z, layerCount),
            ...(isLastPoint && (point as any).pcb_port_id
              ? { end_pcb_port_id: (point as any).pcb_port_id }
              : {}),
          }
        }),
      })
    }
  }

  return traces
}

const getObstacleConnectivityIds = (obstacles: Obstacle[]) =>
  Array.from(new Set(obstacles.flatMap((obstacle) => obstacle.connectedTo)))

const getCircuitJsonMetadata = (obstacle: Obstacle) =>
  obstacle.circuitJsonMetadata ?? {}

const getSrjDeclaredPcbPortIds = ({
  connections,
  obstacles,
}: Pick<SimpleRouteJson, "connections" | "obstacles">): Set<string> =>
  new Set([
    ...connections.flatMap((connection) =>
      connection.pointsToConnect.flatMap((point) =>
        point.pcb_port_id ? [point.pcb_port_id] : [],
      ),
    ),
    ...obstacles.flatMap((obstacle) => {
      const pcbPortId = getCircuitJsonMetadata(obstacle).pcb_port_id
      return pcbPortId ? [pcbPortId] : []
    }),
  ])

declare const connectivityNetIdBrand: unique symbol
type ConnectivityNetId = string & {
  readonly [connectivityNetIdBrand]: "ConnectivityNetId"
}

declare const circuitJsonSourceTraceIdBrand: unique symbol
type CircuitJsonSourceTraceId = string & {
  readonly [circuitJsonSourceTraceIdBrand]: "CircuitJsonSourceTraceId"
}

declare const srjDeclaredConnectionReferenceBrand: unique symbol
type SrjDeclaredConnectionReference = string & {
  readonly [srjDeclaredConnectionReferenceBrand]: "SrjDeclaredConnectionReference"
}

type CircuitJsonSourceTraceIdBySrjDeclaredConnectionReference = ReadonlyMap<
  SrjDeclaredConnectionReference,
  CircuitJsonSourceTraceId
>

type CircuitJsonSourceTraceIdsByConnectivityNetId = ReadonlyMap<
  ConnectivityNetId,
  ReadonlySet<CircuitJsonSourceTraceId>
>

type CircuitJsonSourceTraceIdResolver = {
  connMap: ConnectivityMap
  circuitJsonSourceTraceIdBySrjDeclaredConnectionReference: CircuitJsonSourceTraceIdBySrjDeclaredConnectionReference
  circuitJsonSourceTraceIdsByConnectivityNetId: CircuitJsonSourceTraceIdsByConnectivityNetId
}

const getCircuitJsonSourceTraceId = (
  connection: SimpleRouteJson["connections"][number],
): CircuitJsonSourceTraceId =>
  (connection.__netConnectionName ??
    connection.__rootConnectionNames?.[0] ??
    connection.name) as CircuitJsonSourceTraceId

const getSrjDeclaredConnectionReferences = (
  connection: SimpleRouteJson["connections"][number],
): SrjDeclaredConnectionReference[] =>
  Array.from(
    new Set([
      connection.name,
      connection.__netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ]),
  ).filter((reference): reference is SrjDeclaredConnectionReference =>
    Boolean(reference),
  )

const createCircuitJsonSourceTraceIdResolver = (
  connections: SimpleRouteJson["connections"],
  connMap: ConnectivityMap,
): CircuitJsonSourceTraceIdResolver => {
  const circuitJsonSourceTraceIdBySrjDeclaredConnectionReference = new Map<
    SrjDeclaredConnectionReference,
    CircuitJsonSourceTraceId
  >()
  const ambiguousSrjDeclaredConnectionReferences =
    new Set<SrjDeclaredConnectionReference>()
  const circuitJsonSourceTraceIdsByConnectivityNetId = new Map<
    ConnectivityNetId,
    Set<CircuitJsonSourceTraceId>
  >()
  for (const connection of connections) {
    const sourceTraceId = getCircuitJsonSourceTraceId(connection)
    for (const reference of getSrjDeclaredConnectionReferences(connection)) {
      const existingSourceTraceId =
        circuitJsonSourceTraceIdBySrjDeclaredConnectionReference.get(reference)
      if (existingSourceTraceId && existingSourceTraceId !== sourceTraceId) {
        circuitJsonSourceTraceIdBySrjDeclaredConnectionReference.delete(
          reference,
        )
        ambiguousSrjDeclaredConnectionReferences.add(reference)
      } else if (!ambiguousSrjDeclaredConnectionReferences.has(reference)) {
        circuitJsonSourceTraceIdBySrjDeclaredConnectionReference.set(
          reference,
          sourceTraceId,
        )
      }
    }

    const connectivityNetId = connMap.getNetConnectedToId(connection.name)
    if (!connectivityNetId) continue
    const brandedConnectivityNetId = connectivityNetId as ConnectivityNetId
    const sourceTraceIds =
      circuitJsonSourceTraceIdsByConnectivityNetId.get(
        brandedConnectivityNetId,
      ) ?? new Set<CircuitJsonSourceTraceId>()
    sourceTraceIds.add(sourceTraceId)
    circuitJsonSourceTraceIdsByConnectivityNetId.set(
      brandedConnectivityNetId,
      sourceTraceIds,
    )
  }
  return {
    connMap,
    circuitJsonSourceTraceIdBySrjDeclaredConnectionReference,
    circuitJsonSourceTraceIdsByConnectivityNetId,
  }
}

const resolveCircuitJsonSourceTraceId = (
  resolver: CircuitJsonSourceTraceIdResolver,
  srjConnectivityId: string,
): CircuitJsonSourceTraceId | undefined => {
  const sourceTraceIdForDeclaredConnectionReference =
    resolver.circuitJsonSourceTraceIdBySrjDeclaredConnectionReference.get(
      srjConnectivityId as SrjDeclaredConnectionReference,
    )
  if (sourceTraceIdForDeclaredConnectionReference) {
    return sourceTraceIdForDeclaredConnectionReference
  }

  const connectivityNetId =
    resolver.connMap.getNetConnectedToId(srjConnectivityId)
  if (!connectivityNetId) return undefined
  const sourceTraceIds =
    resolver.circuitJsonSourceTraceIdsByConnectivityNetId.get(
      connectivityNetId as ConnectivityNetId,
    )
  if (sourceTraceIds?.size !== 1) return undefined
  return sourceTraceIds.values().next().value
}

/**
 * Create source_trace elements from the SimpleRouteJson connections
 * These represent the logical connections between points
 */
function createSourceTraces(
  srj: SimpleRouteJson,
  hdRoutes: SimplifiedPcbTrace[] | HighDensityRoute[],
  sourceSrj = srj,
): AnyCircuitElement[] {
  const sourceTraces: AnyCircuitElement[] = []
  const connections =
    sourceSrj === srj
      ? srj.connections
      : [...srj.connections, ...sourceSrj.connections]
  const obstacles = sourceSrj === srj ? srj.obstacles : sourceSrj.obstacles
  const circuitJsonSourceTraceIdResolver =
    createCircuitJsonSourceTraceIdResolver(
      connections,
      getConnectivityMapFromSimpleRouteJson(
        sourceSrj === srj ? srj : { ...sourceSrj, connections },
      ),
    )
  const declaredPcbPortIds = getSrjDeclaredPcbPortIds({
    connections,
    obstacles,
  })

  // Process each connection to create a source_trace
  connections.forEach((connection) => {
    // Extract port IDs from the connection points
    const connectedPortIds = connection.pointsToConnect
      .map((point) => point.pcb_port_id)
      .filter((pointId): pointId is string => Boolean(pointId))
    const connectedPortIdSet = new Set(connectedPortIds)
    const getNonEndpointObstacleConnectivityIds = (
      matchingObstacles: Obstacle[],
    ) =>
      getObstacleConnectivityIds(matchingObstacles).filter(
        (id) => !connectedPortIdSet.has(id),
      )
    const connectedPointIds = connection.pointsToConnect
      .map((point) => point.pointId)
      .filter((pointId): pointId is string => Boolean(pointId))

    // Look for original connection name (might be MST-suffixed by NetToPointPairsSolver)
    const netConnectionName =
      resolveCircuitJsonSourceTraceId(
        circuitJsonSourceTraceIdResolver,
        connection.name,
      ) ?? getCircuitJsonSourceTraceId(connection)

    // Test for obstacles we're inside of
    const obstaclesContainingEndpoints: Obstacle[] = []
    const hdRoute = hdRoutes.find(
      (r) =>
        ((r as any).connection_name ?? (r as any).connectionName) ===
        connection.name,
    )
    if (hdRoute) {
      const getPointFromSegment = (segment: (typeof hdRoute.route)[0]) => {
        if ("route_type" in segment && segment.route_type === "jumper") {
          return segment.start
        }
        if ("x" in segment && "y" in segment) {
          return { x: segment.x, y: segment.y }
        }
        return { x: 0, y: 0 }
      }

      const endpoints = [
        getPointFromSegment(hdRoute.route[0]),
        getPointFromSegment(hdRoute.route[hdRoute.route.length - 1]),
      ]

      for (const endpoint of endpoints) {
        for (const obstacle of obstacles) {
          if (pointToBoxDistance(endpoint, obstacle) <= 0) {
            obstaclesContainingEndpoints.push(obstacle)
          }
        }
      }
    }

    // Check if this source_trace already exists
    const existingSourceTrace = sourceTraces.find(
      (st) =>
        st.type === "source_trace" && st.source_trace_id === netConnectionName,
    )

    if (existingSourceTrace) {
      // Add these port IDs to the existing source_trace
      const sourceTrace = existingSourceTrace as any
      sourceTrace.connected_source_port_ids = [
        ...new Set([
          ...sourceTrace.connected_source_port_ids,
          ...connectedPortIds,
        ]),
      ]
      sourceTrace.connected_source_net_ids = [
        ...new Set([
          ...(sourceTrace.connected_source_net_ids ?? []),
          ...connectedPointIds,
          ...getNonEndpointObstacleConnectivityIds(
            obstaclesContainingEndpoints,
          ),
        ]),
      ]
    } else {
      // Create a new source_trace for this connection
      sourceTraces.push({
        type: "source_trace",
        source_trace_id: netConnectionName,
        connected_source_port_ids: connectedPortIds,
        connected_source_net_ids: getNonEndpointObstacleConnectivityIds(
          obstaclesContainingEndpoints,
        ).concat(connectedPointIds),
      })
    }
  })

  if (hdRoutes[0] && "type" in hdRoutes[0]) {
    const connectionByName = new Map(
      connections.map((connection) => [connection.name, connection]),
    )
    for (const trace of hdRoutes as SimplifiedPcbTrace[]) {
      const connectedSourcePortIds = [
        ...new Set(
          (trace.connectsTo ?? []).filter((id) => declaredPcbPortIds.has(id)),
        ),
      ]
      const connectedSourcePortIdSet = new Set(connectedSourcePortIds)
      const connectedSourceNetIds = [
        ...new Set(
          (trace.connectsTo ?? []).filter(
            (id) => !connectedSourcePortIdSet.has(id),
          ),
        ),
      ]
      if (
        connectedSourcePortIds.length === 0 &&
        connectedSourceNetIds.length === 0
      )
        continue

      const connection = connectionByName.get(trace.connection_name)
      const sourceTraceId =
        resolveCircuitJsonSourceTraceId(
          circuitJsonSourceTraceIdResolver,
          trace.connection_name,
        ) ??
        trace.connectsTo
          ?.map((connectionId) =>
            resolveCircuitJsonSourceTraceId(
              circuitJsonSourceTraceIdResolver,
              connectionId,
            ),
          )
          .find((connectionName) => connectionName !== undefined) ??
        (connection
          ? getCircuitJsonSourceTraceId(connection)
          : (trace.connection_name as CircuitJsonSourceTraceId))
      const existingSourceTrace = sourceTraces.find(
        (sourceTrace) =>
          sourceTrace.type === "source_trace" &&
          sourceTrace.source_trace_id === sourceTraceId,
      )
      if (existingSourceTrace?.type === "source_trace") {
        existingSourceTrace.connected_source_port_ids = [
          ...new Set([
            ...existingSourceTrace.connected_source_port_ids,
            ...connectedSourcePortIds,
          ]),
        ]
        existingSourceTrace.connected_source_net_ids = [
          ...new Set([
            ...(existingSourceTrace.connected_source_net_ids ?? []),
            ...connectedSourceNetIds,
          ]),
        ]
        continue
      }
      sourceTraces.push({
        type: "source_trace",
        source_trace_id: sourceTraceId,
        connected_source_port_ids: connectedSourcePortIds,
        connected_source_net_ids: connectedSourceNetIds,
      })
    }
  }

  return sourceTraces
}

/**
 * Create circuit-json pcb_port elements for the connection points
 */
function createPcbPorts(srj: SimpleRouteJson): AnyCircuitElement[] {
  const portMap = new Map<string, any>()

  srj.connections.forEach((connection) => {
    connection.pointsToConnect.forEach((point) => {
      if (point.pcb_port_id) {
        portMap.set(point.pcb_port_id, {
          type: "pcb_port",
          pcb_port_id: point.pcb_port_id,
          source_port_id: point.pcb_port_id, // Assuming same ID for simplicity
          x: point.x,
          y: point.y,
          layers: getConnectionPointLayers(point),
        })
      }
    })
  })

  return Array.from(portMap.values())
}

function getPcbPortPositionMap(srj: SimpleRouteJson) {
  const portPositionMap = new Map<string, { x: number; y: number }>()

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue
      portPositionMap.set(point.pcb_port_id, { x: point.x, y: point.y })
    }
  }

  return portPositionMap
}

function getBestObstaclePcbPortId(
  obstacleCenter: Obstacle["center"],
  candidatePortIds: string[],
  portPositionMap: Map<string, { x: number; y: number }>,
): string | undefined {
  let bestPcbPortId: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const pcbPortId of candidatePortIds) {
    const position = portPositionMap.get(pcbPortId)
    if (!position) continue

    const distance = Math.hypot(
      position.x - obstacleCenter.x,
      position.y - obstacleCenter.y,
    )

    if (distance < bestDistance) {
      bestDistance = distance
      bestPcbPortId = pcbPortId
    }
  }

  return bestPcbPortId ?? candidatePortIds[0]
}

const layerNames = new Set<string>([
  "top",
  "bottom",
  "inner1",
  "inner2",
  "inner3",
  "inner4",
  "inner5",
  "inner6",
  "inner7",
  "inner8",
])

const isLayerName = (layer: string): layer is LayerName => layerNames.has(layer)

/**
 * Create pad-like circuit-json elements from SRJ obstacles.
 * Multi-layer obstacles represent plated holes and must not be deduped away
 * against top-side SMT pads that share the same connectivity metadata.
 */
function createPcbPadElements(srj: SimpleRouteJson): AnyCircuitElement[] {
  const pads: AnyCircuitElement[] = []
  const addedSmtPadIds = new Set<string>()
  const addedPlatedHoleIds = new Set<string>()
  const portPositionMap = getPcbPortPositionMap(srj)
  const declaredPcbPortIds = getSrjDeclaredPcbPortIds(srj)

  for (const obstacle of srj.obstacles) {
    const connectedTo = obstacle.connectedTo
    const circuitJsonMetadata = getCircuitJsonMetadata(obstacle)
    if (circuitJsonMetadata.pcb_via_id) continue

    const smtPadId = circuitJsonMetadata.pcb_smtpad_id
    const platedHoleId = circuitJsonMetadata.pcb_plated_hole_id
    const candidatePortIds = [
      ...new Set([
        ...(circuitJsonMetadata.pcb_port_id
          ? [circuitJsonMetadata.pcb_port_id]
          : []),
        ...connectedTo.filter((id) => declaredPcbPortIds.has(id)),
      ]),
    ]
    const pcbPortId = getBestObstaclePcbPortId(
      obstacle.center,
      candidatePortIds,
      portPositionMap,
    )

    if (!smtPadId && !platedHoleId && !pcbPortId) continue

    const layers = obstacle.layers.filter(isLayerName)
    if (layers.length === 0) continue

    const width = obstacle.width
    const height = obstacle.height
    const x = obstacle.center.x
    const y = obstacle.center.y
    const rotationDegrees = obstacle.ccwRotationDegrees

    const isMultiLayerObstacle = Boolean(platedHoleId) || layers.length > 1

    if (isMultiLayerObstacle) {
      const id =
        platedHoleId ?? `pcb_plated_hole_${x.toFixed(3)}_${y.toFixed(3)}`
      if (addedPlatedHoleIds.has(id)) continue
      addedPlatedHoleIds.add(id)

      if (
        typeof rotationDegrees === "number" &&
        Number.isFinite(rotationDegrees)
      ) {
        const holeDiameter = Math.max(Math.min(width, height) * 0.5, 0.1)
        pads.push({
          type: "pcb_plated_hole",
          pcb_plated_hole_id: id,
          shape: "rotated_pill_hole_with_rect_pad",
          hole_shape: "rotated_pill",
          pad_shape: "rect",
          hole_width: holeDiameter,
          hole_height: holeDiameter,
          hole_ccw_rotation: rotationDegrees,
          rect_pad_width: width,
          rect_pad_height: height,
          rect_ccw_rotation: rotationDegrees,
          hole_offset_x: 0,
          hole_offset_y: 0,
          x,
          y,
          layers,
          ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
        })
        continue
      }

      const isCircularLike = Math.abs(width - height) < 0.001

      if (isCircularLike) {
        pads.push({
          type: "pcb_plated_hole",
          pcb_plated_hole_id: id,
          shape: "circle",
          outer_diameter: Math.max(width, height),
          hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
          x,
          y,
          layers,
          ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
        })
        continue
      }

      pads.push({
        type: "pcb_plated_hole",
        pcb_plated_hole_id: id,
        shape: "circular_hole_with_rect_pad",
        hole_shape: "circle",
        hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
        rect_pad_width: width,
        rect_pad_height: height,
        hole_offset_x: 0,
        hole_offset_y: 0,
        x,
        y,
        layers,
        ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
      } as any)
      continue
    }

    const id = smtPadId ?? `pcb_smtpad_${x.toFixed(3)}_${y.toFixed(3)}`
    if (addedSmtPadIds.has(id)) continue
    addedSmtPadIds.add(id)

    if (
      typeof rotationDegrees === "number" &&
      Number.isFinite(rotationDegrees)
    ) {
      pads.push({
        type: "pcb_smtpad",
        pcb_smtpad_id: id,
        layer: layers[0],
        shape: "rotated_rect",
        x,
        y,
        width,
        height,
        ccw_rotation: rotationDegrees,
        ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
      })
      continue
    }

    pads.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: id,
      layer: layers[0],
      shape: "rect",
      width,
      height,
      x,
      y,
      ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
    } as any)
  }

  return pads
}

/**
 * Extract vias from routes and convert them to pcb_via objects
 * @param routes The routes to extract vias from
 * @param minViaDiameter Default diameter for vias
 * @returns An array of PcbVia elements
 */
function extractViasFromRoutes(
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  layerCount: number,
  minViaDiameter = 0.3,
  minViaHoleDiameter = minViaDiameter * 0.5,
): PcbVia[] {
  const vias: PcbVia[] = []
  const viaLocations = new Set<string>() // Track unique via locations

  if (routes.length > 0) {
    if ("type" in routes[0] && routes[0].type === "pcb_trace") {
      // Extract vias from SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        trace.route.forEach((segment) => {
          if (segment.route_type === "via") {
            if (
              !isLayerName(segment.from_layer) ||
              !isLayerName(segment.to_layer)
            ) {
              return
            }
            const viaDiameter = segment.via_diameter ?? minViaDiameter
            const viaHoleDiameter =
              segment.via_hole_diameter ?? minViaHoleDiameter
            const locationKey = `${segment.x},${segment.y},${segment.from_layer},${segment.to_layer}`
            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: trace.pcb_trace_id,
                x: segment.x,
                y: segment.y,
                outer_diameter: viaDiameter,
                hole_diameter: viaHoleDiameter,
                layers: getViaLayers(segment, layerCount) as LayerName[],
              })
              viaLocations.add(locationKey)
            }
          }
        })
      })
    } else {
      // Extract vias from HighDensityRoutes by looking for layer changes
      ;(routes as HighDensityRoute[]).forEach((route, routeIndex) => {
        const traceId = `trace_${routeIndex}`
        const viaDiameter = route.viaDiameter ?? minViaDiameter
        const viaHoleDiameter = minViaHoleDiameter
        for (let i = 1; i < route.route.length; i++) {
          const prevPoint = route.route[i - 1]
          const currPoint = route.route[i]

          // If z-coordinate changes, we have a via
          if (
            prevPoint.z !== currPoint.z &&
            Math.abs(prevPoint.x - currPoint.x) < 0.01 &&
            Math.abs(prevPoint.y - currPoint.y) < 0.01
          ) {
            const fromLayer = mapZToLayerName(prevPoint.z, layerCount)
            const toLayer = mapZToLayerName(currPoint.z, layerCount)
            const locationKey = `${currPoint.x},${currPoint.y},${fromLayer},${toLayer}`

            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: traceId,
                x: currPoint.x,
                y: currPoint.y,
                outer_diameter: viaDiameter,
                hole_diameter: viaHoleDiameter,
                layers: getViaLayers(
                  { from_layer: fromLayer, to_layer: toLayer },
                  layerCount,
                ) as LayerName[],
              })
              viaLocations.add(locationKey)
            }
          }
        }
      })
    }
  }

  return vias
}

/**
 * Convert the autorouter output to circuit-json format
 * @param srjWithPointPairs The SimpleRouteJson created by the NetToPointPairsSolver
 * @param routes The SimplifiedPcbTraces or HighDensityRoutes to convert
 */
export type ConvertToCircuitJsonOptions = {
  minTraceWidth?: number
  minViaDiameter?: number
  minViaHoleDiameter?: number
  originalSrj?: SimpleRouteJson
  includeOriginalConnections?: boolean
}

export function createPcbBoardElement(srj: SimpleRouteJson): PcbBoard {
  const { minX, maxX, minY, maxY } = srj.bounds

  return {
    type: "pcb_board",
    pcb_board_id: "__autorouting_board__",
    thickness: 1.6,
    num_layers: srj.layerCount,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
    ...(srj.outline
      ? { outline: srj.outline, shape: "polygon" as const }
      : { shape: "rect" as const }),
    material: "fr4",
    ...(srj.minBoardEdgeClearance !== undefined
      ? { min_board_edge_clearance: srj.minBoardEdgeClearance }
      : {}),
  }
}

export function convertToCircuitJson(
  srjWithPointPairs: SimpleRouteJson,
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  options: ConvertToCircuitJsonOptions = {},
): AnyCircuitElement[] {
  const {
    minTraceWidth = 0.1,
    minViaDiameter,
    minViaHoleDiameter,
    originalSrj,
    includeOriginalConnections = false,
  } = options
  const viaDimensions = getViaDimensions(srjWithPointPairs)
  const resolvedMinViaDiameter = minViaDiameter ?? viaDimensions.padDiameter
  const requestedMinViaHoleDiameter =
    srjWithPointPairs.min_via_hole_diameter ??
    srjWithPointPairs.minViaHoleDiameter
  const resolvedMinViaHoleDiameter =
    minViaHoleDiameter ??
    requestedMinViaHoleDiameter ??
    (minViaDiameter !== undefined
      ? resolvedMinViaDiameter * 0.5
      : viaDimensions.holeDiameter)

  // Start with empty circuit JSON
  const circuitJson: AnyCircuitElement[] = []

  // Add source traces from connection information
  circuitJson.push(
    ...createSourceTraces(
      srjWithPointPairs,
      routes,
      includeOriginalConnections && originalSrj
        ? originalSrj
        : srjWithPointPairs,
    ),
  )

  // Add PCB ports for connection points
  circuitJson.push(
    ...createPcbPorts(
      includeOriginalConnections && originalSrj
        ? originalSrj
        : srjWithPointPairs,
    ),
  )

  // Add PCB pads / plated holes represented by SRJ obstacles
  circuitJson.push(...createPcbPadElements(originalSrj ?? srjWithPointPairs))

  // Extract and add vias as independent pcb_via elements
  circuitJson.push(
    ...extractViasFromRoutes(
      routes,
      srjWithPointPairs.layerCount,
      resolvedMinViaDiameter,
      resolvedMinViaHoleDiameter,
    ),
  )

  const routeCircuitJsonSourceTraceIdResolver =
    createCircuitJsonSourceTraceIdResolver(
      srjWithPointPairs.connections,
      getConnectivityMapFromSimpleRouteJson(srjWithPointPairs),
    )

  // Process routes based on their type
  if (routes.length > 0) {
    if ("type" in routes[0] && routes[0].type === "pcb_trace") {
      // Handle SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        const connectionName =
          resolveCircuitJsonSourceTraceId(
            routeCircuitJsonSourceTraceIdResolver,
            trace.connection_name,
          ) ??
          trace.connectsTo
            ?.map((connectionId) =>
              resolveCircuitJsonSourceTraceId(
                routeCircuitJsonSourceTraceIdResolver,
                connectionId,
              ),
            )
            .find((mappedConnectionName) => Boolean(mappedConnectionName)) ??
          (trace.connection_name as CircuitJsonSourceTraceId)
        circuitJson.push(
          convertSimplifiedPcbTraceToCircuitJson(
            trace,
            connectionName,
          ) as AnyCircuitElement,
        )
      })
    } else {
      // Handle HighDensityRoutes - may produce multiple traces per route if jumpers exist
      ;(routes as HighDensityRoute[]).forEach((route, index) => {
        const connectionName =
          resolveCircuitJsonSourceTraceId(
            routeCircuitJsonSourceTraceIdResolver,
            route.connectionName,
          ) ?? (route.connectionName as CircuitJsonSourceTraceId)
        const traces = convertHdRouteToCircuitJsonTraces(
          route,
          `trace_${index}`,
          connectionName,
          srjWithPointPairs.layerCount,
          minTraceWidth,
        )
        circuitJson.push(...(traces as AnyCircuitElement[]))
      })
    }
  }

  return circuitJson
}
