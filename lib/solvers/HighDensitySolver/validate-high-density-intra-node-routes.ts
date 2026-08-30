import {
  findRouteGeometryViolations,
  type RouteGeometryViolation,
} from "@tscircuit/high-density-a01"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export type ValidateHighDensityIntraNodeRoutesParams = {
  routes: HighDensityIntraNodeRoute[]
  nodeWithPortPoints: NodeWithPortPoints
  requirePairConnectivity?: boolean
  expectedTraceThickness?: number
  expectedViaDiameter?: number
}

const EPSILON = 1e-6
const UNAVOIDABLE_TERMINAL_DEPARTURE_TOLERANCE = 1e-3

const pointsHaveSamePosition = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON

const pointDistance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y)

type RoutePointWithPortPointId = HighDensityIntraNodeRoute["route"][number] & {
  portPointId?: string
}

const getTrustedTerminals = (
  connectionName: string,
  z: number,
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
): PortPoint[] => {
  const trustedTerminals: PortPoint[] = []
  for (const route of routes) {
    if (route.connectionName !== connectionName) continue
    const routeEndpoints = [route.route[0], route.route.at(-1)]
    for (const endpoint of routeEndpoints) {
      const portPointId = (endpoint as RoutePointWithPortPointId | undefined)
        ?.portPointId
      if (!endpoint || !portPointId || endpoint.z !== z) continue
      const inputTerminal = nodeWithPortPoints.portPoints.find(
        (portPoint) =>
          portPoint.portPointId === portPointId &&
          portPoint.connectionName === connectionName &&
          portPoint.z === z &&
          pointsHaveSamePosition(portPoint, endpoint),
      )
      if (inputTerminal) trustedTerminals.push(inputTerminal)
    }
  }
  return trustedTerminals
}

const getOtherSegmentEndpoint = (
  segment: [{ x: number; y: number }, { x: number; y: number }],
  terminal: { x: number; y: number },
): { x: number; y: number } | undefined => {
  if (pointsHaveSamePosition(segment[0], terminal)) return segment[1]
  if (pointsHaveSamePosition(segment[1], terminal)) return segment[0]
}

const isUnavoidableTerminalClearanceViolation = ({
  violation,
  routes,
  nodeWithPortPoints,
}: {
  violation: RouteGeometryViolation
  routes: HighDensityIntraNodeRoute[]
  nodeWithPortPoints: NodeWithPortPoints
}): boolean => {
  if (violation.type !== "trace_clearance" || violation.z === null) {
    return false
  }
  const terminals1 = getTrustedTerminals(
    violation.trace1,
    violation.z,
    routes,
    nodeWithPortPoints,
  )
  const terminals2 = getTrustedTerminals(
    violation.trace2,
    violation.z,
    routes,
    nodeWithPortPoints,
  )

  for (const terminal1 of terminals1) {
    for (const terminal2 of terminals2) {
      const terminalGap = pointDistance(terminal1, terminal2)
      if (terminalGap >= violation.requiredDistance - EPSILON) continue

      if (violation.point && violation.point2) {
        if (
          pointsHaveSamePosition(violation.point, terminal1) &&
          pointsHaveSamePosition(violation.point2, terminal2) &&
          Math.abs(violation.distance - terminalGap) <= EPSILON
        ) {
          return true
        }
        continue
      }
      if (!violation.seg1 || !violation.seg2) continue
      const innerPoint1 = getOtherSegmentEndpoint(
        violation.seg1,
        terminal1,
      )
      const innerPoint2 = getOtherSegmentEndpoint(
        violation.seg2,
        terminal2,
      )
      if (!innerPoint1 || !innerPoint2) continue
      const segmentGap = minimumDistanceBetweenSegments(
        violation.seg1[0],
        violation.seg1[1],
        violation.seg2[0],
        violation.seg2[1],
      )
      if (
        segmentGap >=
          terminalGap - UNAVOIDABLE_TERMINAL_DEPARTURE_TOLERANCE &&
        pointDistance(innerPoint1, innerPoint2) >=
          violation.requiredDistance - EPSILON
      ) {
        return true
      }
    }
  }
  return false
}

