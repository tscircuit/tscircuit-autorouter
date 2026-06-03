import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getSourceTraceIdsForConnection } from "lib/utils/getSourceTraceIdsForConnection"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type RouteEndpoint = {
  x: number
  y: number
  layer: string
}

const ROUTE_ENDPOINT_MATCH_TOLERANCE = 1e-3

/**
 * Returns the exact original SRJ connections that can own a routed merged pair.
 *
 * @param source_trace_ids Candidate source trace ids carried by the merged pair
 * connection.
 * @param originalConnections The unsplit connections from the original SRJ.
 * Each candidate id is matched by exact `source_trace_id` or exact connection
 * `name`; no string parsing is used.
 * @returns Original candidate connections, in the same order as
 * `source_trace_ids`, with duplicates removed.
 *
 * @caution This only builds the candidate set. It does not choose ownership;
 * route geometry must still select the final singular `source_trace_id`.
 */
function getOriginalConnectionsForSourceTraceIds({
  source_trace_ids,
  originalConnections,
}: {
  source_trace_ids: string[]
  originalConnections: SimpleRouteConnection[]
}): SimpleRouteConnection[] {
  const originalConnectionBySourceTraceId = new Map<
    string,
    SimpleRouteConnection
  >()
  const originalConnectionByName = new Map<string, SimpleRouteConnection>()

  for (const originalConnection of originalConnections) {
    originalConnectionByName.set(originalConnection.name, originalConnection)
    for (const source_trace_id of getSourceTraceIdsForConnection({
      connection: originalConnection,
    })) {
      originalConnectionBySourceTraceId.set(source_trace_id, originalConnection)
    }
  }

  const originalCandidateConnections: SimpleRouteConnection[] = []
  const usedOriginalCandidateConnections = new Set<SimpleRouteConnection>()

  for (const source_trace_id of source_trace_ids) {
    const originalCandidateConnection =
      originalConnectionBySourceTraceId.get(source_trace_id) ??
      originalConnectionByName.get(source_trace_id)
    if (!originalCandidateConnection) continue
    if (usedOriginalCandidateConnections.has(originalCandidateConnection)) {
      continue
    }
    originalCandidateConnections.push(originalCandidateConnection)
    usedOriginalCandidateConnections.add(originalCandidateConnection)
  }

  return originalCandidateConnections
}

/**
 * Returns the routed pair endpoints in PCB layer coordinates.
 *
 * @param hdRoute The high-density route being serialized to SRJ output.
 * @param layerCount Board layer count used to map route z-levels to layer
 * names.
 * @returns The first and last route points with their mapped layer names, or an
 * empty array when the route has no points.
 */
function getRouteEndpointsFromHdRoute({
  hdRoute,
  layerCount,
}: {
  hdRoute: HighDensityRoute
  layerCount: number
}): RouteEndpoint[] {
  const firstRoutePoint = hdRoute.route[0]
  const lastRoutePoint = hdRoute.route[hdRoute.route.length - 1]
  if (!firstRoutePoint || !lastRoutePoint) return []

  return [firstRoutePoint, lastRoutePoint].map((routePoint) => ({
    x: routePoint.x,
    y: routePoint.y,
    layer: mapZToLayerName(routePoint.z, layerCount),
  }))
}

/**
 * Counts how many routed endpoints geometrically touch an original connection.
 *
 * @param routeEndpoints The routed pair's first and last points in layer
 * coordinates.
 * @param originalConnection Candidate original source-trace connection.
 * @returns A score from 0 to 2. Higher scores mean the routed pair endpoint
 * geometry better matches the candidate source trace's connection points.
 */
function getOriginalConnectionRouteEndpointScore({
  routeEndpoints,
  originalConnection,
}: {
  routeEndpoints: RouteEndpoint[]
  originalConnection: SimpleRouteConnection
}): number {
  let endpointMatchCount = 0

  for (const routeEndpoint of routeEndpoints) {
    const endpointMatchesConnection = originalConnection.pointsToConnect.some(
      (connectionPoint) => {
        const connectionPointLayers =
          "layer" in connectionPoint
            ? [connectionPoint.layer]
            : connectionPoint.layers
        if (!connectionPointLayers.includes(routeEndpoint.layer)) return false

        return (
          (connectionPoint.x - routeEndpoint.x) ** 2 +
            (connectionPoint.y - routeEndpoint.y) ** 2 <=
          ROUTE_ENDPOINT_MATCH_TOLERANCE ** 2
        )
      },
    )

    if (endpointMatchesConnection) endpointMatchCount += 1
  }

  return endpointMatchCount
}

/**
 * Computes how close routed endpoints are to a candidate source-trace segment.
 *
 * @param routeEndpoints The routed pair's first and last points in layer
 * coordinates.
 * @param originalConnection Candidate original source-trace connection.
 * @returns Sum of squared distances from each routed endpoint to the nearest
 * same-layer segment in the candidate connection. Returns `Infinity` when the
 * candidate has no comparable segment.
 */
