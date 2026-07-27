import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import {
  getCanonicalConnectionName,
  getCanonicalConnectionNameMap,
} from "lib/utils/getCanonicalConnectionNameMap"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"
import type { LayerName } from "lib/utils/mapZToLayerName"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { resolvePreloadedTraceCanonicalNetIds } from "lib/utils/resolvePreloadedTraceCanonicalNetIds"

export type PcbViaTraceContribution = {
  pcb_trace_id: string
  outer_diameter: number
  hole_diameter: number
}

export type PcbViaWithContributingTraceIds = PcbVia & {
  contributing_pcb_trace_ids?: string[]
  contributing_pcb_trace_via_dimensions?: PcbViaTraceContribution[]
}

type ResolveMappedConnectionName = (
  connectionName: string,
  pcbTraceId: string,
) => string | undefined

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
        } else if (segment.route_type === "through_obstacle") {
          if (
            !isLayerName(segment.from_layer) ||
            !isLayerName(segment.to_layer)
          ) {
            return null
          }
          return {
            route_type: "through_pad" as const,
            start: segment.start,
            end: segment.end,
            width: segment.width,
            start_layer: segment.from_layer,
            end_layer: segment.to_layer,
          }
        } else {
          // Jumpers are represented by separate off-board components, not PCB copper.
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

/**
 * Create source_trace elements from the SimpleRouteJson connections
 * These represent the logical connections between points
 */
function createSourceTraces(
  srj: SimpleRouteJson,
  hdRoutes: SimplifiedPcbTrace[] | HighDensityRoute[],
  obstacleSrj: SimpleRouteJson = srj,
  originalSrj?: SimpleRouteJson,
  resolveMappedConnectionName: ResolveMappedConnectionName = () => undefined,
): AnyCircuitElement[] {
  const sourceTraces: AnyCircuitElement[] = []
  const sourceTraceById = new Map<string, AnyCircuitElement>()
  const endpointConnectivityByRouteName = new Map<string, Set<string>>()

  type RouteEndpoint = { x: number; y: number; layers: string[] }
  const getRouteEndpoint = (
    route: SimplifiedPcbTrace | HighDensityRoute,
    endpoint: "start" | "end",
  ): RouteEndpoint | undefined => {
    const segment = endpoint === "start" ? route.route[0] : route.route.at(-1)
    if (!segment) return undefined

    if ("route_type" in segment) {
      if (segment.route_type === "wire") {
        return { x: segment.x, y: segment.y, layers: [segment.layer] }
      }
      if (segment.route_type === "via") {
        return {
          x: segment.x,
          y: segment.y,
          layers: [segment.from_layer, segment.to_layer],
        }
      }
      const point = segment[endpoint]
      return {
        x: point.x,
        y: point.y,
        layers: [
          segment.route_type === "jumper"
            ? segment.layer
            : endpoint === "start"
              ? segment.from_layer
              : segment.to_layer,
        ],
      }
    }

    return {
      x: segment.x,
      y: segment.y,
      layers: [mapZToLayerName(segment.z, obstacleSrj.layerCount)],
    }
  }
  const endpointIsInsideObstacle = (
    endpoint: RouteEndpoint,
    obstacle: Obstacle,
  ): boolean => {
    if (!endpoint.layers.some((layer) => obstacle.layers.includes(layer))) {
      return false
    }

    const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const deltaX = endpoint.x - obstacle.center.x
    const deltaY = endpoint.y - obstacle.center.y
    const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
    const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
    return (
      Math.abs(localX) <= obstacle.width / 2 + 1e-9 &&
      Math.abs(localY) <= obstacle.height / 2 + 1e-9
    )
  }

  for (const [routeIndex, hdRoute] of hdRoutes.entries()) {
    const routeName =
      (hdRoute as SimplifiedPcbTrace).connection_name ??
      (hdRoute as HighDensityRoute).connectionName
    if (!routeName || hdRoute.route.length === 0) continue
    const pcbTraceId =
      "type" in hdRoute && hdRoute.type === "pcb_trace"
        ? hdRoute.pcb_trace_id
        : `trace_${routeIndex}`
    const canonicalRouteName =
      resolveMappedConnectionName(routeName, pcbTraceId) ?? routeName

    const endpoints = [
      getRouteEndpoint(hdRoute, "start"),
      getRouteEndpoint(hdRoute, "end"),
    ].filter((endpoint): endpoint is RouteEndpoint => endpoint !== undefined)
    const endpointConnectivity =
      endpointConnectivityByRouteName.get(canonicalRouteName) ??
      new Set<string>()

    for (const endpoint of endpoints) {
      for (const obstacle of obstacleSrj.obstacles) {
        if (endpointIsInsideObstacle(endpoint, obstacle)) {
          for (const connectivityId of obstacle.connectedTo) {
            endpointConnectivity.add(connectivityId)
          }
        }
      }
    }
    endpointConnectivityByRouteName.set(
      canonicalRouteName,
      endpointConnectivity,
    )
  }

  // Include original connections because point-pair conversion can omit nets
  // that are already represented by preloaded copper.
  const sourceConnections = [
    ...srj.connections,
    ...(originalSrj?.connections ?? []),
  ]

  // Process each connection to create a source_trace
  sourceConnections.forEach((connection) => {
    // Extract port IDs from the connection points
    const connectedPortIds = connection.pointsToConnect
      .filter((point) => point.pcb_port_id)
      .map((point) => point.pcb_port_id!)
      .filter(Boolean)

    // Look for original connection name (might be MST-suffixed by NetToPointPairsSolver)
    const netConnectionName =
      connection.__netConnectionName ||
      connection.__rootConnectionNames?.[0] ||
      connection.name
    const canonicalConnectionNames = new Set([
      netConnectionName,
      connection.__netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
    ])
    const connectedSourceNetIds = new Set<string>(
      [
        connection.__netConnectionName,
        ...(connection.__rootConnectionNames ?? []),
      ]
        .filter((name): name is string => Boolean(name))
        .filter((name) => name !== netConnectionName),
    )
    for (const connectionName of canonicalConnectionNames) {
      if (!connectionName) continue
      for (const connectivityId of endpointConnectivityByRouteName.get(
        connectionName,
      ) ?? []) {
        connectedSourceNetIds.add(connectivityId)
      }
    }

    // Check if this source_trace already exists
    const existingSourceTrace = sourceTraceById.get(netConnectionName)

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
          ...connectedSourceNetIds,
        ]),
      ]
    } else {
      // Create a new source_trace for this connection
      const sourceTrace = {
        type: "source_trace",
        source_trace_id: netConnectionName,
        connected_source_port_ids: connectedPortIds,
        connected_source_net_ids: [...connectedSourceNetIds],
      } as AnyCircuitElement
      sourceTraces.push(sourceTrace)
      sourceTraceById.set(netConnectionName, sourceTrace)
    }
  })

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

