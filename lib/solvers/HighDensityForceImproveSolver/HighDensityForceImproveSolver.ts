import {
  HighDensityForceImproveSolver as BaseHighDensityForceImproveSolver,
  type ForceVector,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { runDrcCheck } from "high-density-repair01/lib/drc-check"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type Point = { x: number; y: number }
type MutableRoute = HighDensityRoute & {
  route: Array<HighDensityRoute["route"][number]>
  vias: Array<HighDensityRoute["vias"][number]>
}

type ViaNode = {
  routeIndex: number
  rootConnectionName: string
  pointIndexes: number[]
  x: number
  y: number
  radius: number
  movable: boolean
}

type Segment = {
  routeIndex: number
  rootConnectionName: string
  startIndex: number
  endIndex: number
  start: Point
  end: Point
  z: number
  traceRadius: number
}

const POSITION_EPSILON = 1e-6
const COORDINATE_MATCH_EPSILON = 1e-3
const RELAXED_VIA_CLEARANCE = 0.1
const RELAXED_TRACE_CLEARANCE = 0.1
const CLEARANCE_SLACK = 0.015
const VIA_PROJECTION_PASSES = 10
const MAX_VIA_MOVE_PER_PASS = 0.04
const MAX_TRACE_MOVE_PER_PASS = 0.025

const cloneRoutes = (routes: HighDensityRoute[]): MutableRoute[] =>
  routes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point })),
    vias: route.vias.map((via) => ({ ...via })),
  }))

const getRootConnectionName = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

const areSameXY = (left: Point, right: Point) =>
  Math.abs(left.x - right.x) <= COORDINATE_MATCH_EPSILON &&
  Math.abs(left.y - right.y) <= COORDINATE_MATCH_EPSILON

const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(value, maxValue))

const getNodeBounds = (node: NodeWithPortPoints, padding: number) => ({
  minX: node.center.x - node.width / 2 + padding,
  maxX: node.center.x + node.width / 2 - padding,
  minY: node.center.y - node.height / 2 + padding,
  maxY: node.center.y + node.height / 2 - padding,
})

const clampViaToNode = (via: ViaNode, node: NodeWithPortPoints) => {
  const bounds = getNodeBounds(node, via.radius + POSITION_EPSILON)
  via.x = clampValue(via.x, bounds.minX, bounds.maxX)
  via.y = clampValue(via.y, bounds.minY, bounds.maxY)
}

const collectViaNodes = (routes: MutableRoute[]): ViaNode[] => {
  const viaNodes: ViaNode[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue
    const seenPointIndexes = new Set<number>()

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const current = route.route[index]
      const next = route.route[index + 1]
      if (!current || !next) continue
      if (current.z === next.z || !areSameXY(current, next)) continue

      const pointIndexes = [index, index + 1]
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }
      for (let cursor = index + 2; cursor < route.route.length; cursor += 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }

      const uniquePointIndexes = [...new Set(pointIndexes)].sort(
        (a, b) => a - b,
      )
      const viaKey = uniquePointIndexes.join(",")
      if (
        [...seenPointIndexes].some((seen) => uniquePointIndexes.includes(seen))
      ) {
        continue
      }
      for (const pointIndex of uniquePointIndexes) {
        seenPointIndexes.add(pointIndex)
      }

      viaNodes.push({
        routeIndex,
        rootConnectionName: getRootConnectionName(route),
        pointIndexes: uniquePointIndexes,
        x: current.x,
        y: current.y,
        radius: (route.viaDiameter ?? 0.3) / 2,
        movable:
          !uniquePointIndexes.includes(0) &&
          !uniquePointIndexes.includes(route.route.length - 1) &&
          viaKey.length > 0,
      })
    }
  }

  return viaNodes
}

const collectSegments = (routes: MutableRoute[]): Segment[] => {
  const segments: Segment[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end) continue
      if (start.z !== end.z || areSameXY(start, end)) continue

      segments.push({
        routeIndex,
        rootConnectionName: getRootConnectionName(route),
        startIndex: index,
        endIndex: index + 1,
        start,
        end,
        z: start.z,
        traceRadius: (route.traceThickness ?? 0.1) / 2,
      })
    }
  }

  return segments
}

