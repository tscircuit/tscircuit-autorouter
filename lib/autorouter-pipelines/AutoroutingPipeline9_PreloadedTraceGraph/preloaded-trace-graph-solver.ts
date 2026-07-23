import { RbushIndex } from "lib/data-structures/RbushIndex"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteJson,
} from "lib/types"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

type PreloadedTraceShape = {
  connectionName: string
  obstacle: Obstacle
  zLayers: number[]
}

type RotatedRectGeometry = {
  center: { x: number; y: number }
  halfWidth: number
  halfHeight: number
  unitX: { x: number; y: number }
  unitY: { x: number; y: number }
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const GEOMETRIC_TOLERANCE = 1e-6

const getRotatedRectGeometry = (
  obstacle: Obstacle,
): RotatedRectGeometry => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight
  const extentY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight

  return {
    center: obstacle.center,
    halfWidth,
    halfHeight,
    unitX: { x: cos, y: sin },
    unitY: { x: -sin, y: cos },
    bounds: {
      minX: obstacle.center.x - extentX,
      minY: obstacle.center.y - extentY,
      maxX: obstacle.center.x + extentX,
      maxY: obstacle.center.y + extentY,
    },
  }
}

const doesRotatedRectOverlapNode = (
  rect: RotatedRectGeometry,
  node: CapacityMeshNode,
): boolean => {
  const nodeHalfWidth = node.width / 2
  const nodeHalfHeight = node.height / 2
  const deltaX = rect.center.x - node.center.x
  const deltaY = rect.center.y - node.center.y
  const projectedOnRectX = Math.abs(
    deltaX * rect.unitX.x + deltaY * rect.unitX.y,
  )
  const projectedOnRectY = Math.abs(
    deltaX * rect.unitY.x + deltaY * rect.unitY.y,
  )

  return (
    Math.abs(deltaX) <=
      nodeHalfWidth +
        rect.halfWidth * Math.abs(rect.unitX.x) +
        rect.halfHeight * Math.abs(rect.unitY.x) +
        GEOMETRIC_TOLERANCE &&
    Math.abs(deltaY) <=
      nodeHalfHeight +
        rect.halfWidth * Math.abs(rect.unitX.y) +
        rect.halfHeight * Math.abs(rect.unitY.y) +
        GEOMETRIC_TOLERANCE &&
    projectedOnRectX <=
      rect.halfWidth +
        nodeHalfWidth * Math.abs(rect.unitX.x) +
        nodeHalfHeight * Math.abs(rect.unitX.y) +
        GEOMETRIC_TOLERANCE &&
    projectedOnRectY <=
      rect.halfHeight +
        nodeHalfWidth * Math.abs(rect.unitY.x) +
        nodeHalfHeight * Math.abs(rect.unitY.y) +
        GEOMETRIC_TOLERANCE
  )
}

const getPreloadedTraceShapes = (
  srj: SimpleRouteJson,
): PreloadedTraceShape[] => {
  const shapes: PreloadedTraceShape[] = []

  for (const trace of srj.traces ?? []) {
    if (!trace.connection_name) {
      throw new Error(
        `Preloaded trace "${trace.pcb_trace_id}" is missing a connection name`,
      )
    }

    const obstacles = getObstaclesFromSrjTraces({
      ...srj,
      traces: [trace],
    })
    for (const obstacle of obstacles) {
      const zLayers = getUniqueValidZLayersFromLayerNames(
        obstacle.layers,
        srj.layerCount,
      )
      if (zLayers.length === 0) {
        throw new Error(
          `Preloaded trace shape "${obstacle.obstacleId ?? trace.pcb_trace_id}" has no valid board layers`,
        )
      }
      shapes.push({
        connectionName: trace.connection_name,
        obstacle,
        zLayers,
      })
    }
  }

  return shapes
}

/**
 * Projects exact preloaded wire/via geometry onto the final capacity mesh.
 * buildHyperGraph canonicalizes each `_connectedTo` value into a fixed net
 * assignment, so old copper participates in pathing without fragmenting the
 * RectDiff topology.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly outputNodes: CapacityMeshNode[]
  private readonly nodeIndex = new RbushIndex<CapacityMeshNode>()
  private readonly traceShapes: PreloadedTraceShape[]

  constructor(
    capacityMeshNodes: CapacityMeshNode[],
    private readonly srj: SimpleRouteJson,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.outputNodes = capacityMeshNodes.map((node) => ({
      ...node,
      availableZ: [...node.availableZ],
      _connectedTo:
        node._connectedTo === undefined ? undefined : [...node._connectedTo],
    }))
    this.nodeIndex.bulkLoad(
      this.outputNodes.map((node) => ({
        item: node,
        minX: node.center.x - node.width / 2,
        minY: node.center.y - node.height / 2,
        maxX: node.center.x + node.width / 2,
        maxY: node.center.y + node.height / 2,
      })),
    )
    this.traceShapes = getPreloadedTraceShapes(srj)
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  override _step(): void {
    const projectedNodeIds = new Set<string>()
    let traceRegionAssignmentCount = 0

    for (const shape of this.traceShapes) {
      const geometry = getRotatedRectGeometry(shape.obstacle)
      const candidateNodes = this.nodeIndex.search(
        geometry.bounds.minX,
        geometry.bounds.minY,
        geometry.bounds.maxX,
        geometry.bounds.maxY,
      )

      for (const node of candidateNodes) {
        if (!node.availableZ.some((z) => shape.zLayers.includes(z))) continue
        if (!doesRotatedRectOverlapNode(geometry, node)) continue

        const connectedTo = new Set(node._connectedTo ?? [])
        const previousConnectionCount = connectedTo.size
        connectedTo.add(shape.connectionName)
        node._connectedTo = [...connectedTo]
        projectedNodeIds.add(node.capacityMeshNodeId)
        if (connectedTo.size > previousConnectionCount) {
          traceRegionAssignmentCount++
        }
      }
    }

    this.stats = {
      preloadedTraceCount: this.srj.traces?.length ?? 0,
      preloadedTraceShapeCount: this.traceShapes.length,
      projectedNodeCount: projectedNodeIds.size,
      traceRegionAssignmentCount,
    }
    this.solved = true
  }

  getOutput(): CapacityMeshNode[] {
    if (!this.solved) {
      throw new Error("PreloadedTraceGraphSolver has not solved yet")
    }
    return this.outputNodes
  }
}
