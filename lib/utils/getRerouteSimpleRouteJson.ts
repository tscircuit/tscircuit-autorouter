import { getBoundingBox } from "@tscircuit/math-utils"
import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

export type RerouteRectRegion = {
  shape: "rect"
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>
type ThroughObstacleRoutePoint = Extract<
  RoutePoint,
  { route_type: "through_obstacle" }
>
type LocatableRoutePoint = {
  route_type: RoutePoint["route_type"]
  x: number
  y: number
  layer?: string
  from_layer?: string
  to_layer?: string
  width?: number
}

type LocatedPoint = {
  x: number
  y: number
  layer: string
  width: number
}

type RerouteConnectionResult = {
  connection: SimpleRouteConnection
  endpointObstacles: Obstacle[]
}

const EPSILON = 1e-9

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const isViaRoutePoint = (point: RoutePoint): point is ViaRoutePoint =>
  point.route_type === "via"

const isThroughObstacleRoutePoint = (
  point: RoutePoint,
): point is ThroughObstacleRoutePoint => point.route_type === "through_obstacle"

const doObstacleLayersOverlap = (a: Obstacle, b: Obstacle) =>
  a.layers.some((layer) => b.layers.includes(layer))

const doesObstacleContainObstacle = (outer: Obstacle, inner: Obstacle) => {
  const outerBounds = getBoundingBox(outer)
  const innerBounds = getBoundingBox(inner)

  return (
    outerBounds.minX <= innerBounds.minX + EPSILON &&
    outerBounds.maxX >= innerBounds.maxX - EPSILON &&
    outerBounds.minY <= innerBounds.minY + EPSILON &&
    outerBounds.maxY >= innerBounds.maxY - EPSILON
  )
}

const isRedundantEndpointObstacle = (
  endpointObstacle: Obstacle,
  existingObstacles: Obstacle[],
  rootConnectionName: string,
) =>
  existingObstacles.some(
    (obstacle) =>
      obstacle.connectedTo.includes(rootConnectionName) &&
      doObstacleLayersOverlap(obstacle, endpointObstacle) &&
      doesObstacleContainObstacle(obstacle, endpointObstacle),
  )

const getRoutePointLocation = (
  point: RoutePoint,
): LocatableRoutePoint | null => {
  if (isWireRoutePoint(point) || isViaRoutePoint(point)) return point
  if (
    isThroughObstacleRoutePoint(point) &&
    Math.hypot(point.end.x - point.start.x, point.end.y - point.start.y) <=
      EPSILON
  ) {
    return {
      route_type: point.route_type,
      x: point.start.x,
      y: point.start.y,
      from_layer: point.from_layer,
      to_layer: point.to_layer,
      width: point.width,
    }
  }
  return null
}

const getSegmentLayer = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
) =>
  start.layer ??
  end.layer ??
  start.to_layer ??
  end.from_layer ??
  start.from_layer ??
  end.to_layer ??
  "top"

const getSegmentWidth = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  fallbackWidth: number,
) => {
  return start.width ?? end.width ?? fallbackWidth
}

const getInterpolatedPoint = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  t: number,
  layer: string,
  width: number,
): LocatedPoint => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
  layer,
  width,
})

const snapPointToRegionBounds = (
  point: LocatedPoint,
  region: RerouteRectRegion,
): LocatedPoint => ({
  ...point,
  x:
    Math.abs(point.x - region.minX) < 1e-6
      ? region.minX
      : Math.abs(point.x - region.maxX) < 1e-6
        ? region.maxX
        : point.x,
  y:
    Math.abs(point.y - region.minY) < 1e-6
      ? region.minY
      : Math.abs(point.y - region.maxY) < 1e-6
        ? region.maxY
        : point.y,
})

const locatedPointToConnectionPoint = ({
  x,
  y,
  layer,
}: LocatedPoint): ConnectionPoint => ({
  x,
  y,
  layer,
})

const locatedPointToWireRoutePoint = ({
  x,
  y,
  layer,
  width,
}: LocatedPoint): WireRoutePoint => ({
  route_type: "wire",
  x,
  y,
  layer,
  width,
})