const pointToSegmentProjection = (point: Point, segment: Segment) => {
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY

  if (lengthSquared <= POSITION_EPSILON) {
    return {
      x: segment.start.x,
      y: segment.start.y,
      t: 0,
    }
  }

  const rawT =
    ((point.x - segment.start.x) * segmentX +
      (point.y - segment.start.y) * segmentY) /
    lengthSquared
  const t = clampValue(rawT, 0, 1)

  return {
    x: segment.start.x + segmentX * t,
    y: segment.start.y + segmentY * t,
    t,
  }
}

const applyViaMove = (
  routes: MutableRoute[],
  via: ViaNode,
  dx: number,
  dy: number,
  node: NodeWithPortPoints,
) => {
  if (!via.movable) return false

  via.x += dx
  via.y += dy
  clampViaToNode(via, node)

  const route = routes[via.routeIndex]
  if (!route) return false
  for (const pointIndex of via.pointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x = via.x
    point.y = via.y
  }

  return true
}

const projectViaViaClearance = (
  routes: MutableRoute[],
  node: NodeWithPortPoints,
  vias: ViaNode[],
) => {
  let changed = false

  for (let leftIndex = 0; leftIndex < vias.length; leftIndex += 1) {
    const left = vias[leftIndex]
    if (!left) continue

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < vias.length;
      rightIndex += 1
    ) {
      const right = vias[rightIndex]
      if (!right) {
        continue
      }

      const requiredDistance =
        left.radius + right.radius + RELAXED_VIA_CLEARANCE + CLEARANCE_SLACK
      const separationX = left.x - right.x
      const separationY = left.y - right.y
      const distance = Math.hypot(separationX, separationY)
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue

      const fallbackAngle =
        (leftIndex * 97 + rightIndex * 13) * 1.618_033_988_75
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : Math.cos(fallbackAngle)
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : Math.sin(fallbackAngle)
      const movableCount = Number(left.movable) + Number(right.movable)
      if (movableCount === 0) continue

      const move = Math.min(MAX_VIA_MOVE_PER_PASS, penetration / movableCount)
      changed =
        applyViaMove(
          routes,
          left,
          directionX * move,
          directionY * move,
          node,
        ) || changed
      changed =
        applyViaMove(
          routes,
          right,
          -directionX * move,
          -directionY * move,
          node,
        ) || changed
    }
  }

  return changed
}

const projectViaSegmentClearance = (
  routes: MutableRoute[],
  node: NodeWithPortPoints,
  vias: ViaNode[],
  segments: Segment[],
) => {
  let changed = false

  for (let viaIndex = 0; viaIndex < vias.length; viaIndex += 1) {
    const via = vias[viaIndex]
    if (!via?.movable) continue

    for (const segment of segments) {
      if (via.rootConnectionName === segment.rootConnectionName) continue

      const projection = pointToSegmentProjection(via, segment)
      const separationX = via.x - projection.x
      const separationY = via.y - projection.y
      const distance = Math.hypot(separationX, separationY)
      const requiredDistance =
        via.radius +
        segment.traceRadius +
        RELAXED_TRACE_CLEARANCE +
        CLEARANCE_SLACK
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue

      const segmentX = segment.end.x - segment.start.x
      const segmentY = segment.end.y - segment.start.y
      const normalMagnitude = Math.hypot(segmentX, segmentY)
      const fallbackSign = viaIndex % 2 === 0 ? 1 : -1
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : normalMagnitude > POSITION_EPSILON
            ? (-segmentY / normalMagnitude) * fallbackSign
            : 1
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : normalMagnitude > POSITION_EPSILON
            ? (segmentX / normalMagnitude) * fallbackSign
            : 0
      const move = Math.min(MAX_VIA_MOVE_PER_PASS, penetration)

      changed =
        applyViaMove(routes, via, directionX * move, directionY * move, node) ||
        changed
    }
  }

  return changed
}

