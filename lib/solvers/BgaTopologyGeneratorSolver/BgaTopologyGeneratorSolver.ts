import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  clusterAxisValues,
  createMeshNodesForSrj,
  getLayerRange,
  getObstacleAvailableZ,
} from "./bgpTopologyGeneratorShared"

export interface BgaTopologyGeneratorSolverParams
  extends TopologyGeneratorSolverParams {}

export interface BgaTopologyGeneratorSolverOutput
  extends TopologyGeneratorSolverOutput {
  /** Routing regions derived from obstacle layout. These are not obstacle rectangles. */
  routingRegions: CapacityMeshNode[]
}

interface BgaInitialPatternSolverParams {
  bounds: Bounds
  componentId: string
  componentObstacles: Obstacle[]
  layerCount: number
}

interface BgaInitialPatternSolverOutput {
  routingRegions: CapacityMeshNode[]
  inferredRowCount: number
  inferredColumnCount: number
  diagonalNodeCount: number
  sideNodeCount: number
}

interface BgaObstacleMergeSolverParams {
  componentId: string
  bounds: Bounds
  routingRegions: CapacityMeshNode[]
  ignoredObstacles: Obstacle[]
  inputSrj: SimpleRouteJson
  layerCount: number
}

type BgaObstacleMergeSolverOutput = {
  routingRegions: CapacityMeshNode[]
  replacementObstacleNodeCount: number
  ignoredObstacleCount: number
}

type BgaExpansionSolverParams = {
  componentId: string
  routingRegions: CapacityMeshNode[]
  inputSrj: SimpleRouteJson
}

type BgaExpansionSolverOutput = {
  routingRegions: CapacityMeshNode[]
  expansionNodeCount: number
}

type BgaSharedNodeMergeSolverParams = {
  routingRegions: CapacityMeshNode[]
}

type BgaSharedNodeMergeSolverOutput = {
  routingRegions: CapacityMeshNode[]
  mergedSharedNodeCount: number
}

function doNodeBoundsOverlap(node: CapacityMeshNode, bounds: Bounds) {
  return doBoundsOverlap(getNodeBounds(node), bounds)
}

function getNodeBounds(node: CapacityMeshNode): Bounds {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

function isValidBounds(bounds: Bounds) {
  return bounds.maxX - bounds.minX > 1e-6 && bounds.maxY - bounds.minY > 1e-6
}

function haveSameAvailableZ(nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) {
  return (
    nodeA.availableZ.length === nodeB.availableZ.length &&
    nodeA.availableZ.every((z, index) => z === nodeB.availableZ[index])
  )
}

function getAspectRatioScore(width: number, height: number) {
  const longestSide = Math.max(width, height)
  const shortestSide = Math.max(1e-6, Math.min(width, height))
  return longestSide / shortestSide
}

function createMergedNodeFromNodes({
  nodeA,
  nodeB,
}: {
  nodeA: CapacityMeshNode
  nodeB: CapacityMeshNode
}): CapacityMeshNode {
  const boundsA = getNodeBounds(nodeA)
  const boundsB = getNodeBounds(nodeB)
  const mergedBounds = {
    minX: Math.min(boundsA.minX, boundsB.minX),
    maxX: Math.max(boundsA.maxX, boundsB.maxX),
    minY: Math.min(boundsA.minY, boundsB.minY),
    maxY: Math.max(boundsA.maxY, boundsB.maxY),
  }

  return {
    ...nodeA,
    capacityMeshNodeId: `${nodeA.capacityMeshNodeId}__merged__${nodeB.capacityMeshNodeId}`,
    center: {
      x: (mergedBounds.minX + mergedBounds.maxX) / 2,
      y: (mergedBounds.minY + mergedBounds.maxY) / 2,
    },
    width: mergedBounds.maxX - mergedBounds.minX,
    height: mergedBounds.maxY - mergedBounds.minY,
  }
}

function getMergeCandidate(
  nodeA: CapacityMeshNode,
  nodeB: CapacityMeshNode,
): CapacityMeshNode | null {
  if (!haveSameAvailableZ(nodeA, nodeB)) return null
  if (!areNodesBordering(nodeA, nodeB)) return null

  const boundsA = getNodeBounds(nodeA)
  const boundsB = getNodeBounds(nodeB)
  const horizontalMerge =
    Math.abs(boundsA.minY - boundsB.minY) < 1e-6 &&
    Math.abs(boundsA.maxY - boundsB.maxY) < 1e-6 &&
    (Math.abs(boundsA.maxX - boundsB.minX) < 1e-6 ||
      Math.abs(boundsB.maxX - boundsA.minX) < 1e-6)
  const verticalMerge =
    Math.abs(boundsA.minX - boundsB.minX) < 1e-6 &&
    Math.abs(boundsA.maxX - boundsB.maxX) < 1e-6 &&
    (Math.abs(boundsA.maxY - boundsB.minY) < 1e-6 ||
      Math.abs(boundsB.maxY - boundsA.minY) < 1e-6)

  if (!horizontalMerge && !verticalMerge) return null

  return createMergedNodeFromNodes({
    nodeA,
    nodeB,
  })
}

function getAxisOverlap(
  rangeA: { min: number; max: number },
  rangeB: { min: number; max: number },
) {
  return Math.min(rangeA.max, rangeB.max) - Math.max(rangeA.min, rangeB.min)
}

function doNodeRectsOverlap(nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) {
  const boundsA = getNodeBounds(nodeA)
  const boundsB = getNodeBounds(nodeB)
  const overlapWidth =
    Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX)
  const overlapHeight =
    Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY)

  return overlapWidth > 1e-6 && overlapHeight > 1e-6
}

function areSameNumberSets(valuesA: number[], valuesB: number[]) {
  return (
    valuesA.length === valuesB.length &&
    valuesA.every((value, index) => value === valuesB[index])
  )
}

function isFullLayerRange(values: number[], layerCount: number) {
  return areSameNumberSets(values, getLayerRange(layerCount))
}

function expandNodeToSingleLayerNodes(node: CapacityMeshNode) {
  return node.availableZ.map((z) => ({
    ...node,
    capacityMeshNodeId: `${node.capacityMeshNodeId}:z${z}`,
    availableZ: [z],
    layer: `z${z}`,
  }))
}

/** Resolves an obstacle's blocked z values in the solver's local BGA z-space. */
function getLocalObstacleAvailableZ(obstacle: Obstacle, layerCount: number) {
  return getObstacleAvailableZ(obstacle, layerCount)
}

