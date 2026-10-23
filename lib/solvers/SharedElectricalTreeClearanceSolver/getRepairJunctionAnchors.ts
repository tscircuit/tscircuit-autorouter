import type {
  HighDensityRoute,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "./nativeRepairTypes"
import {
  getSegmentBoundsInterval,
  isPointInBounds,
  REGION_EPSILON,
} from "./repairRegionGeometry"
import { normalizeRepairTrace } from "./normalizeRepairTrace"
import {
  getLocalObstacleDistance,
  getLocalObstacleGeometry,
} from "./obstacleDistanceGeometry"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"

type Point = { x: number; y: number }
type Anchor = Point & {
  z: number
  radius: number
  net: string
  source: string
  viaOwner?: number
}
type Segment = {
  start: Point
  end: Point
  z: number
  radius: number
  net: string
  source: string
  routeIndex?: number
  segmentIndex?: number
}
type Via = Point & {
  minZ: number
  maxZ: number
  radius: number
  net: string
  source: string
  routeIndex?: number
}
export type RepairJunctionAnchors = {
  segmentTimes: Map<number, number[]>
  viaPositions: Point[]
}

const getClosestSegmentContact = (
  first: Segment,
  second: Segment,
): [Point, Point] => {
  const ax = first.end.x - first.start.x
  const ay = first.end.y - first.start.y
  const bx = second.end.x - second.start.x
  const by = second.end.y - second.start.y
  const dx = second.start.x - first.start.x
  const dy = second.start.y - first.start.y
  const cross = ax * by - ay * bx
  const pointAt = (segment: Segment, t: number): Point => ({
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
  })
  const project = (point: Point, segment: Segment): Point => {
    const sx = segment.end.x - segment.start.x
    const sy = segment.end.y - segment.start.y
    const lengthSquared = sx * sx + sy * sy
    const t =
      lengthSquared > REGION_EPSILON * REGION_EPSILON
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - segment.start.x) * sx +
                (point.y - segment.start.y) * sy) /
                lengthSquared,
            ),
          )
        : 0
    return pointAt(segment, t)
  }
  if (Math.abs(cross) > REGION_EPSILON) {
    const t = (dx * by - dy * bx) / cross
    const u = (dx * ay - dy * ax) / cross
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const intersection = pointAt(first, t)
      return [intersection, intersection]
    }
  } else {
    const lengthSquared = ax * ax + ay * ay
    if (lengthSquared > REGION_EPSILON * REGION_EPSILON) {
      const firstT = (dx * ax + dy * ay) / lengthSquared
      const secondT =
        ((second.end.x - first.start.x) * ax +
          (second.end.y - first.start.y) * ay) /
        lengthSquared
      const low = Math.max(0, Math.min(firstT, secondT))
      const high = Math.min(1, Math.max(firstT, secondT))
      if (low <= high) {
        // Keep the center of a parallel overlap, including long preloads whose
        // actual endpoints both lie outside the extracted context.
        const point = pointAt(first, (low + high) / 2)
        return [point, project(point, second)]
      }
    }
  }
  const pairs: Array<[Point, Point]> = [
    [first.start, project(first.start, second)],
    [first.end, project(first.end, second)],
    [project(second.start, first), second.start],
    [project(second.end, first), second.end],
  ]
  pairs.sort(
    (left, right) =>
      Math.hypot(left[0].x - left[1].x, left[0].y - left[1].y) -
      Math.hypot(right[0].x - right[1].x, right[0].y - right[1].y),
  )
  return pairs[0]!
}

