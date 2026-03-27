import { HighDensityRepairSolver } from "high-density-repair02"
import type { GraphicsObject } from "graphics-debug"
import type {
  DatasetSample,
  HdRoute as RepairHdRoute,
} from "high-density-repair02"
import type { Obstacle } from "lib/types/srj-types"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type RepairSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
  sample: DatasetSample
}

const DEFAULT_REPAIR_MARGIN = 0.2

const doesRectOverlap = (
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

const getNodeBounds = (node: NodeWithPortPoints, margin = 0) => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const getObstacleBounds = (obstacle: Obstacle) => ({
  minX: obstacle.center.x - obstacle.width / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const isPointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
  margin = 0,
) => {
  const bounds = getNodeBounds(node, margin)
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

const findNodeIndexForRoute = (
  route: HighDensityRoute,
  nodes: NodeWithPortPoints[],
  margin: number,
): number => {
  const routePoints = route.route.map(({ x, y }) => ({ x, y }))
  const viaPoints = route.vias.map(({ x, y }) => ({ x, y }))
  const points = [...routePoints, ...viaPoints]

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (points.every((point) => isPointInsideNode(point, node, margin))) {
      return i
    }
  }

  return -1
}

const toRepairRoute = (route: HighDensityRoute): RepairHdRoute => ({
  capacityMeshNodeId: undefined,
  connectionName: route.connectionName,
  rootConnectionName: route.rootConnectionName,
  route: route.route.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
  })),
  traceThickness: route.traceThickness,
  vias: route.vias.map((via) => ({
    x: via.x,
    y: via.y,
    diameter: route.viaDiameter,
  })),
  viaDiameter: route.viaDiameter,
})

const fromRepairRoute = (
  route: RepairHdRoute,
  fallbackRoute: HighDensityRoute,
): HighDensityRoute => ({
  connectionName: route.connectionName ?? fallbackRoute.connectionName,
  rootConnectionName:
    route.rootConnectionName ?? fallbackRoute.rootConnectionName,
  traceThickness: route.traceThickness ?? fallbackRoute.traceThickness,
  viaDiameter: route.viaDiameter ?? fallbackRoute.viaDiameter,
  route:
    route.route?.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z ?? 0,
    })) ?? fallbackRoute.route,
  vias:
    route.vias?.map((via) => ({
      x: via.x,
      y: via.y,
    })) ?? fallbackRoute.vias,
  jumpers: fallbackRoute.jumpers,
})

const getAdjacentObstacles = (
  node: NodeWithPortPoints,
  obstacleSHI: ObstacleSpatialHashIndex,
  margin: number,
) => {
  const expandedNodeBounds = getNodeBounds(node, margin)

  return obstacleSHI
    .search(expandedNodeBounds)
    .filter((obstacle) =>
      doesRectOverlap(expandedNodeBounds, getObstacleBounds(obstacle)),
    )
    .map((obstacle) => ({
      type: obstacle.type,
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
    }))
}

export class Pipeline4HighDensityRepairSolver extends BaseSolver {
  readonly repairMargin: number
  readonly sampleEntries: RepairSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly originalObstacles: Obstacle[]
  readonly obstacleSHI: ObstacleSpatialHashIndex
  readonly colorMap: Record<string, string>

