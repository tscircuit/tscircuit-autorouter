import { BaseSolver } from "lib/solvers/BaseSolver"
import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"
import { resolvePreloadedTraceCanonicalNetIds } from "lib/utils/resolvePreloadedTraceCanonicalNetIds"

type PreloadedTraceShape = {
  fixedNetId: string
  zLayers: number[]
  geometry: RotatedRectGeometry
  refinementCellDimension: number
}

type PendingRefinement = {
  f: number
  node: CapacityMeshNode
  candidateShapes: PreloadedTraceShape[]
  depth: number
  childPath: string
}

type RefinementAxis = "x" | "y"

type RotatedRectGeometry = {
  center: { x: number; y: number }
  halfWidth: number
  halfHeight: number
  unitX: { x: number; y: number }
  unitY: { x: number; y: number }
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const GEOMETRIC_TOLERANCE = 1e-6
const REFINEMENT_CELL_FACTOR = 0.5
const MAX_REFINEMENT_DEPTH = 16
const BASE_MAX_COMPENSATED_OUTPUT_NODE_COUNT = 3_000
const MIN_REFINEMENT_WORST_CASE_ALLOWANCE = 2_050

const getCanonicalSimpleRouteConnectionName = (
  connection: SimpleRouteConnection,
) =>
  connection.__netConnectionName ??
  connection.__rootConnectionNames?.[0] ??
  connection.name

const getRotatedRectGeometry = (obstacle: Obstacle): RotatedRectGeometry => {
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

const doesRotatedRectContainNode = (
  rect: RotatedRectGeometry,
  node: CapacityMeshNode,
): boolean => {
  const nodeHalfWidth = node.width / 2
  const nodeHalfHeight = node.height / 2
  const deltaX = node.center.x - rect.center.x
  const deltaY = node.center.y - rect.center.y
  const projectedOnRectX = Math.abs(
    deltaX * rect.unitX.x + deltaY * rect.unitX.y,
  )
  const projectedOnRectY = Math.abs(
    deltaX * rect.unitY.x + deltaY * rect.unitY.y,
  )
  const nodeExtentOnRectX =
    nodeHalfWidth * Math.abs(rect.unitX.x) +
    nodeHalfHeight * Math.abs(rect.unitX.y)
  const nodeExtentOnRectY =
    nodeHalfWidth * Math.abs(rect.unitY.x) +
    nodeHalfHeight * Math.abs(rect.unitY.y)

  return (
    projectedOnRectX + nodeExtentOnRectX <=
      rect.halfWidth + GEOMETRIC_TOLERANCE &&
    projectedOnRectY + nodeExtentOnRectY <=
      rect.halfHeight + GEOMETRIC_TOLERANCE
  )
}

const doesRotatedRectIntersectNode = (
  rect: RotatedRectGeometry,
  node: CapacityMeshNode,
): boolean => {
  const nodeHalfWidth = node.width / 2
  const nodeHalfHeight = node.height / 2
  const nodeMinX = node.center.x - nodeHalfWidth
  const nodeMaxX = node.center.x + nodeHalfWidth
  const nodeMinY = node.center.y - nodeHalfHeight
  const nodeMaxY = node.center.y + nodeHalfHeight
  if (
    nodeMaxX < rect.bounds.minX - GEOMETRIC_TOLERANCE ||
    nodeMinX > rect.bounds.maxX + GEOMETRIC_TOLERANCE ||
    nodeMaxY < rect.bounds.minY - GEOMETRIC_TOLERANCE ||
    nodeMinY > rect.bounds.maxY + GEOMETRIC_TOLERANCE
  ) {
    return false
  }

  const deltaX = node.center.x - rect.center.x
  const deltaY = node.center.y - rect.center.y
  const projectedOnRectX = Math.abs(
    deltaX * rect.unitX.x + deltaY * rect.unitX.y,
  )
  const projectedOnRectY = Math.abs(
    deltaX * rect.unitY.x + deltaY * rect.unitY.y,
  )
  const nodeExtentOnRectX =
    nodeHalfWidth * Math.abs(rect.unitX.x) +
    nodeHalfHeight * Math.abs(rect.unitX.y)
  const nodeExtentOnRectY =
    nodeHalfWidth * Math.abs(rect.unitY.x) +
    nodeHalfHeight * Math.abs(rect.unitY.y)

  return (
    projectedOnRectX <=
      rect.halfWidth + nodeExtentOnRectX + GEOMETRIC_TOLERANCE &&
    projectedOnRectY <=
      rect.halfHeight + nodeExtentOnRectY + GEOMETRIC_TOLERANCE
  )
}

const getPreloadedTraceShapes = (
  srj: SimpleRouteJson,
  containmentCompensation = srj.minTraceWidth / 2,
  refinementCellFactor = REFINEMENT_CELL_FACTOR,
): PreloadedTraceShape[] => {
  const shapes: PreloadedTraceShape[] = []
  const canonicalNetIdByTraceId = resolvePreloadedTraceCanonicalNetIds(srj)
  const requestedKeepoutMargin = srj.defaultObstacleMargin ?? 0.15
  // Nodes are reserved only when the full axis-aligned cell fits inside the
  // rotated keepout. Compensate by one candidate trace radius so that this
  // containment approximation does not systematically shrink fixed copper.
  const projectedKeepoutMargin =
    requestedKeepoutMargin + containmentCompensation

  for (const trace of srj.traces ?? []) {
    if (!trace.connection_name) {
      throw new Error(
        `Preloaded trace "${trace.pcb_trace_id}" is missing a connection name`,
      )
    }

    const obstacles = getObstaclesFromSrjTraces(
      {
        ...srj,
        traces: [trace],
      },
      {
        includeConnectionNameInConnectedTo: true,
        includeSquareCaps: true,
        modelJumperPads: true,
      },
    )
    for (const obstacle of obstacles) {
      const keepoutObstacle = {
        ...obstacle,
        width: obstacle.width + projectedKeepoutMargin * 2,
        height: obstacle.height + projectedKeepoutMargin * 2,
      }
      const refinementCellDimension =
        Math.min(
          obstacle.width + requestedKeepoutMargin * 2,
          obstacle.height + requestedKeepoutMargin * 2,
        ) * refinementCellFactor
      const zLayers = getUniqueValidZLayersFromLayerNames(
        keepoutObstacle.layers,
        srj.layerCount,
      )
      if (zLayers.length === 0) {
        throw new Error(
          `Preloaded trace shape "${obstacle.obstacleId ?? trace.pcb_trace_id}" has no valid board layers`,
        )
      }
      shapes.push({
        fixedNetId:
          canonicalNetIdByTraceId.get(trace.pcb_trace_id) ??
          trace.connection_name,
        zLayers,
        geometry: getRotatedRectGeometry(keepoutObstacle),
        refinementCellDimension,
      })
    }
  }

  return shapes
}

/**
 * Projects preloaded copper onto the final capacity mesh. Spatial cells are
 * refined until trace keepouts fully contain the affected cells. When a trace
 * occupies only some of a cell's layers, the cell is cloned into layer groups
 * so the hypergraph reserves only the copper's actual layers.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly inputNodes: CapacityMeshNode[]
  private readonly outputNodes: CapacityMeshNode[]
  private readonly traceShapes: PreloadedTraceShape[]
  private readonly traceShapeIndex = new RbushIndex<PreloadedTraceShape>()

  constructor(
    capacityMeshNodes: CapacityMeshNode[],
    private readonly srj: SimpleRouteJson,
    private readonly maxCompensatedOutputNodeCount?: number,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.inputNodes = capacityMeshNodes.map((node) => ({
      ...node,
      availableZ: [...node.availableZ],
      _connectedTo:
        node._connectedTo === undefined ? undefined : [...node._connectedTo],
      _preloadedFixedNetIds:
        node._preloadedFixedNetIds === undefined
          ? undefined
          : [...node._preloadedFixedNetIds],
    }))
    this.outputNodes = []
    this.traceShapes = getPreloadedTraceShapes(srj)
    this.traceShapeIndex.bulkLoad(
      this.traceShapes.map((shape) => ({
        item: shape,
        ...shape.geometry.bounds,
      })),
    )
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  private reserveNodeByTraceLayerConnectivity(
    node: CapacityMeshNode,
    reservingShapes: PreloadedTraceShape[],
  ): CapacityMeshNode[] {
    const existingConnections = [...(node._connectedTo ?? [])].sort()
    const existingFixedNetIds = [
      ...new Set(node._preloadedFixedNetIds ?? []),
    ].sort()
    const layerGroups = new Map<
      string,
      { availableZ: number[]; fixedNetIds: string[] }
    >()
    for (const z of node.availableZ) {
      const fixedNetIds = reservingShapes
        .filter((shape) => shape.zLayers.includes(z))
        .map((shape) => shape.fixedNetId)
      const combinedFixedNetIds = [
        ...new Set([...existingFixedNetIds, ...fixedNetIds]),
      ].sort()
      const groupKey = JSON.stringify(combinedFixedNetIds)
      const group = layerGroups.get(groupKey) ?? {
        availableZ: [],
        fixedNetIds: combinedFixedNetIds,
      }
      group.availableZ.push(z)
      layerGroups.set(groupKey, group)
    }

    if (layerGroups.size <= 1) {
      const group = [...layerGroups.values()][0]
      return [
        {
          ...node,
          availableZ: [...node.availableZ],
          _connectedTo:
            existingConnections.length === 0
              ? undefined
              : [...existingConnections],
          _preloadedFixedNetIds:
            group && group.fixedNetIds.length > 0
              ? [...group.fixedNetIds]
              : undefined,
        },
      ]
    }

    return [...layerGroups.values()].map(({ availableZ, fixedNetIds }) => ({
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}__preloaded_z${availableZ.join("_")}`,
      layer: `z${availableZ.join(",")}`,
      availableZ: [...availableZ],
      _connectedTo:
        existingConnections.length === 0 ? undefined : [...existingConnections],
      _preloadedFixedNetIds:
        fixedNetIds.length === 0 ? undefined : [...fixedNetIds],
    }))
  }

  private splitRefinementTask(
    task: PendingRefinement,
    intersectingShapes: PreloadedTraceShape[],
    splitAxis: RefinementAxis,
  ): PendingRefinement[] {
    const { node, depth, childPath } = task
    const splitAlongX = splitAxis === "x"
    const childWidth = splitAlongX ? node.width / 2 : node.width
    const childHeight = splitAlongX ? node.height : node.height / 2
    const offsetX = splitAlongX ? childWidth / 2 : 0
    const offsetY = splitAlongX ? 0 : childHeight / 2
    const children = [-1, 1].map((direction, index) => ({
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}__preloaded_${childPath}${index}`,
      center: {
        x: node.center.x + direction * offsetX,
        y: node.center.y + direction * offsetY,
      },
      width: childWidth,
      height: childHeight,
      availableZ: [...node.availableZ],
      _connectedTo:
        node._connectedTo === undefined ? undefined : [...node._connectedTo],
      _preloadedFixedNetIds:
        node._preloadedFixedNetIds === undefined
          ? undefined
          : [...node._preloadedFixedNetIds],
    }))

    return children.map((child, index) => ({
      f: -(child.width * child.height),
      node: child,
      candidateShapes: intersectingShapes,
      depth: depth + 1,
      childPath: `${childPath}${index}`,
    }))
  }

  private getRefinementSplitAxis(
    node: CapacityMeshNode,
    intersectingShapes: PreloadedTraceShape[],
  ): RefinementAxis {
    const getUnresolvedPartialArea = (splitAxis: RefinementAxis) => {
      const splitAlongX = splitAxis === "x"
      const childWidth = splitAlongX ? node.width / 2 : node.width
      const childHeight = splitAlongX ? node.height : node.height / 2
      const offsetX = splitAlongX ? childWidth / 2 : 0
      const offsetY = splitAlongX ? 0 : childHeight / 2
      let unresolvedPartialArea = 0

      for (const direction of [-1, 1]) {
        const child: CapacityMeshNode = {
          ...node,
          center: {
            x: node.center.x + direction * offsetX,
            y: node.center.y + direction * offsetY,
          },
          width: childWidth,
          height: childHeight,
        }
        for (const shape of intersectingShapes) {
          if (
            !doesRotatedRectIntersectNode(shape.geometry, child) ||
            doesRotatedRectContainNode(shape.geometry, child)
          ) {
            continue
          }
          unresolvedPartialArea += childWidth * childHeight
        }
      }

      return unresolvedPartialArea
    }

    const getContainmentBenefit = (splitAxis: RefinementAxis) => {
      let benefit = 0
      for (const shape of intersectingShapes) {
        const rect = shape.geometry
        const deltaX = node.center.x - rect.center.x
        const deltaY = node.center.y - rect.center.y
        const projectedOnRectX = Math.abs(
          deltaX * rect.unitX.x + deltaY * rect.unitX.y,
        )
        const projectedOnRectY = Math.abs(
          deltaX * rect.unitY.x + deltaY * rect.unitY.y,
        )
        const overflowOnRectX = Math.max(
          0,
          projectedOnRectX +
            (node.width / 2) * Math.abs(rect.unitX.x) +
            (node.height / 2) * Math.abs(rect.unitX.y) -
            rect.halfWidth,
        )
        const overflowOnRectY = Math.max(
          0,
          projectedOnRectY +
            (node.width / 2) * Math.abs(rect.unitY.x) +
            (node.height / 2) * Math.abs(rect.unitY.y) -
            rect.halfHeight,
        )
        const splitExtentReduction =
          splitAxis === "x" ? node.width / 4 : node.height / 4
        const rectXReduction =
          splitExtentReduction *
          Math.abs(splitAxis === "x" ? rect.unitX.x : rect.unitX.y)
        const rectYReduction =
          splitExtentReduction *
          Math.abs(splitAxis === "x" ? rect.unitY.x : rect.unitY.y)
        benefit +=
          Math.min(overflowOnRectX, rectXReduction) +
          Math.min(overflowOnRectY, rectYReduction)
      }
      return benefit
    }

    const xPartialArea = getUnresolvedPartialArea("x")
    const yPartialArea = getUnresolvedPartialArea("y")
    if (xPartialArea + GEOMETRIC_TOLERANCE < yPartialArea) {
      return "x"
    }
    if (yPartialArea + GEOMETRIC_TOLERANCE < xPartialArea) {
      return "y"
    }
    const xContainmentBenefit = getContainmentBenefit("x")
    const yContainmentBenefit = getContainmentBenefit("y")
    if (xContainmentBenefit > yContainmentBenefit + GEOMETRIC_TOLERANCE) {
      return "x"
    }
    if (yContainmentBenefit > xContainmentBenefit + GEOMETRIC_TOLERANCE) {
      return "y"
    }
    return node.width >= node.height ? "x" : "y"
  }

  private getIndexedTraceShapesForNode(
    node: CapacityMeshNode,
  ): PreloadedTraceShape[] {
    return this.traceShapeIndex.search(
      node.center.x - node.width / 2,
      node.center.y - node.height / 2,
      node.center.x + node.width / 2,
      node.center.y + node.height / 2,
    )
  }

  private getSemanticNodeReservationShapes(
    node: CapacityMeshNode,
    intersectingShapes: PreloadedTraceShape[],
    containingShapes: PreloadedTraceShape[],
  ): PreloadedTraceShape[] {
    const containingShapeSet = new Set(containingShapes)

    return intersectingShapes.filter(
      (shape) =>
        containingShapeSet.has(shape) ||
        this.doesShapeMatchContainedSemanticTarget(node, shape),
    )
  }

  private doesShapeMatchContainedSemanticTarget(
    node: CapacityMeshNode,
    shape: PreloadedTraceShape,
  ): boolean {
    if (node._targetConnectionName) {
      const targetConnection = this.srj.connections.find((connection) => {
        const aliases = new Set([
          connection.name,
          connection.__netConnectionName,
          ...(connection.__rootConnectionNames ?? []),
        ])
        return aliases.has(node._targetConnectionName!)
      })
      const canonicalTargetNet = targetConnection
        ? getCanonicalSimpleRouteConnectionName(targetConnection)
        : node._targetConnectionName
      return canonicalTargetNet === shape.fixedNetId
    }

    const minX = node.center.x - node.width / 2 - GEOMETRIC_TOLERANCE
    const maxX = node.center.x + node.width / 2 + GEOMETRIC_TOLERANCE
    const minY = node.center.y - node.height / 2 - GEOMETRIC_TOLERANCE
    const maxY = node.center.y + node.height / 2 + GEOMETRIC_TOLERANCE

    return this.srj.connections.some(
      (connection) =>
        getCanonicalSimpleRouteConnectionName(connection) ===
          shape.fixedNetId &&
        connection.pointsToConnect.some((point) => {
          if (
            point.x < minX ||
            point.x > maxX ||
            point.y < minY ||
            point.y > maxY
          ) {
            return false
          }
          const pointZLayers = getUniqueValidZLayersFromLayerNames(
            getConnectionPointLayers(point),
            this.srj.layerCount,
          )
          return pointZLayers.some(
            (z) => node.availableZ.includes(z) && shape.zLayers.includes(z),
          )
        }),
    )
  }

  private projectNodesWithBoundedRefinement(): {
    refinementBudgetExhausted: boolean
    refinementSplitCount: number
    refinementWorstCaseOutputNodeCount: number
    effectiveMaxOutputNodeCount: number
    minimumLayerSplitNodeCount: number
    minimumRefinementWorstCaseAllowance: number
  } {
    const minimumLayerSplitNodeCount = this.inputNodes.reduce(
      (count, node) => count + Math.max(1, node.availableZ.length),
      0,
    )
    const minimumRefinementWorstCaseAllowance =
      this.maxCompensatedOutputNodeCount === undefined
        ? MIN_REFINEMENT_WORST_CASE_ALLOWANCE
        : 0
    const requestedMaxOutputNodeCount =
      this.maxCompensatedOutputNodeCount ??
      Math.max(
        BASE_MAX_COMPENSATED_OUTPUT_NODE_COUNT,
        minimumLayerSplitNodeCount + minimumRefinementWorstCaseAllowance,
      )
    const effectiveMaxOutputNodeCount = Math.max(
      requestedMaxOutputNodeCount,
      minimumLayerSplitNodeCount,
    )
    let refinementWorstCaseOutputNodeCount = minimumLayerSplitNodeCount
    let refinementBudgetExhausted = false
    let refinementSplitCount = 0
    // Refine the largest unresolved cells first. A hard cap necessarily leaves
    // some partial intersections conservatively reserved; prioritizing by area
    // prevents input ordering from turning a grazing trace into an arbitrarily
    // large blocked region.
    const pending = new PriorityQueue<PendingRefinement>(
      this.inputNodes.map((node) => ({
        f: -(node.width * node.height),
        node,
        candidateShapes: this.getIndexedTraceShapesForNode(node),
        depth: 0,
        childPath: "",
      })),
      effectiveMaxOutputNodeCount + this.inputNodes.length,
    )

    while (!pending.isEmpty()) {
      const task = pending.dequeue()!
      const { node, candidateShapes, depth } = task
      const intersectingShapes = candidateShapes.filter(
        (shape) =>
          node.availableZ.some((z) => shape.zLayers.includes(z)) &&
          doesRotatedRectIntersectNode(shape.geometry, node),
      )
      if (intersectingShapes.length === 0) {
        this.outputNodes.push(node)
        continue
      }

      const containingShapes = intersectingShapes.filter((shape) =>
        doesRotatedRectContainNode(shape.geometry, node),
      )
      if (containingShapes.length === intersectingShapes.length) {
        this.outputNodes.push(
          ...this.reserveNodeByTraceLayerConnectivity(node, containingShapes),
        )
        continue
      }

      const targetCellDimension = Math.min(
        ...intersectingShapes.map((shape) => shape.refinementCellDimension),
      )
      const splitAxis = this.getRefinementSplitAxis(node, intersectingShapes)
      const reachedRefinementFloor =
        depth >= MAX_REFINEMENT_DEPTH ||
        (splitAxis === "x"
          ? node.width <= targetCellDimension
          : node.height <= targetCellDimension)
      const layerSplitCost = Math.max(1, node.availableZ.length)
      const canSplitWithinBudget =
        refinementWorstCaseOutputNodeCount + layerSplitCost <=
        effectiveMaxOutputNodeCount

      if (node._containsTarget || node._isComponentTopologyNode) {
        // Target/component nodes are semantic routing regions, not ordinary
        // geometric cells. They can intentionally span a large component
        // area, so promoting a nearby trace's partial overlap to ownership of
        // the whole node can steal an unrelated terminal. Keep full coverage
        // and same-net partial coverage; later geometric routing stages still
        // receive the exact preloaded trace obstacles.
        this.outputNodes.push(
          ...this.reserveNodeByTraceLayerConnectivity(
            node,
            this.getSemanticNodeReservationShapes(
              node,
              intersectingShapes,
              containingShapes,
            ),
          ),
        )
        continue
      }

      if (reachedRefinementFloor || !canSplitWithinBudget) {
        if (!canSplitWithinBudget && !reachedRefinementFloor) {
          refinementBudgetExhausted = true
        }
        // A partially intersecting cell cannot be left free: at the
        // refinement floor (or budget), reserve it conservatively.
        this.outputNodes.push(
          ...this.reserveNodeByTraceLayerConnectivity(node, intersectingShapes),
        )
        continue
      }

      refinementWorstCaseOutputNodeCount += layerSplitCost
      refinementSplitCount++
      for (const childTask of this.splitRefinementTask(
        task,
        intersectingShapes,
        splitAxis,
      )) {
        pending.enqueue(childTask)
      }
    }

    return {
      refinementBudgetExhausted,
      refinementSplitCount,
      refinementWorstCaseOutputNodeCount,
      effectiveMaxOutputNodeCount,
      minimumLayerSplitNodeCount,
      minimumRefinementWorstCaseAllowance,
    }
  }

  override _step(): void {
    const refinementStats = this.projectNodesWithBoundedRefinement()
    const projectedNodes = this.outputNodes.filter(
      (node) => (node._preloadedFixedNetIds?.length ?? 0) > 0,
    )
    const traceRegionAssignmentCount = projectedNodes.reduce(
      (count, node) => count + (node._preloadedFixedNetIds?.length ?? 0),
      0,
    )

    this.stats = {
      preloadedTraceCount: this.srj.traces?.length ?? 0,
      preloadedTraceShapeCount: this.traceShapes.length,
      inputNodeCount: this.inputNodes.length,
      outputNodeCount: this.outputNodes.length,
      refinedNodeCount: this.outputNodes.length - this.inputNodes.length,
      projectedNodeCount: projectedNodes.length,
      traceRegionAssignmentCount,
      usedContainmentCompensation: true,
      compensatedOutputNodeCount: this.outputNodes.length,
      ...refinementStats,
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