const getRectInsideInterval = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  region: RerouteRectRegion,
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let t0 = 0
  let t1 = 1

  const clip = (p: number, q: number) => {
    if (Math.abs(p) < EPSILON) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }

  if (!clip(-dx, start.x - region.minX)) return null
  if (!clip(dx, region.maxX - start.x)) return null
  if (!clip(-dy, start.y - region.minY)) return null
  if (!clip(dy, region.maxY - start.y)) return null

  return { startT: t0, endT: t1 }
}

const distance = (a: LocatedPoint, b: LocatedPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const isPointOnRegionBoundary = (
  point: LocatedPoint | ConnectionPoint,
  region: RerouteRectRegion,
) =>
  point.x >= region.minX - 1e-6 &&
  point.x <= region.maxX + 1e-6 &&
  point.y >= region.minY - 1e-6 &&
  point.y <= region.maxY + 1e-6 &&
  (Math.abs(point.x - region.minX) <= 1e-6 ||
    Math.abs(point.x - region.maxX) <= 1e-6 ||
    Math.abs(point.y - region.minY) <= 1e-6 ||
    Math.abs(point.y - region.maxY) <= 1e-6)

const appendClippedTraceSegment = (
  traces: SimplifiedPcbTrace[],
  trace: SimplifiedPcbTrace,
  segmentIndex: number,
  start: LocatedPoint,
  end: LocatedPoint,
) => {
  if (distance(start, end) <= EPSILON) return

  traces.push({
    type: "pcb_trace",
    pcb_trace_id: `${trace.pcb_trace_id}_keep_${segmentIndex}`,
    connection_name: trace.connection_name,
    route: [
      locatedPointToWireRoutePoint(start),
      locatedPointToWireRoutePoint(end),
    ],
  })
}

const createClippedTraceSegmentObstacle = ({
  obstacleId,
  start,
  end,
  layer,
  width,
}: {
  obstacleId: string
  start: LocatedPoint
  end: LocatedPoint
  layer: string
  width: number
}): Obstacle | null => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length > width + EPSILON) return null

  return {
    obstacleId,
    type: "rect",
    layers: [layer],
    center: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    width: length,
    height: width,
    ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
    connectedTo: [],
  }
}

const createRerouteConnection = ({
  trace,
  ripIndex,
  start,
  end,
}: {
  trace: SimplifiedPcbTrace
  ripIndex: number
  start: LocatedPoint
  end: LocatedPoint
}): SimpleRouteConnection => ({
  name: `${trace.connection_name}_reroute_${trace.pcb_trace_id}_${ripIndex}`,
  rootConnectionName: trace.connection_name,
  pointsToConnect: [
    locatedPointToConnectionPoint(start),
    locatedPointToConnectionPoint(end),
  ],
})

const createRerouteEndpointObstacle = ({
  connection,
  point,
  endpointIndex,
}: {
  connection: SimpleRouteConnection
  point: LocatedPoint
  endpointIndex: number
}): Obstacle => ({
  obstacleId: `${connection.name}_route_endpoint_${endpointIndex}`,
  type: "rect",
  layers: [point.layer],
  center: { x: point.x, y: point.y },
  width: point.width,
  height: point.width,
  connectedTo: [
    connection.name,
    connection.rootConnectionName ?? connection.name,
  ],
})

const expandRegionToContainObstacles = (
  region: RerouteRectRegion,
  obstacles: Obstacle[],
): SimpleRouteJson["bounds"] => {
  const bounds: SimpleRouteJson["bounds"] = {
    minX: region.minX,
    maxX: region.maxX,
    minY: region.minY,
    maxY: region.maxY,
  }

  for (const obstacle of obstacles) {
    const obstacleBounds = getBoundingBox(obstacle)
    bounds.minX = Math.min(bounds.minX, obstacleBounds.minX)
    bounds.maxX = Math.max(bounds.maxX, obstacleBounds.maxX)
    bounds.minY = Math.min(bounds.minY, obstacleBounds.minY)
    bounds.maxY = Math.max(bounds.maxY, obstacleBounds.maxY)
  }

  return bounds
}