function mergeOverlappingObstacles(obstacles: Obstacle[], layerCount: number) {
  let mergeCandidates = obstacles.map((obstacle) => structuredClone(obstacle))
  let didMerge = true

  while (didMerge) {
    didMerge = false

    for (let indexA = 0; indexA < mergeCandidates.length; indexA++) {
      for (let indexB = indexA + 1; indexB < mergeCandidates.length; indexB++) {
        const obstacleA = mergeCandidates[indexA]!
        const obstacleB = mergeCandidates[indexB]!
        const obstacleAZ = getLocalObstacleAvailableZ(obstacleA, layerCount)
        const obstacleBZ = getLocalObstacleAvailableZ(obstacleB, layerCount)

        if (!areSameNumberSets(obstacleAZ, obstacleBZ)) continue
        if (
          !doBoundsOverlap(getBoundingBox(obstacleA), getBoundingBox(obstacleB))
        ) {
          continue
        }

        const mergedBounds = getBoundingBox({
          center: obstacleA.center,
          width: obstacleA.width,
          height: obstacleA.height,
        })
        const obstacleBBounds = getBoundingBox(obstacleB)
        mergedBounds.minX = Math.min(mergedBounds.minX, obstacleBBounds.minX)
        mergedBounds.maxX = Math.max(mergedBounds.maxX, obstacleBBounds.maxX)
        mergedBounds.minY = Math.min(mergedBounds.minY, obstacleBBounds.minY)
        mergedBounds.maxY = Math.max(mergedBounds.maxY, obstacleBBounds.maxY)

        const mergedObstacle: Obstacle = {
          ...obstacleA,
          center: {
            x: (mergedBounds.minX + mergedBounds.maxX) / 2,
            y: (mergedBounds.minY + mergedBounds.maxY) / 2,
          },
          width: mergedBounds.maxX - mergedBounds.minX,
          height: mergedBounds.maxY - mergedBounds.minY,
          layers: obstacleAZ.map((z) => mapZToLayerName(z, layerCount)),
          zLayers: obstacleAZ,
        }

        mergeCandidates = mergeCandidates.filter(
          (_, index) => index !== indexA && index !== indexB,
        )
        mergeCandidates.push(mergedObstacle)
        didMerge = true
        break
      }

      if (didMerge) break
    }
  }

  return mergeCandidates
}

function mergeNodesGreedily({
  nodes,
  getCandidate,
}: {
  nodes: CapacityMeshNode[]
  getCandidate: (
    nodeA: CapacityMeshNode,
    nodeB: CapacityMeshNode,
  ) => CapacityMeshNode | null
}) {
  let mergeCandidates = nodes.map((node) => ({
    ...node,
    center: { ...node.center },
    availableZ: [...node.availableZ],
  }))
  let mergedNodeCount = 0
  let didMerge = true

  while (didMerge) {
    didMerge = false
    let bestPair: {
      indexA: number
      indexB: number
      mergedNode: CapacityMeshNode
      aspectRatioScore: number
    } | null = null

    for (let indexA = 0; indexA < mergeCandidates.length; indexA++) {
      for (let indexB = indexA + 1; indexB < mergeCandidates.length; indexB++) {
        const mergedNode = getCandidate(
          mergeCandidates[indexA]!,
          mergeCandidates[indexB]!,
        )

        if (!mergedNode) continue

        const aspectRatioScore = getAspectRatioScore(
          mergedNode.width,
          mergedNode.height,
        )

        if (
          !bestPair ||
          aspectRatioScore < bestPair.aspectRatioScore - 1e-6 ||
          (Math.abs(aspectRatioScore - bestPair.aspectRatioScore) < 1e-6 &&
            mergedNode.width * mergedNode.height >
              bestPair.mergedNode.width * bestPair.mergedNode.height)
        ) {
          bestPair = {
            indexA,
            indexB,
            mergedNode,
            aspectRatioScore,
          }
        }
      }
    }

    if (!bestPair) continue

    mergeCandidates = mergeCandidates.filter(
      (_, index) => index !== bestPair.indexA && index !== bestPair.indexB,
    )
    mergeCandidates.push(bestPair.mergedNode)
    mergedNodeCount += 1
    didMerge = true
  }

  return {
    nodes: mergeCandidates,
    mergedNodeCount,
  }
}

type EdgeDirection = "left" | "right" | "top" | "bottom"
type EdgeSegment = {
  obstacleNodeId: string
  direction: EdgeDirection
  start: { x: number; y: number }
  end: { x: number; y: number }
}

function getEdgeMidpoint(
  node: CapacityMeshNode,
  direction: EdgeDirection,
): { x: number; y: number } {
  const bounds = getNodeBounds(node)

  if (direction === "left") {
    return { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 }
  }
  if (direction === "right") {
    return { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 }
  }
  if (direction === "top") {
    return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY }
  }

  return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY }
}

function createExpansionNode({
  obstacleNode,
  bounds,
}: {
  obstacleNode: CapacityMeshNode
  bounds: Bounds
}): CapacityMeshNode | null {
  if (!isValidBounds(bounds)) return null

  return createNodeFromBounds({
    nodeId: `${obstacleNode.capacityMeshNodeId}:expansion`,
    bounds,
    availableZ: [...obstacleNode.availableZ],
    containsObstacle: false,
  })
}

function isReplacementObstacleNode(node: CapacityMeshNode) {
  return node.capacityMeshNodeId.includes("replacement-obstacle")
}