function getOriginalConnectionRouteEndpointDistanceScore({
  routeEndpoints,
  originalConnection,
}: {
  routeEndpoints: RouteEndpoint[]
  originalConnection: SimpleRouteConnection
}): number {
  let totalDistanceScore = 0

  for (const routeEndpoint of routeEndpoints) {
    let bestEndpointDistanceScore = Infinity

    for (let i = 0; i < originalConnection.pointsToConnect.length - 1; i++) {
      const segmentStart = originalConnection.pointsToConnect[i]
      const segmentEnd = originalConnection.pointsToConnect[i + 1]
      if (!segmentStart || !segmentEnd) continue

      const segmentStartLayers =
        "layer" in segmentStart ? [segmentStart.layer] : segmentStart.layers
      const segmentEndLayers =
        "layer" in segmentEnd ? [segmentEnd.layer] : segmentEnd.layers
      if (
        !segmentStartLayers.includes(routeEndpoint.layer) ||
        !segmentEndLayers.includes(routeEndpoint.layer)
      ) {
        continue
      }

      const segmentDistanceScore = getPointToSegmentDistanceScore({
        point: routeEndpoint,
        segmentStart,
        segmentEnd,
      })
      if (segmentDistanceScore < bestEndpointDistanceScore) {
        bestEndpointDistanceScore = segmentDistanceScore
      }
    }

    if (bestEndpointDistanceScore === Infinity) return Infinity
    totalDistanceScore += bestEndpointDistanceScore
  }

  return totalDistanceScore
}

/**
 * Returns the squared distance from a point to a segment.
 *
 * @param point Point being compared.
 * @param segmentStart Segment start point.
 * @param segmentEnd Segment end point.
 * @returns Squared point-to-segment distance in board coordinates.
 */
function getPointToSegmentDistanceScore({
  point,
  segmentStart,
  segmentEnd,
}: {
  point: { x: number; y: number }
  segmentStart: { x: number; y: number }
  segmentEnd: { x: number; y: number }
}): number {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLengthScore = segmentDx ** 2 + segmentDy ** 2

  if (segmentLengthScore === 0) {
    return (point.x - segmentStart.x) ** 2 + (point.y - segmentStart.y) ** 2
  }

  const projection =
    ((point.x - segmentStart.x) * segmentDx +
      (point.y - segmentStart.y) * segmentDy) /
    segmentLengthScore
  const clampedProjection = Math.max(0, Math.min(1, projection))
  const projectedPoint = {
    x: segmentStart.x + clampedProjection * segmentDx,
    y: segmentStart.y + clampedProjection * segmentDy,
  }

  return (point.x - projectedPoint.x) ** 2 + (point.y - projectedPoint.y) ** 2
}

/**
 * Chooses the singular source trace id for a routed pair using geometry.
 *
 * @param connection The pair connection that produced the route.
 * @param hdRoute The routed geometry for that pair.
 * @param originalConnections The original SRJ connections before merge/MST
 * splitting.
 * @param layerCount Board layer count used to compare route endpoints on the
 * correct layer.
 * @returns The singular source trace id when geometry identifies one owner.
 * Returns `undefined` when there are no candidates or no geometric match.
 *
 * @caution This function intentionally refuses to infer ids from string
 * patterns. Candidate ids must come from explicit provenance fields, and final
 * ownership must come from endpoint geometry.
 */
export function getSourceTraceIdFromMergedRouteGeometry({
  connection,
  hdRoute,
  originalConnections,
  layerCount,
}: {
  connection: SimpleRouteConnection
  hdRoute: HighDensityRoute
  originalConnections: SimpleRouteConnection[]
  layerCount: number
}): string | undefined {
  const source_trace_ids = getSourceTraceIdsForConnection({ connection })
  if (source_trace_ids.length === 0) return undefined
  if (source_trace_ids.length === 1) return source_trace_ids[0]

  const originalCandidateConnections = getOriginalConnectionsForSourceTraceIds({
    source_trace_ids,
    originalConnections,
  })
  if (originalCandidateConnections.length === 0) return undefined

  const routeEndpoints = getRouteEndpointsFromHdRoute({ hdRoute, layerCount })
  let bestOriginalConnection: SimpleRouteConnection | undefined
  let bestEndpointMatchCount = 0
  let bestDistanceScore = Infinity

  for (const originalConnection of originalCandidateConnections) {
    const endpointMatchCount = getOriginalConnectionRouteEndpointScore({
      routeEndpoints,
      originalConnection,
    })
    const distanceScore = getOriginalConnectionRouteEndpointDistanceScore({
      routeEndpoints,
      originalConnection,
    })
    if (
      endpointMatchCount > bestEndpointMatchCount ||
      (endpointMatchCount === bestEndpointMatchCount &&
        distanceScore < bestDistanceScore)
    ) {
      bestOriginalConnection = originalConnection
      bestEndpointMatchCount = endpointMatchCount
      bestDistanceScore = distanceScore
    }
  }

  if (!bestOriginalConnection || bestEndpointMatchCount === 0) {
    return undefined
  }

  return (
    getSourceTraceIdsForConnection({ connection: bestOriginalConnection })[0] ??
    bestOriginalConnection.name
  )
}
