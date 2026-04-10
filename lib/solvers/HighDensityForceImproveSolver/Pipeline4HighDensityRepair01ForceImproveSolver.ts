import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  MySolver as HighDensityRepair01,
  type AdjacentObstacle as RepairAdjacentObstacle,
  type ConnMap as RepairConnMap,
  type HighDensityRepair01Input,
  type NodeHdRoute as RepairHdRoute,
} from "high-density-repair01"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { safeTransparentize } from "../colors"
import { BaseSolver } from "../BaseSolver"

type RepairSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
  sample: HighDensityRepair01Input
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

const toRepairConnMap = (connMap: ConnectivityMap): RepairConnMap => ({
  idToNetMap: { ...connMap.idToNetMap },
  netMap: Object.fromEntries(
    Object.entries(connMap.netMap).map(([net, ids]) => [net, [...ids]]),
  ),
})

const toRepairRoute = (
  route: HighDensityRoute,
  capacityMeshNodeId: string,
): RepairHdRoute => ({
  capacityMeshNodeId,
  connectionName: route.connectionName,
  rootConnectionName: route.rootConnectionName ?? route.connectionName,
  route: route.route.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z as 0 | 1,
    insideJumperPad: point.insideJumperPad,
  })),
  traceThickness: route.traceThickness,
  vias: route.vias.map((via) => ({
    x: via.x,
    y: via.y,
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
      z: point.z,
      insideJumperPad: point.insideJumperPad,
    })) ?? fallbackRoute.route,
  vias:
    route.vias?.map((via) => ({
      x: via.x,
      y: via.y,
    })) ?? fallbackRoute.vias,
  jumpers: fallbackRoute.jumpers,
})

const getAvailableZ = (node: NodeWithPortPoints): Array<0 | 1> => {
  if (node.availableZ?.length) {
    return node.availableZ.filter((z): z is 0 | 1 => z === 0 || z === 1)
  }

  const uniqueZ = [...new Set(node.portPoints.map((portPoint) => portPoint.z))]
    .filter((z): z is 0 | 1 => z === 0 || z === 1)
    .sort()

  return uniqueZ.length > 0 ? uniqueZ : [0, 1]
}

const getAdjacentObstacles = (
  node: NodeWithPortPoints,
  obstacleSHI: ObstacleSpatialHashIndex,
  margin: number,
): RepairAdjacentObstacle[] => {
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
      layers: obstacle.layers.filter(
        (layer): layer is "top" | "bottom" =>
          layer === "top" || layer === "bottom",
      ),
      connectedTo: obstacle.connectedTo.map(String),
    }))
}

export class Pipeline4HighDensityRepair01ForceImproveSolver extends BaseSolver {
  readonly repairMargin: number
  readonly sampleEntries: RepairSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly originalObstacles: Obstacle[]
  readonly obstacleSHI: ObstacleSpatialHashIndex
  readonly colorMap: Record<string, string>
  readonly connMap: ConnectivityMap

  repairedRoutesByIndex = new Map<number, HighDensityRoute>()
  activeSampleIndex = 0
  override activeSubSolver: any = null
  latestVisualization: GraphicsObject = {}

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    obstacles: Obstacle[]
    connMap: ConnectivityMap
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
    this.connMap = params.connMap

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
              availableZ: getAvailableZ(node),
              capacityMeshNodeId: node.capacityMeshNodeId,
              center: node.center,
              width: node.width,
              height: node.height,
              portPoints: node.portPoints.map((portPoint, index) => ({
                x: portPoint.x,
                y: portPoint.y,
                z: portPoint.z as 0 | 1,
                connectionName: portPoint.connectionName,
                rootConnectionName:
                  portPoint.rootConnectionName ?? portPoint.connectionName,
                portPointId:
                  portPoint.portPointId ??
                  `${node.capacityMeshNodeId}-${portPoint.connectionName}-${index}`,
              })),
            },
            nodeHdRoutes: routeIndexes.map((routeIndex) =>
              toRepairRoute(params.hdRoutes[routeIndex], node.capacityMeshNodeId),
            ),
            adjacentObstacles: getAdjacentObstacles(
              node,
              this.obstacleSHI,
              this.repairMargin,
            ),
            connMap: toRepairConnMap(this.connMap),
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
    return "Pipeline4HighDensityRepair01ForceImproveSolver"
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.originalNodeWithPortPoints,
        hdRoutes: this.originalHdRoutes,
        obstacles: this.originalObstacles,
        connMap: this.connMap,
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
          `High density repair01 failed for node ${sampleEntry.node.capacityMeshNodeId}`
        this.activeSubSolver = null
        return
      }

      if (!this.activeSubSolver.solved) {
        return
      }

      const repairedSample = this.activeSubSolver.getOutput()
      const repairedRoutes = repairedSample.nodeHdRoutes ?? []
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

    this.activeSubSolver = new HighDensityRepair01(sampleEntry.sample)
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
        if (start.z !== end.z) continue
        lines.push({
          points: [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
          ],
          strokeColor:
            start.z === 0 ? strokeColor : safeTransparentize(strokeColor, 0.5),
          strokeWidth: route.traceThickness,
          layer: `z${start.z}`,
          strokeDash: start.z !== 0 ? [0.1, 0.3] : undefined,
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

    return { lines, circles }
  }
}