function hasClearExpansionCorridor({
  sourceObstacleNode,
  candidateExpansionNode,
  obstacleNodes,
  routingNodes,
  expansionNodes,
}: {
  sourceObstacleNode: CapacityMeshNode
  candidateExpansionNode: CapacityMeshNode
  obstacleNodes: CapacityMeshNode[]
  routingNodes: CapacityMeshNode[]
  expansionNodes: CapacityMeshNode[]
}) {
  const candidateBounds = getNodeBounds(candidateExpansionNode)

  const overlapsOtherObstacle = obstacleNodes.some((obstacleNode) => {
    if (
      obstacleNode.capacityMeshNodeId === sourceObstacleNode.capacityMeshNodeId
    ) {
      return false
    }

    const obstacleBounds = getNodeBounds(obstacleNode)
    const overlapWidth =
      Math.min(candidateBounds.maxX, obstacleBounds.maxX) -
      Math.max(candidateBounds.minX, obstacleBounds.minX)
    const overlapHeight =
      Math.min(candidateBounds.maxY, obstacleBounds.maxY) -
      Math.max(candidateBounds.minY, obstacleBounds.minY)

    return overlapWidth > 1e-6 && overlapHeight > 1e-6
  })

  if (overlapsOtherObstacle) return false

  const overlapsOtherFreeNode = routingNodes.some((freeNode) => {
    const freeNodeBounds = getNodeBounds(freeNode)
    const overlapWidth =
      Math.min(candidateBounds.maxX, freeNodeBounds.maxX) -
      Math.max(candidateBounds.minX, freeNodeBounds.minX)
    const overlapHeight =
      Math.min(candidateBounds.maxY, freeNodeBounds.maxY) -
      Math.max(candidateBounds.minY, freeNodeBounds.minY)

    return overlapWidth > 1e-6 && overlapHeight > 1e-6
  })

  if (overlapsOtherFreeNode) return false

  const overlapsExistingExpansion = expansionNodes.some((expansionNode) => {
    const expansionBounds = getNodeBounds(expansionNode)
    const overlapWidth =
      Math.min(candidateBounds.maxX, expansionBounds.maxX) -
      Math.max(candidateBounds.minX, expansionBounds.minX)
    const overlapHeight =
      Math.min(candidateBounds.maxY, expansionBounds.maxY) -
      Math.max(candidateBounds.minY, expansionBounds.minY)

    return overlapWidth > 1e-6 && overlapHeight > 1e-6
  })

  return !overlapsExistingExpansion
}

function mergeIntervals(
  intervals: Array<{ min: number; max: number }>,
): Array<{ min: number; max: number }> {
  if (intervals.length === 0) return []

  const sortedIntervals = [...intervals].sort((a, b) => a.min - b.min)
  const mergedIntervals: Array<{ min: number; max: number }> = [
    { ...sortedIntervals[0]! },
  ]

  for (let index = 1; index < sortedIntervals.length; index++) {
    const currentInterval = sortedIntervals[index]!
    const lastInterval = mergedIntervals[mergedIntervals.length - 1]!

    if (currentInterval.min <= lastInterval.max + 1e-6) {
      lastInterval.max = Math.max(lastInterval.max, currentInterval.max)
    } else {
      mergedIntervals.push({ ...currentInterval })
    }
  }

  return mergedIntervals
}

function createEdgeFillExpansionNodes({
  obstacleNode,
  routingNodes,
  direction,
}: {
  obstacleNode: CapacityMeshNode
  routingNodes: CapacityMeshNode[]
  direction: EdgeDirection
}): CapacityMeshNode[] {
  const obstacleBounds = getNodeBounds(obstacleNode)
  const candidates = routingNodes
    .map((node) => {
      const nodeBounds = getNodeBounds(node)

      if (direction === "left") {
        const overlap = getAxisOverlap(
          { min: nodeBounds.minY, max: nodeBounds.maxY },
          { min: obstacleBounds.minY, max: obstacleBounds.maxY },
        )
        const distance = obstacleBounds.minX - nodeBounds.maxX
        return overlap > 1e-6 && distance > 1e-6
          ? {
              distance,
              interval: {
                min: Math.max(obstacleBounds.minY, nodeBounds.minY),
                max: Math.min(obstacleBounds.maxY, nodeBounds.maxY),
              },
              farEdge: nodeBounds.maxX,
            }
          : null
      }

      if (direction === "right") {
        const overlap = getAxisOverlap(
          { min: nodeBounds.minY, max: nodeBounds.maxY },
          { min: obstacleBounds.minY, max: obstacleBounds.maxY },
        )
        const distance = nodeBounds.minX - obstacleBounds.maxX
        return overlap > 1e-6 && distance > 1e-6
          ? {
              distance,
              interval: {
                min: Math.max(obstacleBounds.minY, nodeBounds.minY),
                max: Math.min(obstacleBounds.maxY, nodeBounds.maxY),
              },
              farEdge: nodeBounds.minX,
            }
          : null
      }

      if (direction === "top") {
        const overlap = getAxisOverlap(
          { min: nodeBounds.minX, max: nodeBounds.maxX },
          { min: obstacleBounds.minX, max: obstacleBounds.maxX },
        )
        const distance = nodeBounds.minY - obstacleBounds.maxY
        return overlap > 1e-6 && distance > 1e-6
          ? {
              distance,
              interval: {
                min: Math.max(obstacleBounds.minX, nodeBounds.minX),
                max: Math.min(obstacleBounds.maxX, nodeBounds.maxX),
              },
              farEdge: nodeBounds.minY,
            }
          : null
      }

      const overlap = getAxisOverlap(
        { min: nodeBounds.minX, max: nodeBounds.maxX },
        { min: obstacleBounds.minX, max: obstacleBounds.maxX },
      )
      const distance = obstacleBounds.minY - nodeBounds.maxY
      return overlap > 1e-6 && distance > 1e-6
        ? {
            distance,
            interval: {
              min: Math.max(obstacleBounds.minX, nodeBounds.minX),
              max: Math.min(obstacleBounds.maxX, nodeBounds.maxX),
            },
            farEdge: nodeBounds.maxY,
          }
        : null
    })
    .filter(
      (
        candidate,
      ): candidate is {
        distance: number
        interval: { min: number; max: number }
        farEdge: number
      } => Boolean(candidate),
    )

  if (candidates.length === 0) return []

  const minDistance = Math.min(
    ...candidates.map((candidate) => candidate.distance),
  )
  const frontCandidates = candidates.filter(
    (candidate) => Math.abs(candidate.distance - minDistance) <= 1e-6,
  )
  const mergedIntervals = mergeIntervals(
    frontCandidates.map((candidate) => candidate.interval),
  )

  return mergedIntervals
    .map((interval, index) => {
      const bounds =
        direction === "left"
          ? {
              minX: obstacleBounds.minX - minDistance,
              maxX: obstacleBounds.minX,
              minY: interval.min,
              maxY: interval.max,
            }
          : direction === "right"
            ? {
                minX: obstacleBounds.maxX,
                maxX: obstacleBounds.maxX + minDistance,
                minY: interval.min,
                maxY: interval.max,
              }
            : direction === "top"
              ? {
                  minX: interval.min,
                  maxX: interval.max,
                  minY: obstacleBounds.maxY,
                  maxY: obstacleBounds.maxY + minDistance,
                }
              : {
                  minX: interval.min,
                  maxX: interval.max,
                  minY: obstacleBounds.minY - minDistance,
                  maxY: obstacleBounds.minY,
                }

      const expansionNode = createExpansionNode({
        obstacleNode,
        bounds,
      })

      if (!expansionNode) return null

      return {
        ...expansionNode,
        capacityMeshNodeId: `${obstacleNode.capacityMeshNodeId}:expansion:${direction}:${index}`,
      }
    })
    .filter((node): node is CapacityMeshNode => Boolean(node))
}