const maybeCreateRerouteConnection = ({
  trace,
  ripIndex,
  start,
  end,
  region,
  existingObstacles,
  allowInteriorStart,
  allowInteriorEnd,
}: {
  trace: SimplifiedPcbTrace
  ripIndex: number
  start: LocatedPoint
  end: LocatedPoint
  region: RerouteRectRegion
  existingObstacles: Obstacle[]
  allowInteriorStart?: boolean
  allowInteriorEnd?: boolean
}): RerouteConnectionResult | null => {
  if (
    !(allowInteriorStart || isPointOnRegionBoundary(start, region)) ||
    !(allowInteriorEnd || isPointOnRegionBoundary(end, region))
  ) {
    return null
  }

  const connection = createRerouteConnection({ trace, ripIndex, start, end })
  const rootConnectionName = connection.rootConnectionName ?? connection.name
  const endpointObstacles: Obstacle[] = [
    createRerouteEndpointObstacle({
      connection,
      point: start,
      endpointIndex: 0,
    }),
    createRerouteEndpointObstacle({
      connection,
      point: end,
      endpointIndex: 1,
    }),
  ].filter(
    (endpointObstacle) =>
      !isRedundantEndpointObstacle(
        endpointObstacle,
        existingObstacles,
        rootConnectionName,
      ),
  )

  return { connection, endpointObstacles }
}

const getClippedTracePieces = (
  trace: SimplifiedPcbTrace,
  region: RerouteRectRegion,
  fallbackWidth: number,
  existingObstacles: Obstacle[],
) => {
  const keptTraces: SimplifiedPcbTrace[] = []
  const rerouteConnections: SimpleRouteConnection[] = []
  const rerouteEndpointObstacles: Obstacle[] = []
  const clippedTraceSegmentObstacles: Obstacle[] = []
  let activeRipStart: LocatedPoint | null = null
  let activeRipStartAllowsInterior = false
  let keptSegmentIndex = 0
  let hadIntersection = false

  for (let i = 0; i < trace.route.length - 1; i++) {
    const start = getRoutePointLocation(trace.route[i]!)
    const end = getRoutePointLocation(trace.route[i + 1]!)

    if (!start || !end) {
      return null
    }

    const layer = getSegmentLayer(start, end)
    const width = getSegmentWidth(start, end, fallbackWidth)
    const interval = getRectInsideInterval(start, end, region)
    const segmentStart = getInterpolatedPoint(start, end, 0, layer, width)
    const segmentEnd = getInterpolatedPoint(start, end, 1, layer, width)
    const isFirstTraceSegment = i === 0

    if (!interval) {
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        segmentStart,
        segmentEnd,
      )
      continue
    }
    hadIntersection = true

    if (interval.startT > EPSILON) {
      const keptEnd = getInterpolatedPoint(
        start,
        end,
        interval.startT,
        layer,
        width,
      )
      const clippedTraceSegmentObstacle = createClippedTraceSegmentObstacle({
        obstacleId: `${trace.pcb_trace_id}_keep_${keptSegmentIndex}_bounds`,
        start: segmentStart,
        end: keptEnd,
        layer,
        width,
      })
      if (clippedTraceSegmentObstacle) {
        clippedTraceSegmentObstacles.push(clippedTraceSegmentObstacle)
      }
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        segmentStart,
        keptEnd,
      )
    }

    const rippedEnd = getInterpolatedPoint(
      start,
      end,
      interval.endT,
      layer,
      width,
    )
    const rerouteStart = snapPointToRegionBounds(
      getInterpolatedPoint(start, end, interval.startT, layer, width),
      region,
    )
    const rerouteEnd = snapPointToRegionBounds(
      getInterpolatedPoint(start, end, interval.endT, layer, width),
      region,
    )

    if (!activeRipStart) {
      activeRipStart = rerouteStart
      activeRipStartAllowsInterior =
        isFirstTraceSegment && interval.startT <= EPSILON
    }

    if (interval.endT < 1 - EPSILON) {
      const rerouteConnection = maybeCreateRerouteConnection({
        trace,
        ripIndex: rerouteConnections.length,
        start: activeRipStart,
        end: rerouteEnd,
        region,
        existingObstacles,
        allowInteriorStart: activeRipStartAllowsInterior,
      })
      if (rerouteConnection) {
        rerouteConnections.push(rerouteConnection.connection)
        rerouteEndpointObstacles.push(...rerouteConnection.endpointObstacles)
      }
      activeRipStart = null
      activeRipStartAllowsInterior = false
      const clippedTraceSegmentObstacle = createClippedTraceSegmentObstacle({
        obstacleId: `${trace.pcb_trace_id}_keep_${keptSegmentIndex}_bounds`,
        start: rippedEnd,
        end: segmentEnd,
        layer,
        width,
      })
      if (clippedTraceSegmentObstacle) {
        clippedTraceSegmentObstacles.push(clippedTraceSegmentObstacle)
      }
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        rippedEnd,
        segmentEnd,
      )
    }
  }

  if (activeRipStart) {
    const finalPoint = trace.route
      .slice()
      .reverse()
      .map(getRoutePointLocation)
      .find((point): point is LocatableRoutePoint => Boolean(point))

    if (finalPoint) {
      const rerouteConnection = maybeCreateRerouteConnection({
        trace,
        ripIndex: rerouteConnections.length,
        start: activeRipStart,
        end: {
          x: finalPoint.x,
          y: finalPoint.y,
          layer:
            finalPoint.layer ?? finalPoint.from_layer ?? activeRipStart.layer,
          width: activeRipStart.width,
        },
        region,
        existingObstacles,
        allowInteriorStart: activeRipStartAllowsInterior,
        allowInteriorEnd: true,
      })
      if (rerouteConnection) {
        rerouteConnections.push(rerouteConnection.connection)
        rerouteEndpointObstacles.push(...rerouteConnection.endpointObstacles)
      }
    }
  }

  return {
    keptTraces,
    rerouteConnections,
    rerouteEndpointObstacles,
    clippedTraceSegmentObstacles,
    hadIntersection,
  }
}