const addSegmentContactAnchors = (
  segments: Segment[],
  bounds: Bounds,
  results: RepairJunctionAnchors[],
  sharesImmutableEndpointComponent: (left: string, right: string) => boolean,
): void => {
  const cellSize = 2
  const cells = new Map<string, number[]>()
  const comparedPairs = new Set<string>()
  const locals: Array<{ original: Segment; clipped: Segment }> = []
  const lock = (segment: Segment, point: Point): void => {
    if (segment.routeIndex === undefined || segment.segmentIndex === undefined)
      return
    const dx = segment.end.x - segment.start.x
    const dy = segment.end.y - segment.start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= REGION_EPSILON * REGION_EPSILON) return
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) /
          lengthSquared,
      ),
    )
    const times =
      results[segment.routeIndex]!.segmentTimes.get(segment.segmentIndex) ?? []
    if (!times.some((existing) => Math.abs(existing - t) <= REGION_EPSILON))
      times.push(t)
    results[segment.routeIndex]!.segmentTimes.set(segment.segmentIndex, times)
  }
  for (const original of segments) {
    const interval = getSegmentBoundsInterval(
      original.start,
      original.end,
      bounds,
    )
    if (!interval || interval[1] - interval[0] <= REGION_EPSILON) continue
    const at = (t: number): Point => ({
      x: original.start.x + (original.end.x - original.start.x) * t,
      y: original.start.y + (original.end.y - original.start.y) * t,
    })
    const clipped = {
      ...original,
      start: at(interval[0]),
      end: at(interval[1]),
    }
    const index = locals.length
    locals.push({ original, clipped })
    const minX = Math.floor(
      (Math.min(clipped.start.x, clipped.end.x) - clipped.radius) / cellSize,
    )
    const maxX = Math.floor(
      (Math.max(clipped.start.x, clipped.end.x) + clipped.radius) / cellSize,
    )
    const minY = Math.floor(
      (Math.min(clipped.start.y, clipped.end.y) - clipped.radius) / cellSize,
    )
    const maxY = Math.floor(
      (Math.max(clipped.start.y, clipped.end.y) + clipped.radius) / cellSize,
    )
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = JSON.stringify([clipped.net, clipped.z, x, y])
        const occupants = cells.get(key) ?? []
        for (const otherIndex of occupants) {
          const other = locals[otherIndex]!
          if (
            other.original.source === original.source ||
            sharesImmutableEndpointComponent(
              other.original.source,
              original.source,
            ) ||
            (other.original.routeIndex === undefined &&
              original.routeIndex === undefined)
          )
            continue
          const pairKey = `${otherIndex}:${index}`
          if (comparedPairs.has(pairKey)) continue
          comparedPairs.add(pairKey)
          const [firstPoint, secondPoint] = getClosestSegmentContact(
            clipped,
            other.clipped,
          )
          if (
            Math.hypot(
              firstPoint.x - secondPoint.x,
              firstPoint.y - secondPoint.y,
            ) >
            clipped.radius + other.clipped.radius + REGION_EPSILON
          )
            continue
          lock(original, firstPoint)
          lock(other.original, secondPoint)
        }
        occupants.push(index)
        cells.set(key, occupants)
      }
    }
  }
}