function createNodeFromBounds({
  nodeId,
  bounds,
  availableZ,
  containsObstacle,
}: {
  nodeId: string
  bounds: Bounds
  availableZ: number[]
  containsObstacle: boolean
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: nodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: `z${availableZ.join(",")}`,
    availableZ: [...availableZ],
    _containsObstacle: containsObstacle,
  }
}

class BgaInitialPatternSolver extends BaseSolver {
  private output: BgaInitialPatternSolverOutput | null = null

  constructor(public readonly params: BgaInitialPatternSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    const availableZ = getLayerRange(this.params.layerCount)
    const rowCount = clusterAxisValues(
      this.params.componentObstacles.map((obstacle) => obstacle.center.y),
    ).length
    const colCount = clusterAxisValues(
      this.params.componentObstacles.map((obstacle) => obstacle.center.x),
    ).length
    const routingRegions = createMeshNodesForSrj({
      bounds: this.params.bounds,
      obstacles: this.params.componentObstacles,
      availableZ,
      layerCount: this.params.layerCount,
      nodeScopeId: this.params.componentId,
      rowCount,
      colCount,
    })
    const diagonalNodeCount = routingRegions.filter(
      (node) => node.availableZ.length > 1 && !node._containsObstacle,
    ).length

    this.output = {
      routingRegions,
      inferredRowCount: rowCount,
      inferredColumnCount: colCount,
      diagonalNodeCount,
      sideNodeCount: routingRegions.filter(
        (node) => node.availableZ.length === 1 && !node._containsObstacle,
      ).length,
    }
    this.stats = {
      inferredRowCount: rowCount,
      inferredColumnCount: colCount,
      diagonalNodeCount,
      sideNodeCount: this.output.sideNodeCount,
      routingRegionCount: routingRegions.length,
    }
    this.solved = true
  }

  getOutput(): BgaInitialPatternSolverOutput {
    if (!this.output) {
      throw new Error("BgaInitialPatternSolver has not solved yet")
    }

    return this.output
  }
}

class BgaObstacleMergeSolver extends BaseSolver {
  private output: BgaObstacleMergeSolverOutput | null = null
  private initialized = false
  private workingRoutingRegions: CapacityMeshNode[] = []
  private ignoredObstaclesToMerge: Obstacle[] = []
  private replacementObstacleNodeCount = 0
  private actionQueue: Array<
    | {
        type: "inspect-obstacle"
        obstacle: Obstacle
      }
    | {
        type: "trim-node"
        obstacle: Obstacle
        nodeId: string
      }
    | {
        type: "insert-obstacle-node"
        obstacle: Obstacle
        obstacleIndex: number
      }
  > = []
  private activeAction:
    | {
        type: "inspect-obstacle"
        obstacle: Obstacle
      }
    | {
        type: "trim-node"
        obstacle: Obstacle
        nodeId: string
      }
    | {
        type: "insert-obstacle-node"
        obstacle: Obstacle
        obstacleIndex: number
      }
    | null = null

  constructor(public readonly params: BgaObstacleMergeSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    if (!this.initialized) {
      this.initializeQueue()
      if (this.actionQueue.length === 0) {
        this.output = {
          routingRegions: this.params.routingRegions,
          replacementObstacleNodeCount: 0,
          ignoredObstacleCount: this.params.ignoredObstacles.length,
        }
        this.stats = this.output
        this.solved = true
        return
      }
    }

    const nextAction = this.actionQueue.shift()
    if (!nextAction) {
      this.output = {
        routingRegions: this.workingRoutingRegions,
        replacementObstacleNodeCount: this.replacementObstacleNodeCount,
        ignoredObstacleCount: this.params.ignoredObstacles.length,
      }
      this.stats = {
        ...this.output,
        remainingActionCount: 0,
      }
      this.solved = true
      return
    }

    this.activeAction = nextAction

    if (nextAction.type === "trim-node") {
      const matchingNodeIndexes = this.workingRoutingRegions.flatMap(
        (node, index) =>
          node.capacityMeshNodeId === nextAction.nodeId ||
          node.capacityMeshNodeId.startsWith(`${nextAction.nodeId}:z`)
            ? [index]
            : [],
      )
      for (const nodeIndex of [...matchingNodeIndexes].sort((a, b) => b - a)) {
        const node = this.workingRoutingRegions[nodeIndex]!
        if (node._containsObstacle) continue
        const blockedZForNode = getLocalObstacleAvailableZ(
          nextAction.obstacle,
          this.params.layerCount,
        ).filter((z) => node.availableZ.includes(z))

        if (blockedZForNode.length > 0) {
          const remainingZ = node.availableZ.filter(
            (z) => !blockedZForNode.includes(z),
          )

          if (remainingZ.length === 0) {
            this.workingRoutingRegions.splice(nodeIndex, 1)
          } else if (
            remainingZ.length > 1 &&
            !isFullLayerRange(remainingZ, this.params.layerCount)
          ) {
            const remainingNode = {
              ...node,
              availableZ: remainingZ,
              layer: `z${remainingZ.join(",")}`,
            }
            this.workingRoutingRegions.splice(
              nodeIndex,
              1,
              ...expandNodeToSingleLayerNodes(remainingNode),
            )
          } else {
            this.workingRoutingRegions[nodeIndex] = {
              ...node,
              availableZ: remainingZ,
              layer: `z${remainingZ.join(",")}`,
            }
          }
        }
      }
    } else if (nextAction.type === "insert-obstacle-node") {
      this.workingRoutingRegions.push(
        createNodeFromBounds({
          nodeId: `bgp:${this.params.componentId}:replacement-obstacle:${
            nextAction.obstacle.obstacleId ?? nextAction.obstacleIndex
          }`,
          bounds: getBoundingBox(nextAction.obstacle),
          availableZ: getLocalObstacleAvailableZ(
            nextAction.obstacle,
            this.params.layerCount,
          ),
          containsObstacle: true,
        }),
      )
      this.replacementObstacleNodeCount += 1
    }

    this.stats = {
      queuedObstacleCount: this.ignoredObstaclesToMerge.length,
      replacementObstacleNodeCount: this.replacementObstacleNodeCount,
      ignoredObstacleCount: this.params.ignoredObstacles.length,
      remainingActionCount: this.actionQueue.length,
      activeActionType: nextAction.type,
      activeObstacleId: nextAction.obstacle.obstacleId ?? null,
      activeNodeId: nextAction.type === "trim-node" ? nextAction.nodeId : null,
    }
  }