const getSegmentDistanceCandidates = (left: Segment, right: Segment) => {
  const leftStartProjection = pointToSegmentProjection(left.start, right)
  const leftEndProjection = pointToSegmentProjection(left.end, right)
  const rightStartProjection = pointToSegmentProjection(right.start, left)
  const rightEndProjection = pointToSegmentProjection(right.end, left)

  return [
    {
      leftT: 0,
      rightT: leftStartProjection.t,
      leftPoint: left.start,
      rightPoint: leftStartProjection,
    },
    {
      leftT: 1,
      rightT: leftEndProjection.t,
      leftPoint: left.end,
      rightPoint: leftEndProjection,
    },
    {
      leftT: rightStartProjection.t,
      rightT: 0,
      leftPoint: rightStartProjection,
      rightPoint: right.start,
    },
    {
      leftT: rightEndProjection.t,
      rightT: 1,
      leftPoint: rightEndProjection,
      rightPoint: right.end,
    },
  ].sort((a, b) => {
    const aDistance = Math.hypot(
      a.leftPoint.x - a.rightPoint.x,
      a.leftPoint.y - a.rightPoint.y,
    )
    const bDistance = Math.hypot(
      b.leftPoint.x - b.rightPoint.x,
      b.leftPoint.y - b.rightPoint.y,
    )
    return aDistance - bDistance
  })
}

const getCoincidentPointIndexes = (route: MutableRoute, pointIndex: number) => {
  const point = route.route[pointIndex]
  if (!point) return []

  const pointIndexes = [pointIndex]
  for (let cursor = pointIndex - 1; cursor >= 0; cursor -= 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }
  for (let cursor = pointIndex + 1; cursor < route.route.length; cursor += 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }

  return [...new Set(pointIndexes)]
}

const applyRoutePointMove = (
  routes: MutableRoute[],
  routeIndex: number,
  pointIndex: number,
  dx: number,
  dy: number,
  node: NodeWithPortPoints,
) => {
  const route = routes[routeIndex]
  if (!route || pointIndex <= 0 || pointIndex >= route.route.length - 1) {
    return false
  }

  const pointIndexes = getCoincidentPointIndexes(route, pointIndex)
  if (
    pointIndexes.includes(0) ||
    pointIndexes.includes(route.route.length - 1)
  ) {
    return false
  }

  const bounds = getNodeBounds(node, POSITION_EPSILON)
  let changed = false
  for (const candidateIndex of pointIndexes) {
    const point = route.route[candidateIndex]
    if (!point) continue
    point.x = clampValue(point.x + dx, bounds.minX, bounds.maxX)
    point.y = clampValue(point.y + dy, bounds.minY, bounds.maxY)
    changed = true
  }

  return changed
}

const distributeSegmentMove = (
  routes: MutableRoute[],
  segment: Segment,
  dx: number,
  dy: number,
  node: NodeWithPortPoints,
  t: number,
) => {
  const startWeight = 1 - clampValue(t, 0, 1)
  const endWeight = clampValue(t, 0, 1)
  const movedStart = applyRoutePointMove(
    routes,
    segment.routeIndex,
    segment.startIndex,
    dx * startWeight,
    dy * startWeight,
    node,
  )
  const movedEnd = applyRoutePointMove(
    routes,
    segment.routeIndex,
    segment.endIndex,
    dx * endWeight,
    dy * endWeight,
    node,
  )

  return movedStart || movedEnd
}