const pointKey = (point: { x: number; y: number; z: number }): string =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const getRootConnectionName = (value: {
  connectionName: string
  rootConnectionName?: string
}): string =>
  value.rootConnectionName ?? value.connectionName.replace(/_mst\d+$/, "")

export const getHighDensityIntraNodeRoutePairConnectivityError = (
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
): string | undefined => {
  const expectedPairs = nodeWithPortPoints.portPointsInPairs
  if (!expectedPairs) return

  const expectedConnectionNames = new Set(
    expectedPairs.map(([start]) => start.connectionName),
  )
  const adjacencyByConnection = new Map<
    string,
    Map<string, Set<string>>
  >()
  type GraphPoint = { x: number; y: number; z: number }
  const pointsByConnection = new Map<string, Map<string, GraphPoint>>()
  const segmentsByConnection = new Map<
    string,
    Array<[GraphPoint, GraphPoint]>
  >()
  for (const route of routes) {
    if (!expectedConnectionNames.has(route.connectionName)) {
      return `returned unexpected connection "${route.connectionName}"`
    }
    const adjacency =
      adjacencyByConnection.get(route.connectionName) ?? new Map()
    adjacencyByConnection.set(route.connectionName, adjacency)
    const points =
      pointsByConnection.get(route.connectionName) ??
      new Map<string, GraphPoint>()
    pointsByConnection.set(route.connectionName, points)
    const segments = segmentsByConnection.get(route.connectionName) ?? []
    segmentsByConnection.set(route.connectionName, segments)
    const registerPoint = (point: GraphPoint) => {
      points.set(pointKey(point), point)
    }
    const addEdge = (
      start: GraphPoint,
      end: GraphPoint,
    ) => {
      registerPoint(start)
      registerPoint(end)
      const startKey = pointKey(start)
      const endKey = pointKey(end)
      const startNeighbors = adjacency.get(startKey) ?? new Set<string>()
      const endNeighbors = adjacency.get(endKey) ?? new Set<string>()
      startNeighbors.add(endKey)
      endNeighbors.add(startKey)
      adjacency.set(startKey, startNeighbors)
      adjacency.set(endKey, endNeighbors)
    }
    for (let index = 0; index < route.route.length - 1; index++) {
      const start = route.route[index]!
      const end = route.route[index + 1]!
      addEdge(start, end)
      if (start.z === end.z) segments.push([start, end])
    }
    const jumperZ = route.route[0]?.z ?? 0
    for (const jumper of route.jumpers ?? []) {
      const start = { ...jumper.start, z: jumperZ }
      const end = { ...jumper.end, z: jumperZ }
      addEdge(start, end)
      segments.push([start, end])
    }
  }

  for (const [start, end] of expectedPairs) {
    const points =
      pointsByConnection.get(start.connectionName) ??
      new Map<string, GraphPoint>()
    points.set(pointKey(start), start)
    points.set(pointKey(end), end)
    pointsByConnection.set(start.connectionName, points)
  }

  const isPointOnSegment = (
    point: GraphPoint,
    start: GraphPoint,
    end: GraphPoint,
  ): boolean => {
    if (point.z !== start.z || start.z !== end.z) return false
    const dx = end.x - start.x
    const dy = end.y - start.y
    const px = point.x - start.x
    const py = point.y - start.y
    const cross = dx * py - dy * px
    const length = Math.hypot(dx, dy)
    if (Math.abs(cross) > EPSILON * Math.max(1, length)) return false
    const dot = px * dx + py * dy
    return dot >= -EPSILON && dot <= dx * dx + dy * dy + EPSILON
  }

  const getSegmentIntersection = (
    [start1, end1]: [GraphPoint, GraphPoint],
    [start2, end2]: [GraphPoint, GraphPoint],
  ): GraphPoint | undefined => {
    if (start1.z !== end1.z || start2.z !== end2.z) return
    if (start1.z !== start2.z) return
    const direction1 = {
      x: end1.x - start1.x,
      y: end1.y - start1.y,
    }
    const direction2 = {
      x: end2.x - start2.x,
      y: end2.y - start2.y,
    }
    const denominator =
      direction1.x * direction2.y - direction1.y * direction2.x
    if (Math.abs(denominator) <= EPSILON) return
    const offset = {
      x: start2.x - start1.x,
      y: start2.y - start1.y,
    }
    const position1 =
      (offset.x * direction2.y - offset.y * direction2.x) / denominator
    const position2 =
      (offset.x * direction1.y - offset.y * direction1.x) / denominator
    if (
      position1 < -EPSILON ||
      position1 > 1 + EPSILON ||
      position2 < -EPSILON ||
      position2 > 1 + EPSILON
    ) {
      return
    }
    return {
      x: start1.x + position1 * direction1.x,
      y: start1.y + position1 * direction1.y,
      z: start1.z,
    }
  }

  const splitSegmentsAtRegisteredPoints = (connectionName: string) => {
    const segments = segmentsByConnection.get(connectionName) ?? []
    const adjacency = adjacencyByConnection.get(connectionName)!
    const points = pointsByConnection.get(connectionName) ?? new Map()
    for (const [start, end] of segments) {
      const startKey = pointKey(start)
      const endKey = pointKey(end)
      for (const [candidateKey, candidate] of points) {
        if (
          candidateKey === startKey ||
          candidateKey === endKey ||
          !isPointOnSegment(candidate, start, end)
        ) {
          continue
        }
        const startNeighbors = adjacency.get(startKey) ?? new Set<string>()
        const endNeighbors = adjacency.get(endKey) ?? new Set<string>()
        const candidateNeighbors =
          adjacency.get(candidateKey) ?? new Set<string>()
        startNeighbors.add(candidateKey)
        endNeighbors.add(candidateKey)
        candidateNeighbors.add(startKey)
        candidateNeighbors.add(endKey)
        adjacency.set(startKey, startNeighbors)
        adjacency.set(endKey, endNeighbors)
        adjacency.set(candidateKey, candidateNeighbors)
      }
    }
  }

  for (const connectionName of segmentsByConnection.keys()) {
    // Registered endpoints cover T-junctions and collinear overlaps.
    splitSegmentsAtRegisteredPoints(connectionName)
  }

  const registerInteriorSegmentIntersections = (connectionName: string) => {
    const segments = segmentsByConnection.get(connectionName) ?? []
    const points = pointsByConnection.get(connectionName) ?? new Map()
    for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < segments.length;
        secondIndex++
      ) {
        const intersection = getSegmentIntersection(
          segments[firstIndex]!,
          segments[secondIndex]!,
        )
        if (intersection) points.set(pointKey(intersection), intersection)
      }
    }
    pointsByConnection.set(connectionName, points)
    splitSegmentsAtRegisteredPoints(connectionName)
  }

  const arePairPointsConnected = (
    connectionName: string,
    start: GraphPoint,
    end: GraphPoint,
  ): boolean => {
    const adjacency = adjacencyByConnection.get(connectionName)
    const targetKey = pointKey(end)
    const visited = new Set<string>([pointKey(start)])
    const pending = [...visited]
    while (pending.length > 0 && !visited.has(targetKey)) {
      const currentKey = pending.pop()!
      for (const neighborKey of adjacency?.get(currentKey) ?? []) {
        if (visited.has(neighborKey)) continue
        visited.add(neighborKey)
        pending.push(neighborKey)
      }
    }
    return visited.has(targetKey)
  }

  const connectionsWithRegisteredIntersections = new Set<string>()
  for (const [start, end] of expectedPairs) {
    if (arePairPointsConnected(start.connectionName, start, end)) continue
    if (!connectionsWithRegisteredIntersections.has(start.connectionName)) {
      // Interior/interior intersections are rare and quadratic to enumerate.
      // Defer them until endpoint and T-junction connectivity is insufficient.
      registerInteriorSegmentIntersections(start.connectionName)
      connectionsWithRegisteredIntersections.add(start.connectionName)
    }
    if (!arePairPointsConnected(start.connectionName, start, end)) {
      return `did not connect an expected pair for "${start.connectionName}"`
    }
  }

  const expectedTerminalKeysByConnection = new Map<string, Set<string>>()
  for (const [start, end] of expectedPairs) {
    const terminalKeys =
      expectedTerminalKeysByConnection.get(start.connectionName) ??
      new Set<string>()
    terminalKeys.add(pointKey(start))
    terminalKeys.add(pointKey(end))
    expectedTerminalKeysByConnection.set(start.connectionName, terminalKeys)
  }
  for (const [connectionName, adjacency] of adjacencyByConnection) {
    const expectedTerminalKeys =
      expectedTerminalKeysByConnection.get(connectionName) ?? new Set()
    const visited = new Set<string>()
    for (const componentStartKey of adjacency.keys()) {
      if (visited.has(componentStartKey)) continue
      let touchesExpectedTerminal = false
      const pending = [componentStartKey]
      while (pending.length > 0) {
        const currentKey = pending.pop()!
        if (visited.has(currentKey)) continue
        visited.add(currentKey)
        if (expectedTerminalKeys.has(currentKey)) {
          touchesExpectedTerminal = true
        }
        for (const neighborKey of adjacency.get(currentKey) ?? []) {
          if (!visited.has(neighborKey)) pending.push(neighborKey)
        }
      }
      if (!touchesExpectedTerminal) {
        return `returned a floating route component for "${connectionName}"`
      }
    }
  }
}