  getOutput(): BgaObstacleMergeSolverOutput {
    if (!this.output) {
      throw new Error("BgaObstacleMergeSolver has not solved yet")
    }

    return this.output
  }

  private initializeQueue() {
    this.initialized = true
    this.workingRoutingRegions = this.params.routingRegions.map((node) => ({
      ...node,
      center: { ...node.center },
      availableZ: [...node.availableZ],
    }))
    this.ignoredObstaclesToMerge = mergeOverlappingObstacles(
      this.params.ignoredObstacles,
      this.params.layerCount,
    )

    for (const [
      obstacleIndex,
      obstacle,
    ] of this.ignoredObstaclesToMerge.entries()) {
      this.actionQueue.push({
        type: "inspect-obstacle",
        obstacle,
      })

      for (const node of this.params.routingRegions) {
        if (node._containsObstacle) continue
        if (!doNodeBoundsOverlap(node, getBoundingBox(obstacle))) continue

        this.actionQueue.push({
          type: "trim-node",
          obstacle,
          nodeId: node.capacityMeshNodeId,
        })
      }

      this.actionQueue.push({
        type: "insert-obstacle-node",
        obstacle,
        obstacleIndex,
      })
    }
  }

  override visualize(): GraphicsObject {
    const currentObstacle = this.activeAction?.obstacle ?? null
    const currentNodeId =
      this.activeAction?.type === "trim-node" ? this.activeAction.nodeId : null
    const currentNode = currentNodeId
      ? (this.workingRoutingRegions.find(
          (node) => node.capacityMeshNodeId === currentNodeId,
        ) ?? null)
      : null
    const boardBounds = this.params.inputSrj.bounds
    const boardOutlinePoints = this.params.inputSrj.outline?.length
      ? [...this.params.inputSrj.outline, this.params.inputSrj.outline[0]!]
      : [
          { x: boardBounds.minX, y: boardBounds.minY },
          { x: boardBounds.maxX, y: boardBounds.minY },
          { x: boardBounds.maxX, y: boardBounds.maxY },
          { x: boardBounds.minX, y: boardBounds.maxY },
          { x: boardBounds.minX, y: boardBounds.minY },
        ]
    const backgroundObstacles = this.params.inputSrj.obstacles.filter(
      (obstacle) => obstacle.obstacleId !== currentObstacle?.obstacleId,
    )

    return {
      title: "BGA obstacle merge microsteps",
      rects: [
        {
          center: {
            x: (boardBounds.minX + boardBounds.maxX) / 2,
            y: (boardBounds.minY + boardBounds.maxY) / 2,
          },
          width: boardBounds.maxX - boardBounds.minX,
          height: boardBounds.maxY - boardBounds.minY,
          stroke: "rgba(90, 90, 90, 0.45)",
          fill: "rgba(120, 120, 120, 0.08)",
          label: "board bounds",
        },
        ...backgroundObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          stroke: "rgba(140, 140, 140, 0.55)",
          fill: "rgba(140, 140, 140, 0.14)",
          layer: obstacle.layers.join(","),
          label: obstacle.obstacleId ?? obstacle.componentId ?? "obstacle",
        })),
        ...this.workingRoutingRegions.map((node) => ({
          ...createRectFromCapacityNode(node, {
            rectMargin: 0.01,
            zOffset: 0.02,
          }),
          stroke:
            currentNode?.capacityMeshNodeId === node.capacityMeshNodeId
              ? "rgba(0, 255, 120, 1)"
              : node._containsObstacle
                ? "rgba(255, 0, 0, 1)"
                : node.availableZ.length > 1
                  ? "rgba(0, 90, 220, 0.9)"
                  : "rgba(80, 170, 255, 0.9)",
          fill:
            currentNode?.capacityMeshNodeId === node.capacityMeshNodeId
              ? "rgba(0, 255, 120, 0.28)"
              : node._containsObstacle
                ? "rgba(255, 0, 0, 0.22)"
                : node.availableZ.length > 1
                  ? "rgba(0, 90, 220, 0.22)"
                  : "rgba(80, 170, 255, 0.22)",
        })),
        ...(currentObstacle
          ? [
              {
                center: currentObstacle.center,
                width: currentObstacle.width,
                height: currentObstacle.height,
                stroke: "rgba(255, 230, 0, 1)",
                fill: "rgba(255, 230, 0, 0.12)",
                layer: `z${getObstacleAvailableZ(
                  currentObstacle,
                  this.params.layerCount,
                ).join(",")}`,
                label: `active obstacle: ${currentObstacle.obstacleId ?? "unknown"}`,
              },
            ]
          : []),
      ],
      lines: boardOutlinePoints.slice(0, -1).map((point, index) => ({
        points: [point, boardOutlinePoints[index + 1]!],
        stroke: "rgba(80, 80, 80, 0.8)",
      })),
      points: [],
      circles: [],
      texts: [],
    }
  }
}

class BgaExpansionSolver extends BaseSolver {
  private output: BgaExpansionSolverOutput | null = null
  private initialized = false
  private workingRoutingRegions: CapacityMeshNode[] = []
  private obstacleNodes: CapacityMeshNode[] = []
  private expandableObstacleNodes: CapacityMeshNode[] = []
  private expansionNodes: CapacityMeshNode[] = []
  private actionQueue: Array<{
    obstacleNodeId: string
    direction: EdgeDirection
  }> = []
  private pendingExpansionInsertions: Array<{
    obstacleNodeId: string
    direction: EdgeDirection
    expansionNode: CapacityMeshNode
  }> = []
  private activeAction:
    | {
        type: "inspect-edge"
        obstacleNodeId: string
        direction: EdgeDirection
      }
    | {
        type: "insert-expansion"
        obstacleNodeId: string
        direction: EdgeDirection
        expansionNode: CapacityMeshNode
      }
    | null = null