const projectSegmentSegmentClearance = (
  routes: MutableRoute[],
  node: NodeWithPortPoints,
  segments: Segment[],
) => {
  let changed = false

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex]
    if (!left) continue

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex]
      if (
        !right ||
        left.z !== right.z ||
        left.rootConnectionName === right.rootConnectionName
      ) {
        continue
      }

      const [candidate] = getSegmentDistanceCandidates(left, right)
      if (!candidate) continue

      const separationX = candidate.leftPoint.x - candidate.rightPoint.x
      const separationY = candidate.leftPoint.y - candidate.rightPoint.y
      const distance = Math.hypot(separationX, separationY)
      const requiredDistance =
        left.traceRadius +
        right.traceRadius +
        RELAXED_TRACE_CLEARANCE +
        CLEARANCE_SLACK
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue

      const leftVectorX = left.end.x - left.start.x
      const leftVectorY = left.end.y - left.start.y
      const fallbackMagnitude = Math.hypot(leftVectorX, leftVectorY)
      const fallbackSign = (leftIndex + rightIndex) % 2 === 0 ? 1 : -1
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : fallbackMagnitude > POSITION_EPSILON
            ? (-leftVectorY / fallbackMagnitude) * fallbackSign
            : 1
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : fallbackMagnitude > POSITION_EPSILON
            ? (leftVectorX / fallbackMagnitude) * fallbackSign
            : 0
      const move = Math.min(MAX_TRACE_MOVE_PER_PASS, penetration / 2)

      changed =
        distributeSegmentMove(
          routes,
          left,
          directionX * move,
          directionY * move,
          node,
          candidate.leftT,
        ) || changed
      changed =
        distributeSegmentMove(
          routes,
          right,
          -directionX * move,
          -directionY * move,
          node,
          candidate.rightT,
        ) || changed
    }
  }

  return changed
}

const deriveVias = (route: MutableRoute): MutableRoute["vias"] => {
  const vias: MutableRoute["vias"] = []

  for (let index = 0; index < route.route.length - 1; index += 1) {
    const current = route.route[index]
    const next = route.route[index + 1]
    if (!current || !next) continue
    if (current.z === next.z || !areSameXY(current, next)) continue

    const via = {
      x: Number(current.x.toFixed(3)),
      y: Number(current.y.toFixed(3)),
    }
    const previousVia = vias.at(-1)
    if (previousVia && areSameXY(previousVia, via)) continue
    vias.push(via)
  }

  return vias
}

const improveViaClearance = (
  node: NodeWithPortPoints,
  routes: HighDensityRoute[],
) => {
  const mutableRoutes = cloneRoutes(routes)

  for (let pass = 0; pass < VIA_PROJECTION_PASSES; pass += 1) {
    const vias = collectViaNodes(mutableRoutes)
    const segments = collectSegments(mutableRoutes)
    const changedViaVia = projectViaViaClearance(mutableRoutes, node, vias)
    const changedViaSegment = projectViaSegmentClearance(
      mutableRoutes,
      node,
      vias,
      segments,
    )
    const changedSegmentSegment = projectSegmentSegmentClearance(
      mutableRoutes,
      node,
      segments,
    )

    if (!changedViaVia && !changedViaSegment && !changedSegmentSegment) break
  }

  return mutableRoutes.map((route) => ({
    ...route,
    vias: deriveVias(route),
  }))
}

const getLocalDrcIssueCount = (
  node: NodeWithPortPoints,
  routes: HighDensityRoute[],
) => runDrcCheck(node as any, routes as any).issues.length

export class HighDensityForceImproveSolver extends BaseHighDensityForceImproveSolver {
  override _step() {
    const sampleIndex = this.activeSampleIndex
    super._step()
    const sampleEntry = this.sampleEntries[sampleIndex]

    if (!sampleEntry || this.activeSampleIndex === sampleIndex) {
      return
    }

    const routes = sampleEntry.routeIndexes.map(
      (routeIndex) =>
        this.improvedRoutesByIndex.get(routeIndex) ??
        this.originalHdRoutes[routeIndex],
    )
    const improvedRoutes = improveViaClearance(sampleEntry.node, routes)
    const shouldAcceptImprovedRoutes =
      getLocalDrcIssueCount(sampleEntry.node, improvedRoutes) <=
      getLocalDrcIssueCount(sampleEntry.node, routes)

    for (let i = 0; i < sampleEntry.routeIndexes.length; i += 1) {
      this.improvedRoutesByIndex.set(
        sampleEntry.routeIndexes[i]!,
        shouldAcceptImprovedRoutes ? improvedRoutes[i]! : routes[i]!,
      )
    }
  }
}

export { runForceDirectedImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"
export type { ForceVector }