  repairedRoutesByIndex = new Map<number, HighDensityRoute>()
  activeSampleIndex = 0
  override activeSubSolver: HighDensityRepairSolver | null = null
  latestVisualization: GraphicsObject = {}

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    obstacles: Obstacle[]
    repairMargin?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.repairMargin = params.repairMargin ?? DEFAULT_REPAIR_MARGIN
    this.originalHdRoutes = params.hdRoutes
    this.originalNodeWithPortPoints = params.nodeWithPortPoints
    this.originalObstacles = params.obstacles
    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      this.originalObstacles,
    )
    this.colorMap = params.colorMap ?? {}

    const routeIndexesByNode = new Map<number, number[]>()
    for (let i = 0; i < params.hdRoutes.length; i++) {
      const nodeIndex = findNodeIndexForRoute(
        params.hdRoutes[i],
        params.nodeWithPortPoints,
        this.repairMargin,
      )
      if (nodeIndex === -1) continue
      const routeIndexes = routeIndexesByNode.get(nodeIndex) ?? []
      routeIndexes.push(i)
      routeIndexesByNode.set(nodeIndex, routeIndexes)
    }

    this.sampleEntries = Array.from(routeIndexesByNode.entries()).map(
      ([nodeIndex, routeIndexes]) => {
        const node = params.nodeWithPortPoints[nodeIndex]
        return {
          node,
          routeIndexes,
          sample: {
            nodeWithPortPoints: {
              capacityMeshNodeId: node.capacityMeshNodeId,
              center: node.center,
              width: node.width,
              height: node.height,
              portPoints: node.portPoints.map((portPoint) => ({
                x: portPoint.x,
                y: portPoint.y,
                z: portPoint.z,
                connectionName: portPoint.connectionName,
                portPointId: portPoint.portPointId,
              })),
            },
            nodeHdRoutes: routeIndexes.map((routeIndex) =>
              toRepairRoute(params.hdRoutes[routeIndex]),
            ),
            adjacentObstacles: getAdjacentObstacles(
              node,
              this.obstacleSHI,
              this.repairMargin,
            ),
          },
        }
      },
    )

    this.MAX_ITERATIONS = Math.max(this.sampleEntries.length * 1_000, 100_000)
    this.stats = {
      sampleCount: this.sampleEntries.length,
      repairedNodeCount: 0,
      repairedRouteCount: 0,
    }
  }

  override getSolverName(): string {
    return "Pipeline4HighDensityRepairSolver"
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.sampleEntries.map((entry) => entry.node),
        hdRoutes: this.originalHdRoutes,
        obstacles: this.originalObstacles,
        repairMargin: this.repairMargin,
        colorMap: this.colorMap,
      },
    ] as const
  }

  override _step() {
    const sampleEntry = this.sampleEntries[this.activeSampleIndex]

    if (!sampleEntry) {
      this.solved = true
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.latestVisualization = this.activeSubSolver.visualize()

      if (this.activeSubSolver.failed) {
        this.failed = true
        this.error =
          this.activeSubSolver.error ??
          `High density repair failed for node ${sampleEntry.node.capacityMeshNodeId}`
        this.activeSubSolver = null
        return
      }

      if (!this.activeSubSolver.solved) {
        return
      }

      const repairedRoutes = this.activeSubSolver.getOutput().repairedRoutes
      for (let i = 0; i < sampleEntry.routeIndexes.length; i++) {
        const routeIndex = sampleEntry.routeIndexes[i]
        const fallbackRoute = this.originalHdRoutes[routeIndex]
        const repairedRoute = repairedRoutes[i]
        this.repairedRoutesByIndex.set(
          routeIndex,
          repairedRoute
            ? fromRepairRoute(repairedRoute, fallbackRoute)
            : fallbackRoute,
        )
      }

      this.activeSubSolver = null
      this.activeSampleIndex += 1
      this.stats = {
        sampleCount: this.sampleEntries.length,
        repairedNodeCount: this.activeSampleIndex,
        repairedRouteCount: this.repairedRoutesByIndex.size,
      }

      if (this.activeSampleIndex >= this.sampleEntries.length) {
        this.solved = true
      }
      return
    }

    this.activeSubSolver = new HighDensityRepairSolver({
      sample: sampleEntry.sample,
      margin: this.repairMargin,
    })
    this.latestVisualization = this.activeSubSolver.visualize()
  }

  getOutput(): HighDensityRoute[] {
    return this.originalHdRoutes.map(
      (route, index) => this.repairedRoutesByIndex.get(index) ?? route,
    )
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    if (!this.solved) {
      return this.latestVisualization
    }

    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []
    for (const route of this.getOutput()) {
      const strokeColor = this.colorMap[route.connectionName] ?? "#0ea5e9"
      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        lines.push({
          points: [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
          ],
          strokeColor,
          strokeWidth: route.traceThickness,
        })
      }
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          stroke: strokeColor,
          fill: "rgba(14,165,233,0.12)",
        })
      }
    }

    return {
      title: "Pipeline4 High Density Repair",
      lines,
      circles,
    }
  }
}