  constructor(public readonly params: BgaExpansionSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    if (!this.initialized) {
      this.initialized = true
      this.workingRoutingRegions = this.params.routingRegions.map((node) => ({
        ...node,
        center: { ...node.center },
        availableZ: [...node.availableZ],
      }))
      this.obstacleNodes = this.workingRoutingRegions.filter(
        (node) => node._containsObstacle && isReplacementObstacleNode(node),
      )
      this.expandableObstacleNodes = this.obstacleNodes.filter(
        (node) => node.availableZ.length === 1,
      )

      for (const obstacleNode of this.expandableObstacleNodes) {
        for (const direction of ["left", "right", "top", "bottom"] as const) {
          this.actionQueue.push({
            obstacleNodeId: obstacleNode.capacityMeshNodeId,
            direction,
          })
        }
      }

      this.actionQueue.sort((actionA, actionB) => {
        const obstacleNodeA = this.obstacleNodes.find(
          (node) => node.capacityMeshNodeId === actionA.obstacleNodeId,
        )
        const obstacleNodeB = this.obstacleNodes.find(
          (node) => node.capacityMeshNodeId === actionB.obstacleNodeId,
        )
        if (!obstacleNodeA || !obstacleNodeB) return 0

        const pointA = getEdgeMidpoint(obstacleNodeA, actionA.direction)
        const pointB = getEdgeMidpoint(obstacleNodeB, actionB.direction)

        if (Math.abs(pointA.x - pointB.x) > 1e-6) return pointA.x - pointB.x
        if (Math.abs(pointA.y - pointB.y) > 1e-6) return pointA.y - pointB.y

        const directionOrder = {
          left: 0,
          top: 1,
          bottom: 2,
          right: 3,
        } satisfies Record<EdgeDirection, number>

        return (
          directionOrder[actionA.direction] - directionOrder[actionB.direction]
        )
      })
    }

    const pendingInsertion = this.pendingExpansionInsertions.shift()
    if (pendingInsertion) {
      this.activeAction = {
        type: "insert-expansion",
        ...pendingInsertion,
      }
      this.expansionNodes.push(pendingInsertion.expansionNode)
      this.workingRoutingRegions.push(pendingInsertion.expansionNode)
      this.stats = {
        queuedEdgeCount: this.actionQueue.length,
        pendingInsertionCount: this.pendingExpansionInsertions.length,
        expansionNodeCount: this.expansionNodes.length,
        activeActionType: "insert-expansion",
        activeObstacleId: pendingInsertion.obstacleNodeId,
        activeDirection: pendingInsertion.direction,
      }
      return
    }

    const nextEdge = this.actionQueue.shift()
    if (!nextEdge) {
      this.output = {
        routingRegions: this.workingRoutingRegions,
        expansionNodeCount: this.expansionNodes.length,
      }
      this.stats = {
        queuedEdgeCount: 0,
        pendingInsertionCount: 0,
        expansionNodeCount: this.expansionNodes.length,
        activeActionType: null,
      }
      this.solved = true
      return
    }

    this.activeAction = {
      type: "inspect-edge",
      obstacleNodeId: nextEdge.obstacleNodeId,
      direction: nextEdge.direction,
    }

    const obstacleNode =
      this.expandableObstacleNodes.find(
        (node) => node.capacityMeshNodeId === nextEdge.obstacleNodeId,
      ) ?? null
    if (!obstacleNode) return

    const z = obstacleNode.availableZ[0]
    const sameLayerRoutingNodes = this.workingRoutingRegions.filter(
      (node) => !node._containsObstacle && node.availableZ.includes(z),
    )
    const obstacleBounds = getNodeBounds(obstacleNode)
    const direction = nextEdge.direction

    const alreadyTouching = sameLayerRoutingNodes.some((node) => {
      const nodeBounds = getNodeBounds(node)
      if (direction === "left") {
        return (
          Math.abs(nodeBounds.maxX - obstacleBounds.minX) < 1e-6 &&
          getAxisOverlap(
            { min: nodeBounds.minY, max: nodeBounds.maxY },
            { min: obstacleBounds.minY, max: obstacleBounds.maxY },
          ) > 1e-6
        )
      }
      if (direction === "right") {
        return (
          Math.abs(nodeBounds.minX - obstacleBounds.maxX) < 1e-6 &&
          getAxisOverlap(
            { min: nodeBounds.minY, max: nodeBounds.maxY },
            { min: obstacleBounds.minY, max: obstacleBounds.maxY },
          ) > 1e-6
        )
      }
      if (direction === "top") {
        return (
          Math.abs(nodeBounds.minY - obstacleBounds.maxY) < 1e-6 &&
          getAxisOverlap(
            { min: nodeBounds.minX, max: nodeBounds.maxX },
            { min: obstacleBounds.minX, max: obstacleBounds.maxX },
          ) > 1e-6
        )
      }

      return (
        Math.abs(nodeBounds.maxY - obstacleBounds.minY) < 1e-6 &&
        getAxisOverlap(
          { min: nodeBounds.minX, max: nodeBounds.maxX },
          { min: obstacleBounds.minX, max: obstacleBounds.maxX },
        ) > 1e-6
      )
    })

    if (alreadyTouching) {
      this.stats = {
        queuedEdgeCount: this.actionQueue.length,
        pendingInsertionCount: this.pendingExpansionInsertions.length,
        expansionNodeCount: this.expansionNodes.length,
        activeActionType: "inspect-edge",
        activeObstacleId: obstacleNode.capacityMeshNodeId,
        activeDirection: direction,
      }
      return
    }

    const expansionNodes = createEdgeFillExpansionNodes({
      obstacleNode,
      routingNodes: sameLayerRoutingNodes,
      direction,
    })

    for (const expansionNode of expansionNodes) {
      if (
        hasClearExpansionCorridor({
          sourceObstacleNode: obstacleNode,
          candidateExpansionNode: expansionNode,
          obstacleNodes: this.obstacleNodes,
          routingNodes: sameLayerRoutingNodes,
          expansionNodes: this.expansionNodes,
        })
      ) {
        this.pendingExpansionInsertions.push({
          obstacleNodeId: obstacleNode.capacityMeshNodeId,
          direction,
          expansionNode,
        })
      }
    }

    this.stats = {
      queuedEdgeCount: this.actionQueue.length,
      pendingInsertionCount: this.pendingExpansionInsertions.length,
      expansionNodeCount: this.expansionNodes.length,
      activeActionType: "inspect-edge",
      activeObstacleId: obstacleNode.capacityMeshNodeId,
      activeDirection: direction,
      activeTargetNodeId: null,
    }
  }

