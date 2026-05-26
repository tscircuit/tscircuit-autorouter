import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type Point3 = { x: number; y: number; z: number }
type Point2 = { x: number; y: number }

type PairTask = {
  connectionName: string
  rootConnectionName: string
  A: PortPoint
  B: PortPoint
}

type ObstacleSegment = {
  A: Point2
  B: Point2
  rootConnectionName: string
}

const EPS = 1e-6
const POINT_OFFSET = 0.02

const pointKey = (point: Point2) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)}`

const samePoint = (a: Point2, b: Point2) =>
  Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

const dedupePoints = <T extends Point2>(points: T[]) => {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const point of points) {
    const key = pointKey(point)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(point)
  }
  return deduped
}

const uniqueAvailableZ = (node: NodeWithPortPoints) => {
  if (node.availableZ?.length) {
    return [...new Set(node.availableZ)].sort((a, b) => a - b)
  }
  return [...new Set(node.portPoints.map((p) => p.z ?? 0))].sort(
    (a, b) => a - b,
  )
}

const getBounds = (node: NodeWithPortPoints) => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

const getEdge = (
  point: Point2,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): "top" | "right" | "bottom" | "left" | null => {
  if (Math.abs(point.y - bounds.minY) < 1e-3) return "top"
  if (Math.abs(point.x - bounds.maxX) < 1e-3) return "right"
  if (Math.abs(point.y - bounds.maxY) < 1e-3) return "bottom"
  if (Math.abs(point.x - bounds.minX) < 1e-3) return "left"
  return null
}

const isInsideBounds = (
  point: Point2,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
) =>
  point.x >= bounds.minX - EPS &&
  point.x <= bounds.maxX + EPS &&
  point.y >= bounds.minY - EPS &&
  point.y <= bounds.maxY + EPS

const segmentIntersectsForeignPort = (
  A: Point2,
  B: Point2,
  foreignPorts: Point2[],
) => {
  for (const port of foreignPorts) {
    if (samePoint(port, A) || samePoint(port, B)) continue
    if (pointToSegmentDistance(port, A, B) < 1e-4) {
      return true
    }
  }
  return false
}

const segmentIntersectsObstacles = (
  A: Point2,
  B: Point2,
  obstacleSegments: ObstacleSegment[],
) => {
  for (const segment of obstacleSegments) {
    if (
      samePoint(A, segment.A) ||
      samePoint(A, segment.B) ||
      samePoint(B, segment.A) ||
      samePoint(B, segment.B)
    ) {
      continue
    }
    if (doSegmentsIntersect(A, B, segment.A, segment.B)) {
      return true
    }
  }
  return false
}

const getObstacleSegments = (
  routes: HighDensityIntraNodeRoute[],
  currentRootConnectionName: string,
) => {
  const segments: ObstacleSegment[] = []
  for (const route of routes) {
    const routeRoot = route.rootConnectionName ?? route.connectionName
    if (routeRoot === currentRootConnectionName) continue
    for (let i = 0; i < route.route.length - 1; i++) {
      const A = route.route[i]!
      const B = route.route[i + 1]!
      if (A.z !== B.z) continue
      segments.push({
        A: { x: A.x, y: A.y },
        B: { x: B.x, y: B.y },
        rootConnectionName: routeRoot,
      })
    }
  }
  return segments
}

const getForeignPorts = (
  node: NodeWithPortPoints,
  currentRootConnectionName: string,
) =>
  node.portPoints
    .filter(
      (point) =>
        (point.rootConnectionName ?? point.connectionName) !==
        currentRootConnectionName,
    )
    .map((point) => ({ x: point.x, y: point.y }))

function* permutations<T>(items: T[], n = items.length): Generator<T[]> {
  if (n <= 1) {
    yield items.slice()
    return
  }
  for (let i = 0; i < n; i++) {
    ;[items[i], items[n - 1]] = [items[n - 1]!, items[i]!]
    yield* permutations(items, n - 1)
    ;[items[i], items[n - 1]] = [items[n - 1]!, items[i]!]
  }
}

const findPath = ({
  A,
  B,
  bounds,
  obstacleSegments,
  foreignPorts,
}: {
  A: Point3
  B: Point3
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  obstacleSegments: ObstacleSegment[]
  foreignPorts: Point2[]
}) => {
  const candidatePoints: Point2[] = [
    { x: A.x, y: A.y },
    { x: B.x, y: B.y },
    { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]

  const basePoints = [
    ...obstacleSegments.flatMap((segment) => [segment.A, segment.B]),
    ...foreignPorts,
    { x: A.x, y: A.y },
    { x: B.x, y: B.y },
  ]

  for (const point of basePoints) {
    for (const dx of [-POINT_OFFSET, 0, POINT_OFFSET]) {
      for (const dy of [-POINT_OFFSET, 0, POINT_OFFSET]) {
        const candidate = { x: point.x + dx, y: point.y + dy }
        if (!isInsideBounds(candidate, bounds)) continue
        candidatePoints.push(candidate)
      }
    }
  }

  const nodes = dedupePoints(candidatePoints)
  const startKey = pointKey(A)
  const endKey = pointKey(B)
  const nodeByKey = new Map(nodes.map((node) => [pointKey(node), node]))
  const distanceByKey = new Map<string, number>()
  const previousByKey = new Map<string, string | null>()
  const queue = new Set<string>()

  for (const node of nodes) {
    const key = pointKey(node)
    distanceByKey.set(key, key === startKey ? 0 : Infinity)
    previousByKey.set(key, null)
    queue.add(key)
  }

  while (queue.size > 0) {
    let currentKey: string | null = null
    let currentDistance = Infinity
    for (const key of queue) {
      const candidateDistance = distanceByKey.get(key) ?? Infinity
      if (
        candidateDistance < currentDistance - EPS ||
        (Math.abs(candidateDistance - currentDistance) <= EPS &&
          (currentKey === null || key < currentKey))
      ) {
        currentDistance = candidateDistance
        currentKey = key
      }
    }

    if (!currentKey || currentDistance === Infinity) break
    queue.delete(currentKey)
    if (currentKey === endKey) break

    const currentNode = nodeByKey.get(currentKey)!
    for (const nextKey of queue) {
      const nextNode = nodeByKey.get(nextKey)!
      if (samePoint(currentNode, nextNode)) continue
      if (segmentIntersectsObstacles(currentNode, nextNode, obstacleSegments)) {
        continue
      }
      if (segmentIntersectsForeignPort(currentNode, nextNode, foreignPorts)) {
        continue
      }

      const candidateDistance =
        currentDistance + distance(currentNode, nextNode)
      const nextDistance = distanceByKey.get(nextKey) ?? Infinity
      const nextPreviousKey = previousByKey.get(nextKey)
      if (
        candidateDistance < nextDistance - EPS ||
        (Math.abs(candidateDistance - nextDistance) <= EPS &&
          (nextPreviousKey == null || currentKey < nextPreviousKey))
      ) {
        distanceByKey.set(nextKey, candidateDistance)
        previousByKey.set(nextKey, currentKey)
      }
    }
  }

  if ((distanceByKey.get(endKey) ?? Infinity) === Infinity) {
    return null
  }

  const path: Point2[] = []
  let currentKey: string | null = endKey
  while (currentKey) {
    path.push(nodeByKey.get(currentKey)!)
    currentKey = previousByKey.get(currentKey) ?? null
  }
  path.reverse()

  return path.map((point) => ({ x: point.x, y: point.y, z: A.z }))
}

export class SingleLayerNoDifferentRootIntersectionsIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  traceWidth: number
  viaDiameter: number
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    traceWidth?: number
    viaDiameter?: number
  }) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.traceWidth = params.traceWidth ?? 0.15
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.MAX_ITERATIONS = 1
  }

  static isApplicable(node: NodeWithPortPoints) {
    const availableZ = uniqueAvailableZ(node)
    if (availableZ.length !== 1) return false
    if (node.portPoints.length > 12) return false

    const bounds = getBounds(node)
    if (node.portPoints.some((point) => getEdge(point, bounds) === null)) {
      return false
    }

    const pointCountByConnection = new Map<string, number>()
    for (const portPoint of node.portPoints) {
      pointCountByConnection.set(
        portPoint.connectionName,
        (pointCountByConnection.get(portPoint.connectionName) ?? 0) + 1,
      )
    }

    return [...pointCountByConnection.values()].some((count) => count > 2)
  }

  private buildTaskGroups() {
    const groups = new Map<string, PortPoint[]>()
    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const existing = groups.get(portPoint.connectionName) ?? []
      existing.push(portPoint)
      groups.set(portPoint.connectionName, existing)
    }
    return groups
  }

  private trySolveNode() {
    const bounds = getBounds(this.nodeWithPortPoints)
    const groups = this.buildTaskGroups()
    const pairTasks: PairTask[] = Array.from(groups.entries()).flatMap(
      ([connectionName, points]) =>
        getConnectionPortPointPairs(points).map(([A, B]) => ({
          connectionName,
          rootConnectionName:
            A.rootConnectionName ?? B.rootConnectionName ?? connectionName,
          A,
          B,
        })),
    )

    const candidateOrders =
      pairTasks.length <= 6 ? permutations(pairTasks.slice()) : [pairTasks]

    for (const orderedTasks of candidateOrders) {
      const solvedRoutes: HighDensityIntraNodeRoute[] = []
      let failed = false

      for (const task of orderedTasks) {
        const obstacleSegments = getObstacleSegments(
          solvedRoutes,
          task.rootConnectionName,
        )
        const foreignPorts = getForeignPorts(
          this.nodeWithPortPoints,
          task.rootConnectionName,
        )
        const path = findPath({
          A: task.A,
          B: task.B,
          bounds,
          obstacleSegments,
          foreignPorts,
        })

        if (!path || path.length < 2) {
          failed = true
          break
        }

        solvedRoutes.push({
          connectionName: task.connectionName,
          rootConnectionName: task.rootConnectionName,
          traceThickness: this.traceWidth,
          viaDiameter: this.viaDiameter,
          route: path,
          vias: [],
        })
      }

      if (!failed) {
        return solvedRoutes
      }
    }

    return null
  }

  _step() {
    const solvedRoutes = this.trySolveNode()
    if (!solvedRoutes) {
      this.failed = true
      this.error =
        "Failed to find a single-layer route set without different-root intersections"
      return
    }

    this.solvedRoutes = solvedRoutes
    this.stats = {
      routeCount: solvedRoutes.length,
      distinctRoots: new Set(
        solvedRoutes.map(
          (route) => route.rootConnectionName ?? route.connectionName,
        ),
      ).size,
    }
    this.solved = true
  }

  visualize(): GraphicsObject {
    return {
      lines: this.solvedRoutes.map((route) => ({
        points: route.route,
        strokeColor: "cyan",
        strokeWidth: route.traceThickness,
        label: `${route.connectionName}\nroot: ${route.rootConnectionName ?? route.connectionName}`,
      })),
      points: this.nodeWithPortPoints.portPoints.map((point) => ({
        x: point.x,
        y: point.y,
        color: "blue",
        label: `${point.connectionName}\nroot: ${point.rootConnectionName ?? point.connectionName}`,
      })),
      rects: [],
      circles: [],
    }
  }
}