const getLayerNamesBetween = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): LayerName[] => {
  const zLayers = getUniqueValidZLayersFromLayerNames(
    [fromLayer, toLayer],
    layerCount,
  )
  if (zLayers.length === 0) return []
  const minimumZ = Math.min(...zLayers)
  const maximumZ = Math.max(...zLayers)
  return Array.from({ length: maximumZ - minimumZ + 1 }, (_, index) =>
    mapZToLayerName(minimumZ + index, layerCount),
  )
}

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

  for (const obstacle of srj.obstacles) {
    const connectedTo = obstacle.connectedTo
    const smtPadId: string | undefined = connectedTo.find((id) =>
      id.startsWith("pcb_smtpad_"),
    )
    const platedHoleId: string | undefined = connectedTo.find((id) =>
      id.startsWith("pcb_plated_hole_"),
    )
    const candidatePortIds = connectedTo.filter((id) =>
      id.startsWith("pcb_port_"),
    )
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

    const isMultiLayerObstacle = layers.length > 1

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
  resolveMappedConnectionName: ResolveMappedConnectionName = () => undefined,
  reservedCircuitElementIds: Set<string> = new Set(),
): PcbVia[] {
  const vias: PcbViaWithContributingTraceIds[] = []
  const viaIndexByLocation = new Map<string, number>()
  let nextViaId = 0
  const createPcbViaId = () => {
    let pcbViaId = `via_${nextViaId}`
    while (reservedCircuitElementIds.has(pcbViaId)) {
      nextViaId += 1
      pcbViaId = `via_${nextViaId}`
    }
    nextViaId += 1
    reservedCircuitElementIds.add(pcbViaId)
    return pcbViaId
  }
  const addOrMergeVia = (
    locationKey: string,
    via: Omit<PcbVia, "pcb_via_id">,
  ) => {
    const existingViaIndex = viaIndexByLocation.get(locationKey)
    if (existingViaIndex === undefined) {
      const pcbVia = {
        ...via,
        pcb_via_id: createPcbViaId(),
        ...(typeof via.pcb_trace_id === "string"
          ? {
              contributing_pcb_trace_via_dimensions: [
                {
                  pcb_trace_id: via.pcb_trace_id,
                  outer_diameter: via.outer_diameter,
                  hole_diameter: via.hole_diameter,
                },
              ],
            }
          : {}),
      } as PcbViaWithContributingTraceIds
      viaIndexByLocation.set(locationKey, vias.length)
      vias.push(pcbVia)
      return
    }

    const existingVia = vias[existingViaIndex]
    if (!existingVia) return
    if (typeof via.pcb_trace_id === "string") {
      const contributions =
        existingVia.contributing_pcb_trace_via_dimensions ?? []
      const existingContribution = contributions.find(
        (contribution) => contribution.pcb_trace_id === via.pcb_trace_id,
      )
      if (existingContribution) {
        existingContribution.outer_diameter = Math.max(
          existingContribution.outer_diameter,
          via.outer_diameter,
        )
        existingContribution.hole_diameter = Math.max(
          existingContribution.hole_diameter,
          via.hole_diameter,
        )
      } else {
        contributions.push({
          pcb_trace_id: via.pcb_trace_id,
          outer_diameter: via.outer_diameter,
          hole_diameter: via.hole_diameter,
        })
      }
      existingVia.contributing_pcb_trace_via_dimensions = contributions
    }
    existingVia.outer_diameter = Math.max(
      existingVia.outer_diameter,
      via.outer_diameter,
    )
    existingVia.hole_diameter = Math.max(
      existingVia.hole_diameter,
      via.hole_diameter,
    )
    if (typeof via.pcb_trace_id === "string") {
      const existingContributorTraceIds =
        existingVia.contributing_pcb_trace_ids ??
        (typeof existingVia.pcb_trace_id === "string"
          ? [existingVia.pcb_trace_id]
          : [])
      existingVia.contributing_pcb_trace_ids = [
        ...new Set([...existingContributorTraceIds, via.pcb_trace_id]),
      ]
    }
  }

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
            const routeNetId =
              resolveMappedConnectionName(
                trace.connection_name,
                trace.pcb_trace_id,
              ) ?? trace.connection_name
            const viaLayerKey = [segment.from_layer, segment.to_layer]
              .sort()
              .join(",")
            const locationKey = `${routeNetId},${segment.x},${segment.y},${viaLayerKey}`
            addOrMergeVia(locationKey, {
              type: "pcb_via",
              pcb_trace_id: trace.pcb_trace_id,
              x: segment.x,
              y: segment.y,
              outer_diameter: viaDiameter,
              hole_diameter: viaHoleDiameter,
              layers: getLayerNamesBetween(
                segment.from_layer,
                segment.to_layer,
                layerCount,
              ),
            })
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
            const routeNetId =
              resolveMappedConnectionName(route.connectionName, traceId) ??
              route.rootConnectionName ??
              route.connectionName ??
              traceId
            const viaLayerKey = [fromLayer, toLayer].sort().join(",")
            const locationKey = `${routeNetId},${currPoint.x},${currPoint.y},${viaLayerKey}`

            addOrMergeVia(locationKey, {
              type: "pcb_via",
              pcb_trace_id: traceId,
              x: currPoint.x,
              y: currPoint.y,
              outer_diameter: viaDiameter,
              hole_diameter: viaHoleDiameter,
              layers: getLayerNamesBetween(fromLayer, toLayer, layerCount),
            })
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
  preloadedTraceIds?: ReadonlySet<string>
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
    preloadedTraceIds = new Set<string>(),
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
  const circuitSrj = originalSrj ?? srjWithPointPairs
  const canonicalNameByOriginalAlias = getCanonicalConnectionNameMap(circuitSrj)
  const createConnectionMap = (
    connectionSrj: SimpleRouteJson,
    canonicalNameByAlias: ReadonlyMap<string, string>,
  ) => {
    const connectionMap = new Map<string, string>()
    connectionSrj.connections.forEach((conn) => {
      connectionMap.set(
        conn.name,
        getCanonicalConnectionName(conn, canonicalNameByAlias),
      )
    })
    return connectionMap
  }
  const originalConnectionMap = originalSrj
    ? createConnectionMap(originalSrj, canonicalNameByOriginalAlias)
    : new Map<string, string>()
  const pointPairConnectionMap = createConnectionMap(
    srjWithPointPairs,
    canonicalNameByOriginalAlias,
  )
  const inferredPreloadedConnectionByTraceId = new Map<string, string>()
  if (
    originalSrj &&
    routes.length > 0 &&
    "type" in routes[0] &&
    routes[0].type === "pcb_trace"
  ) {
    const preloadedTraces = (routes as SimplifiedPcbTrace[]).filter((trace) =>
      preloadedTraceIds.has(trace.pcb_trace_id),
    )
    for (const [traceId, canonicalName] of resolvePreloadedTraceCanonicalNetIds(
      {
        ...originalSrj,
        traces: preloadedTraces,
      },
    )) {
      inferredPreloadedConnectionByTraceId.set(traceId, canonicalName)
    }
  }
  const resolveMappedConnectionName = (
    connectionName: string,
    pcbTraceId: string,
  ): string | undefined =>
    preloadedTraceIds.has(pcbTraceId)
      ? (originalConnectionMap.get(connectionName) ??
        canonicalNameByOriginalAlias.get(
          inferredPreloadedConnectionByTraceId.get(pcbTraceId) ?? "",
        ) ??
        inferredPreloadedConnectionByTraceId.get(pcbTraceId))
      : (pointPairConnectionMap.get(connectionName) ??
        originalConnectionMap.get(connectionName) ??
        canonicalNameByOriginalAlias.get(connectionName))

  // Add source traces from connection information
  circuitJson.push(
    ...createSourceTraces(
      srjWithPointPairs,
      routes,
      circuitSrj,
      originalSrj,
      resolveMappedConnectionName,
    ),
  )

  // Add PCB ports for connection points
  circuitJson.push(...createPcbPorts(circuitSrj))

  // Add PCB pads / plated holes represented by SRJ obstacles
  circuitJson.push(...createPcbPadElements(circuitSrj))

  // Convert PCB traces before allocating via ids so generated ids can avoid
  // every id already present in the resulting Circuit JSON.
  const convertedPcbTraces: AnyCircuitElement[] = []
  if (routes.length > 0) {
    if ("type" in routes[0] && routes[0].type === "pcb_trace") {
      // Handle SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        const connectionName = trace.connection_name
        convertedPcbTraces.push(
          convertSimplifiedPcbTraceToCircuitJson(
            trace,
            resolveMappedConnectionName(connectionName, trace.pcb_trace_id) ??
              connectionName,
          ) as AnyCircuitElement,
        )
      })
    } else {
      // Handle HighDensityRoutes - may produce multiple traces per route if jumpers exist
      ;(routes as HighDensityRoute[]).forEach((route, index) => {
        const connectionName = route.connectionName
        const traces = convertHdRouteToCircuitJsonTraces(
          route,
          `trace_${index}`,
          resolveMappedConnectionName(connectionName, `trace_${index}`) ??
            connectionName,
          srjWithPointPairs.layerCount,
          minTraceWidth,
        )
        convertedPcbTraces.push(...(traces as AnyCircuitElement[]))
      })
    }
  }

  const reservedCircuitElementIds = new Set<string>()
  for (const element of [...circuitJson, ...convertedPcbTraces]) {
    for (const [propertyName, value] of Object.entries(element)) {
      if (propertyName.endsWith("_id") && typeof value === "string") {
        reservedCircuitElementIds.add(value)
      }
    }
  }

  // Extract and add vias as independent pcb_via elements.
  circuitJson.push(
    ...extractViasFromRoutes(
      routes,
      srjWithPointPairs.layerCount,
      resolvedMinViaDiameter,
      resolvedMinViaHoleDiameter,
      resolveMappedConnectionName,
      reservedCircuitElementIds,
    ),
  )
  circuitJson.push(...convertedPcbTraces)

  return circuitJson
}