  getOutput(): BgaExpansionSolverOutput {
    if (!this.output) {
      throw new Error("BgaExpansionSolver has not solved yet")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    const boardBounds = this.params.inputSrj.bounds
    const boardOutlinePoints = this.params.inputSrj.outline?.length
      ? [...this.params.inputSrj.outline, this.params.inputSrj.outline[0]!]
      : [
          { x: boardBounds.minX, y: boardBounds.minY },
          { x: boardBounds.maxX, y: boardBounds.minY },
          { x: boardBounds.maxX, y: boardBounds.maxY },
          { x: boardBounds.minX, y: boardBounds.maxY },
          { x: boardBounds.minX, y: boardBounds.minY },
        ]
    const backgroundObstacles = this.params.inputSrj.obstacles.map(
      (obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        stroke: "rgba(140, 140, 140, 0.55)",
        fill: "rgba(140, 140, 140, 0.14)",
        layer: obstacle.layers.join(","),
        label: obstacle.obstacleId ?? obstacle.componentId ?? "obstacle",
      }),
    )
    const activeObstacleNodeId =
      this.activeAction?.type === "inspect-edge" ||
      this.activeAction?.type === "insert-expansion"
        ? this.activeAction.obstacleNodeId
        : null
    const queuedEdgeKeys = new Set(
      this.actionQueue.map(
        (action) => `${action.obstacleNodeId}:${action.direction}`,
      ),
    )
    const activeEdgeKey =
      this.activeAction?.type === "inspect-edge" ||
      this.activeAction?.type === "insert-expansion"
        ? `${this.activeAction.obstacleNodeId}:${this.activeAction.direction}`
        : null
    const edgeSegments = this.obstacleNodes.flatMap((node) => {
      const bounds = getNodeBounds(node)
      return (["left", "right", "top", "bottom"] as const)
        .map((direction) => {
          const edgeKey = `${node.capacityMeshNodeId}:${direction}`
          if (!queuedEdgeKeys.has(edgeKey) && activeEdgeKey !== edgeKey)
            return null

          if (direction === "left") {
            return {
              obstacleNodeId: node.capacityMeshNodeId,
              direction,
              start: { x: bounds.minX, y: bounds.minY },
              end: { x: bounds.minX, y: bounds.maxY },
            }
          }
          if (direction === "right") {
            return {
              obstacleNodeId: node.capacityMeshNodeId,
              direction,
              start: { x: bounds.maxX, y: bounds.minY },
              end: { x: bounds.maxX, y: bounds.maxY },
            }
          }
          if (direction === "top") {
            return {
              obstacleNodeId: node.capacityMeshNodeId,
              direction,
              start: { x: bounds.minX, y: bounds.maxY },
              end: { x: bounds.maxX, y: bounds.maxY },
            }
          }

          return {
            obstacleNodeId: node.capacityMeshNodeId,
            direction,
            start: { x: bounds.minX, y: bounds.minY },
            end: { x: bounds.maxX, y: bounds.minY },
          }
        })
        .filter((edge): edge is EdgeSegment => Boolean(edge))
    })

    return {
      title: "BGA expansion microsteps",
      rects: [
        {
          center: {
            x: (boardBounds.minX + boardBounds.maxX) / 2,
            y: (boardBounds.minY + boardBounds.maxY) / 2,
          },
          width: boardBounds.maxX - boardBounds.minX,
          height: boardBounds.maxY - boardBounds.minY,
          stroke: "rgba(90, 90, 90, 0.45)",
          fill: "rgba(120, 120, 120, 0.08)",
          label: "board bounds",
        },
        ...backgroundObstacles,
        ...this.workingRoutingRegions.map((node) => ({
          ...createRectFromCapacityNode(node, {
            rectMargin: 0.01,
            zOffset: 0.02,
          }),
          stroke: "rgba(120, 120, 120, 0.7)",
          fill: "rgba(140, 140, 140, 0.16)",
        })),
      ],
      lines: [
        ...boardOutlinePoints.slice(0, -1).map((point, index) => ({
          points: [point, boardOutlinePoints[index + 1]!],
          stroke: "rgba(80, 80, 80, 0.8)",
        })),
        ...edgeSegments.map((edge) => ({
          points: [edge.start, edge.end],
          stroke:
            edge.obstacleNodeId === activeObstacleNodeId &&
            edge.direction === this.activeAction?.direction
              ? "rgba(255, 0, 0, 1)"
              : "rgba(0, 255, 120, 0.75)",
          strokeWidth: 0.05,
        })),
      ],
      points: [],
      circles: [],
      texts: [],
    }
  }
}

class BgaSharedNodeMergeSolver extends BaseSolver {
  private output: BgaSharedNodeMergeSolverOutput | null = null

  constructor(public readonly params: BgaSharedNodeMergeSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    const passthroughNodes = this.params.routingRegions.filter(
      (node) => node._containsObstacle || node.availableZ.length <= 1,
    )
    const mergedSharedNodes = mergeNodesGreedily({
      nodes: this.params.routingRegions.filter(
        (node) => !node._containsObstacle && node.availableZ.length > 1,
      ),
      getCandidate: getMergeCandidate,
    })
    this.output = {
      routingRegions: [...passthroughNodes, ...mergedSharedNodes.nodes],
      mergedSharedNodeCount: mergedSharedNodes.mergedNodeCount,
    }
    this.stats = this.output
    this.solved = true
  }

  getOutput(): BgaSharedNodeMergeSolverOutput {
    if (!this.output) {
      throw new Error("BgaSharedNodeMergeSolver has not solved yet")
    }

    return this.output
  }
}

/**
 * Builds a coarse topology for BGA-style routing from an SRJ obstacle field.
 *
 * Important:
 * - `routingRegions` are derived routing cells and may be larger than pads.
 * - obstacle-overlapping regions are split per layer instead of being emitted
 *   as one multi-layer region.
 */
export class BgaTopologyGeneratorSolver extends BasePipelineSolver<BgaTopologyGeneratorSolverParams> {
  static readonly componentKind = "bga"