export const getRerouteSimpleRouteJson = (
  simpleRouteJson: SimpleRouteJson,
  region: RerouteRectRegion,
): SimpleRouteJson => {
  const nextSrj = structuredClone(simpleRouteJson)
  const nextTraces: SimplifiedPcbTrace[] = []
  const rerouteConnections: SimpleRouteConnection[] = []
  const rerouteEndpointObstacles: Obstacle[] = []
  const clippedTraceSegmentObstacles: Obstacle[] = []

  for (const trace of simpleRouteJson.traces ?? []) {
    const clippedPieces = getClippedTracePieces(
      trace,
      region,
      simpleRouteJson.minTraceWidth,
      simpleRouteJson.obstacles,
    )

    if (!clippedPieces) {
      nextTraces.push(structuredClone(trace))
      continue
    }

    if (!clippedPieces.hadIntersection) {
      nextTraces.push(structuredClone(trace))
      continue
    }

    nextTraces.push(...clippedPieces.keptTraces)
    rerouteConnections.push(...clippedPieces.rerouteConnections)
    rerouteEndpointObstacles.push(...clippedPieces.rerouteEndpointObstacles)
    clippedTraceSegmentObstacles.push(
      ...clippedPieces.clippedTraceSegmentObstacles,
    )
  }

  const bounds = expandRegionToContainObstacles(region, [
    ...rerouteEndpointObstacles,
    ...clippedTraceSegmentObstacles,
  ])

  return {
    ...nextSrj,
    bounds,
    obstacles: [...nextSrj.obstacles, ...rerouteEndpointObstacles],
    traces: nextTraces,
    connections: rerouteConnections,
  }
}

export const reconnectReroutedSimpleRouteJsonRegion = (
  originalSrj: SimpleRouteJson,
  reroutedSrj: SimpleRouteJson,
): SimpleRouteJson => {
  const rerouteConnectionToRoot = new Map(
    reroutedSrj.connections.map((connection) => [
      connection.name,
      connection.rootConnectionName ?? connection.name,
    ]),
  )

  const traces = (reroutedSrj.traces ?? []).map((trace) => {
    const rootConnectionName = rerouteConnectionToRoot.get(
      trace.connection_name,
    )
    if (!rootConnectionName) return structuredClone(trace)

    return {
      ...structuredClone(trace),
      connection_name: rootConnectionName,
    }
  })

  return {
    ...structuredClone(originalSrj),
    traces,
    jumpers: reroutedSrj.jumpers
      ? structuredClone(reroutedSrj.jumpers)
      : structuredClone(originalSrj.jumpers),
  }
}