export const materializeHighDensityIntraNodeRouteVias = (
  route: HighDensityIntraNodeRoute,
): HighDensityIntraNodeRoute => {
  const materializedRoute: HighDensityIntraNodeRoute["route"] = []
  for (const point of route.route) {
    const previousPoint = materializedRoute.at(-1)
    if (
      !previousPoint ||
      previousPoint.z === point.z ||
      previousPoint.toNextSegmentType === "through_obstacle" ||
      pointsHaveSamePosition(previousPoint, point)
    ) {
      materializedRoute.push(point)
      continue
    }

    const hasViaAtPreviousPoint = route.vias.some((via) =>
      pointsHaveSamePosition(via, previousPoint),
    )
    if (hasViaAtPreviousPoint) {
      materializedRoute.push({
        x: previousPoint.x,
        y: previousPoint.y,
        z: point.z,
      })
    } else {
      materializedRoute.push({
        x: point.x,
        y: point.y,
        z: previousPoint.z,
      })
    }
    materializedRoute.push(point)
  }
  return { ...route, route: materializedRoute }
}

export const getHighDensityIntraNodeRouteValidationError = ({
  routes,
  nodeWithPortPoints,
  requirePairConnectivity = false,
  expectedTraceThickness,
  expectedViaDiameter,
}: ValidateHighDensityIntraNodeRoutesParams): string | undefined => {
  const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2
  const availableZ = new Set(
    nodeWithPortPoints.availableZ ??
      nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z),
  )

  for (const route of routes) {
    const inputPortPoint = nodeWithPortPoints.portPoints.find(
      (portPoint) => portPoint.connectionName === route.connectionName,
    )
    if (
      inputPortPoint &&
      getRootConnectionName(route) !==
        getRootConnectionName(inputPortPoint)
    ) {
      return `returned mismatched root metadata for "${route.connectionName}"`
    }
    if (
      !Number.isFinite(route.traceThickness) ||
      route.traceThickness <= 0 ||
      !Number.isFinite(route.viaDiameter) ||
      route.viaDiameter <= 0 ||
      route.route.length < 2
    ) {
      return `returned invalid route dimensions for "${route.connectionName}"`
    }
    if (
      expectedTraceThickness !== undefined &&
      Math.abs(route.traceThickness - expectedTraceThickness) > EPSILON
    ) {
      return `returned an unexpected trace thickness for "${route.connectionName}"`
    }
    if (
      expectedViaDiameter !== undefined &&
      Math.abs(route.viaDiameter - expectedViaDiameter) > EPSILON
    ) {
      return `returned an unexpected via diameter for "${route.connectionName}"`
    }
    for (const point of route.route) {
      if (point.traceThickness !== undefined) {
        return `returned an unsupported per-point trace thickness for "${route.connectionName}"`
      }
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) ||
        point.x < minX - EPSILON ||
        point.x > maxX + EPSILON ||
        point.y < minY - EPSILON ||
        point.y > maxY + EPSILON ||
        !availableZ.has(point.z)
      ) {
        return `returned an invalid or out-of-bounds route point for "${route.connectionName}"`
      }
    }

    const consumedViaIndexes = new Set<number>()
    const getUnconsumedViaIndexesAt = (point: { x: number; y: number }) =>
      route.vias.flatMap((via, viaIndex) =>
        !consumedViaIndexes.has(viaIndex) &&
        pointsHaveSamePosition(via, point)
          ? [viaIndex]
          : [],
      )
    for (let index = 0; index < route.route.length - 1; index++) {
      const start = route.route[index]!
      const end = route.route[index + 1]!
      if (start.z === end.z) continue
      if (start.toNextSegmentType === "through_obstacle") {
        // Downstream emits a through-obstacle primitive instead of a via for
        // this transition. Any listed via must remain unused and be rejected.
        continue
      }
      const viaIndexesAtStart = getUnconsumedViaIndexesAt(start)
      const viaIndexesAtEnd = getUnconsumedViaIndexesAt(end)
      if (pointsHaveSamePosition(start, end)) {
        const colocatedViaIndexes = Array.from(
          new Set([...viaIndexesAtStart, ...viaIndexesAtEnd]),
        )
        if (colocatedViaIndexes.length === 0) {
          return `returned a layer transition without a via for "${route.connectionName}"`
        }
        consumedViaIndexes.add(colocatedViaIndexes[0]!)
        continue
      }
      if (
        viaIndexesAtStart.length === 0 &&
        viaIndexesAtEnd.length === 0
      ) {
        return `returned a layer transition without a via for "${route.connectionName}"`
      }
      if (
        viaIndexesAtStart.length > 0 &&
        viaIndexesAtEnd.length > 0
      ) {
        return `returned an ambiguous diagonal layer transition for "${route.connectionName}"`
      }
      consumedViaIndexes.add(
        (viaIndexesAtStart[0] ?? viaIndexesAtEnd[0])!,
      )
    }

    const viaRadius = route.viaDiameter / 2
    for (const [viaIndex, via] of route.vias.entries()) {
      if (
        !Number.isFinite(via.x) ||
        !Number.isFinite(via.y) ||
        via.x - viaRadius < minX - EPSILON ||
        via.x + viaRadius > maxX + EPSILON ||
        via.y - viaRadius < minY - EPSILON ||
        via.y + viaRadius > maxY + EPSILON
      ) {
        return `returned an invalid or out-of-bounds via for "${route.connectionName}"`
      }
      if (!consumedViaIndexes.has(viaIndex)) {
        return `returned a via without a layer transition for "${route.connectionName}"`
      }
    }
  }

  if (requirePairConnectivity) {
    const connectivityError =
      getHighDensityIntraNodeRoutePairConnectivityError(
      routes,
      nodeWithPortPoints,
    )
    if (connectivityError) return connectivityError
  }

  // Pipeline9 materializes endpoint-via diagonal transitions before force
  // improvement. Validate that actual same-layer copper, not the raw cross-z
  // shorthand that the geometry checker intentionally skips.
  const materializedRoutes = routes.map(
    materializeHighDensityIntraNodeRouteVias,
  )
  const geometryViolations = findRouteGeometryViolations(
    materializedRoutes as any,
  ).filter(
    (violation) =>
      !isUnavoidableTerminalClearanceViolation({
        violation,
        routes: materializedRoutes,
        nodeWithPortPoints,
      }),
  )
  if (geometryViolations.length > 0) {
    return `returned ${geometryViolations.length} route geometry violations`
  }
}