  bgaInitialPatternSolver?: BgaInitialPatternSolver
  bgaObstacleMergeSolver?: BgaObstacleMergeSolver
  bgaExpansionSolver?: BgaExpansionSolver
  bgaSharedNodeMergeSolver?: BgaSharedNodeMergeSolver

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "bgaInitialPatternSolver",
      BgaInitialPatternSolver,
      (instance: BgaTopologyGeneratorSolver) => [
        {
          bounds: instance.inputProblem.detectedComponent.bounds,
          componentId: instance.inputProblem.detectedComponent.componentId,
          componentObstacles: instance.getComponentObstacles(),
          layerCount: instance.getLayerCount(),
        },
      ],
    ),
    definePipelineStep(
      "bgaObstacleMergeSolver",
      BgaObstacleMergeSolver,
      (instance: BgaTopologyGeneratorSolver) => [
        {
          componentId: instance.inputProblem.detectedComponent.componentId,
          bounds: instance.inputProblem.detectedComponent.bounds,
          routingRegions:
            instance.getStageOutput<BgaInitialPatternSolverOutput>(
              "bgaInitialPatternSolver",
            )?.routingRegions ?? [],
          ignoredObstacles: instance.getIgnoredObstacles(),
          inputSrj: instance.inputProblem.inputSrj,
          layerCount: instance.getLayerCount(),
        },
      ],
    ),
    definePipelineStep(
      "bgaExpansionSolver",
      BgaExpansionSolver,
      (instance: BgaTopologyGeneratorSolver) => [
        {
          componentId: instance.inputProblem.detectedComponent.componentId,
          routingRegions:
            instance.getStageOutput<BgaObstacleMergeSolverOutput>(
              "bgaObstacleMergeSolver",
            )?.routingRegions ?? [],
          inputSrj: instance.inputProblem.inputSrj,
        },
      ],
    ),
    definePipelineStep(
      "bgaSharedNodeMergeSolver",
      BgaSharedNodeMergeSolver,
      (instance: BgaTopologyGeneratorSolver) => [
        {
          routingRegions:
            instance.getStageOutput<BgaExpansionSolverOutput>(
              "bgaExpansionSolver",
            )?.routingRegions ?? [],
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: BgaTopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  private getLayerCount() {
    return Math.max(1, this.inputProblem.inputSrj.layerCount)
  }

  private getComponentObstacles() {
    return this.inputProblem.inputSrj.obstacles.filter(
      (obstacle) =>
        obstacle.componentId ===
        this.inputProblem.detectedComponent.componentId,
    )
  }

  private getIgnoredObstacles() {
    const { bounds, componentId } = this.inputProblem.detectedComponent

    return this.inputProblem.inputSrj.obstacles.filter(
      (obstacle) =>
        obstacle.componentId !== componentId &&
        doBoundsOverlap(getBoundingBox(obstacle), bounds),
    )
  }

  getOutput(): BgaTopologyGeneratorSolverOutput {
    const initialPatternOutput =
      this.getStageOutput<BgaInitialPatternSolverOutput>(
        "bgaInitialPatternSolver",
      )
    const mergedOutput = this.getStageOutput<BgaObstacleMergeSolverOutput>(
      "bgaObstacleMergeSolver",
    )
    const expansionOutput =
      this.getStageOutput<BgaExpansionSolverOutput>("bgaExpansionSolver")
    const sharedMergeOutput =
      this.getStageOutput<BgaSharedNodeMergeSolverOutput>(
        "bgaSharedNodeMergeSolver",
      )

    if (
      !initialPatternOutput ||
      !mergedOutput ||
      !expansionOutput ||
      !sharedMergeOutput
    ) {
      throw new Error("BgaTopologyGeneratorSolver has not solved yet")
    }

    this.stats = {
      componentId: this.inputProblem.detectedComponent.componentId,
      layerCount: this.getLayerCount(),
      inferredRowCount: initialPatternOutput.inferredRowCount,
      inferredColumnCount: initialPatternOutput.inferredColumnCount,
      diagonalNodeCount: initialPatternOutput.diagonalNodeCount,
      sideNodeCount: initialPatternOutput.sideNodeCount,
      replacementObstacleNodeCount: mergedOutput.replacementObstacleNodeCount,
      expansionNodeCount: expansionOutput.expansionNodeCount,
      mergedSharedNodeCount: sharedMergeOutput.mergedSharedNodeCount,
      ignoredObstacleCount: mergedOutput.ignoredObstacleCount,
      totalMeshNodeCount: sharedMergeOutput.routingRegions.length,
    }

    return {
      routingRegions: sharedMergeOutput.routingRegions,
    }
  }

  override finalVisualize(): GraphicsObject | null {
    const output = this.getOutput()
    const { bounds, outline, obstacles } = this.inputProblem.inputSrj
    const boardOutlinePoints = outline?.length
      ? [...outline, outline[0]!]
      : [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.minY },
        ]
    const backgroundObstacles = obstacles.filter(
      (obstacle) =>
        obstacle.componentId !==
        this.inputProblem.detectedComponent.componentId,
    )

    return {
      title: "BGA topology",
      rects: [
        {
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          stroke: "rgba(90, 90, 90, 0.45)",
          fill: "rgba(120, 120, 120, 0.08)",
          label: "board bounds",
        },
        ...backgroundObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          stroke: "rgba(120, 120, 120, 0.45)",
          fill: "rgba(120, 120, 120, 0.10)",
          layer: obstacle.layers.join(","),
          label: obstacle.obstacleId ?? obstacle.componentId ?? "obstacle",
        })),
        ...output.routingRegions.map((node) => ({
          ...(node.availableZ.length > 1
            ? {
                stroke: "rgba(0, 90, 220, 0.9)",
                fill: "rgba(0, 90, 220, 0.22)",
              }
            : {
                stroke: "rgba(80, 170, 255, 0.9)",
                fill: "rgba(80, 170, 255, 0.22)",
              }),
          ...createRectFromCapacityNode(node, {
            rectMargin: 0.01,
            zOffset: 0.02,
          }),
          stroke: node._containsObstacle
            ? "rgba(255, 0, 0, 1)"
            : node.availableZ.length > 1
              ? "rgba(0, 90, 220, 0.9)"
              : "rgba(80, 170, 255, 0.9)",
          fill: node._containsObstacle
            ? "rgba(255, 0, 0, 0.22)"
            : node.availableZ.length > 1
              ? "rgba(0, 90, 220, 0.22)"
              : "rgba(80, 170, 255, 0.22)",
        })),
      ],
      lines: boardOutlinePoints.slice(0, -1).map((point, index) => ({
        points: [point, boardOutlinePoints[index + 1]!],
        stroke: "rgba(80, 80, 80, 0.8)",
      })),
      points: [],
      circles: [],
      texts: [],
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