const getCanonicalNets = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): ((name: string) => string) => {
  const parents = new Map<string, string>()
  const find = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined || parent === name) return name
    const root = find(parent)
    parents.set(name, root)
    return root
  }
  const union = (names: Array<string | undefined>): void => {
    const present = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (present.length === 0) return
    const root = find(present[0]!)
    for (const name of present) parents.set(find(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    union([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
    ])
  }
  for (const route of routes)
    union([route.connectionName, route.rootConnectionName])
  for (const trace of srj.traces ?? [])
    union([
      trace.connection_name,
      ...((trace as SimplifiedPcbTrace & { connectsTo?: string[] })
        .connectsTo ?? []),
    ])
  // Geometry and obstacle aliases deliberately do not join declared nets.
  return find
}

const layerZ = (layer: string, count: number): number => {
  const z =
    layer === "top"
      ? 0
      : layer === "bottom"
        ? count - 1
        : /^inner\d+$/.test(layer)
          ? Number(layer.slice(5))
          : -1
  if (!Number.isInteger(z) || z < 0 || z >= count)
    throw new Error(`repair04 preload has an unknown layer: ${layer}`)
  return z
}

/** Preserve real same-net endpoint/via attachments, including copper-edge contacts. */
export const getRepairJunctionAnchors = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  bounds: Bounds,
): RepairJunctionAnchors[] => {
  const canonicalNet = getCanonicalNets(srj, routes)
  const endpointComponents = routes.map((_, index) => index)
  const findEndpointComponent = (index: number): number => {
    const parent = endpointComponents[index]!
    if (parent === index) return index
    const root = findEndpointComponent(parent)
    endpointComponents[index] = root
    return root
  }
  const routeByImmutableEndpoint = new Map<string, number>()
  const padIndicesByPort = new Map<string, number[]>()
  for (let index = 0; index < srj.obstacles.length; index += 1) {
    for (const alias of srj.obstacles[index]!.connectedTo) {
      const indices = padIndicesByPort.get(alias) ?? []
      indices.push(index)
      padIndicesByPort.set(alias, indices)
    }
  }
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]!
    for (const point of [route.route[0], route.route.at(-1)]) {
      if (!point) continue
      const net = canonicalNet(route.connectionName)
      const keys = [JSON.stringify([net, "point", point.x, point.y, point.z])]
      // Different immutable terminal coordinates can already be connected
      // through one physical pad. Prove copper attachment before treating
      // additional intersections of their routes as redundant junctions.
      const padIndices = point.pcb_port_id
        ? (padIndicesByPort.get(point.pcb_port_id) ?? [])
        : []
      for (const obstacleIndex of padIndices) {
        const obstacle = srj.obstacles[obstacleIndex]!
        const zs =
          obstacle.zLayers ??
          obstacle.layers.map((layer): number => layerZ(layer, srj.layerCount))
        if (!zs.includes(point.z)) continue
        const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const dx = point.x - obstacle.center.x,
          dy = point.y - obstacle.center.y
        const local = {
          x: dx * Math.cos(radians) + dy * Math.sin(radians),
          y: -dx * Math.sin(radians) + dy * Math.cos(radians),
        }
        if (
          getLocalObstacleDistance(
            local,
            local,
            getLocalObstacleGeometry(obstacle),
          ) > REGION_EPSILON
        )
          continue
        keys.push(JSON.stringify([net, "pad", obstacleIndex]))
      }
      for (const key of keys) {
        const previousRouteIndex = routeByImmutableEndpoint.get(key)
        if (previousRouteIndex === undefined)
          routeByImmutableEndpoint.set(key, routeIndex)
        else
          endpointComponents[findEndpointComponent(routeIndex)] =
            findEndpointComponent(previousRouteIndex)
      }
    }
  }
  const sharesImmutableEndpointComponent = (
    left: string,
    right: string,
  ): boolean => {
    if (!left.startsWith("route:") || !right.startsWith("route:")) return false
    // Both original route endpoints are immutable, even outside this crop. Their
    // route paths stay contiguous, so incidental overlaps within this already
    // connected component need not be frozen as additional junctions.
    return (
      findEndpointComponent(Number(left.slice(6))) ===
      findEndpointComponent(Number(right.slice(6)))
    )
  }
  const anchors: Anchor[] = []
  const segments: Segment[] = []
  const vias: Via[] = []
  const results = routes.map(
    (): RepairJunctionAnchors => ({
      segmentTimes: new Map(),
      viaPositions: [],
    }),
  )
  const addVia = (via: Via): void => {
    if (!isPointInBounds(via, bounds)) return
    vias.push(via)
    for (let z = via.minZ; z <= via.maxZ; z += 1)
      anchors.push({
        x: via.x,
        y: via.y,
        z,
        radius: via.radius,
        net: via.net,
        source: via.source,
        ...(via.routeIndex !== undefined ? { viaOwner: via.routeIndex } : {}),
      })
  }
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]!
    const net = canonicalNet(route.connectionName)
    const source = `route:${routeIndex}`
    for (let pointIndex = 0; pointIndex < route.route.length; pointIndex += 1) {
      const point = route.route[pointIndex]! as RepairRoutePoint
      if (
        (pointIndex === 0 ||
          pointIndex === route.route.length - 1 ||
          point.pcb_port_id) &&
        isPointInBounds(point, bounds)
      ) {
        anchors.push({
          x: point.x,
          y: point.y,
          z: point.z,
          radius: (point.traceThickness ?? route.traceThickness) / 2,
          net,
          source,
        })
      }
      if (pointIndex === 0) continue
      const previous = route.route[pointIndex - 1]! as RepairRoutePoint
      if (previous.toNextSegmentType === "through_obstacle") continue
      if (previous.z === point.z) {
        segments.push({
          start: previous,
          end: point,
          z: point.z,
          radius:
            Math.max(
              previous.traceThickness ?? route.traceThickness,
              point.traceThickness ?? route.traceThickness,
            ) / 2,
          net,
          source,
          routeIndex,
          segmentIndex: pointIndex - 1,
        })
      } else {
        addVia({
          x: point.x,
          y: point.y,
          minZ: Math.min(previous.z, point.z),
          maxZ: Math.max(previous.z, point.z),
          radius: route.viaDiameter / 2,
          net,
          source,
          routeIndex,
        })
      }
    }
  }
  for (
    let traceIndex = 0;
    traceIndex < (srj.traces ?? []).length;
    traceIndex += 1
  ) {
    const trace = normalizeRepairTrace(
      srj.traces![traceIndex]!,
      srj.minTraceWidth,
    )
    const net = canonicalNet(trace.connection_name)
    const source = `fixed:${traceIndex}`
    for (let index = 0; index < trace.route.length; index += 1) {
      const token = trace.route[index]!
      const previous = trace.route[index - 1]
      if (token.route_type === "wire") {
        const z = layerZ(token.layer, srj.layerCount)
        if (
          (index === 0 ||
            index === trace.route.length - 1 ||
            token.start_pcb_port_id ||
            token.end_pcb_port_id) &&
          isPointInBounds(token, bounds)
        ) {
          anchors.push({
            x: token.x,
            y: token.y,
            z,
            radius: token.width / 2,
            net,
            source,
          })
        }
        if (previous?.route_type === "wire" && previous.layer === token.layer)
          segments.push({
            start: previous,
            end: token,
            z,
            radius: Math.max(previous.width, token.width) / 2,
            net,
            source,
          })
      } else if (token.route_type === "via") {
        const from = layerZ(token.from_layer, srj.layerCount)
        const to = layerZ(token.to_layer, srj.layerCount)
        addVia({
          x: token.x,
          y: token.y,
          minZ: Math.min(from, to),
          maxZ: Math.max(from, to),
          radius: (token.via_diameter ?? srj.minViaDiameter ?? 0.3) / 2,
          net,
          source,
        })
      }
    }
  }
  const byNetLayer = new Map<string, Anchor[]>()
  for (const anchor of anchors) {
    const key = JSON.stringify([anchor.net, anchor.z])
    const values = byNetLayer.get(key) ?? []
    values.push(anchor)
    byNetLayer.set(key, values)
  }
  const lockVia = (routeIndex: number | undefined, point: Point): void => {
    if (routeIndex === undefined) return
    const positions = results[routeIndex]!.viaPositions
    if (
      !positions.some(
        (existing) =>
          Math.hypot(existing.x - point.x, existing.y - point.y) <=
          REGION_EPSILON,
      )
    )
      positions.push({ x: point.x, y: point.y })
  }
  for (const segment of segments) {
    if (!getSegmentBoundsInterval(segment.start, segment.end, bounds)) continue
    const dx = segment.end.x - segment.start.x
    const dy = segment.end.y - segment.start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= REGION_EPSILON * REGION_EPSILON) continue
    for (const anchor of byNetLayer.get(
      JSON.stringify([segment.net, segment.z]),
    ) ?? []) {
      if (
        anchor.source === segment.source ||
        sharesImmutableEndpointComponent(anchor.source, segment.source)
      )
        continue
      const t = Math.max(
        0,
        Math.min(
          1,
          ((anchor.x - segment.start.x) * dx +
            (anchor.y - segment.start.y) * dy) /
            lengthSquared,
        ),
      )
      const point = { x: segment.start.x + dx * t, y: segment.start.y + dy * t }
      if (
        !isPointInBounds(point, bounds) ||
        Math.hypot(point.x - anchor.x, point.y - anchor.y) >
          segment.radius + anchor.radius + REGION_EPSILON
      )
        continue
      if (
        segment.routeIndex !== undefined &&
        segment.segmentIndex !== undefined
      ) {
        const times =
          results[segment.routeIndex]!.segmentTimes.get(segment.segmentIndex) ??
          []
        if (!times.some((existing) => Math.abs(existing - t) <= REGION_EPSILON))
          times.push(t)
        results[segment.routeIndex]!.segmentTimes.set(
          segment.segmentIndex,
          times,
        )
      }
      lockVia(anchor.viaOwner, anchor)
    }
  }
  for (const via of vias) {
    for (let z = via.minZ; z <= via.maxZ; z += 1) {
      for (const anchor of byNetLayer.get(JSON.stringify([via.net, z])) ?? []) {
        if (
          anchor.source === via.source ||
          sharesImmutableEndpointComponent(anchor.source, via.source) ||
          Math.hypot(via.x - anchor.x, via.y - anchor.y) >
            via.radius + anchor.radius + REGION_EPSILON
        )
          continue
        lockVia(via.routeIndex, via)
        lockVia(anchor.viaOwner, anchor)
      }
    }
  }
  addSegmentContactAnchors(
    segments,
    bounds,
    results,
    sharesImmutableEndpointComponent,
  )
  return results
}
