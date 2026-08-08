import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "lib/types"
import type { Obstacle } from "lib/types"
import {
  getObstacleZLayers,
  pointIsBlockedByObstacle,
} from "./ApproximateHypergraphTopologySolver"

export interface ApproximatePortPointLimiterSolverParams {
  sharedEdgeSegments: SharedEdgeSegment[]
  capacityMeshNodes: CapacityMeshNode[]
  maxPortsPerLayerPerEdge: number
  obstacles: Obstacle[]
  layerCount: number
  obstacleSamplingMargin: number
}

const selectEvenlySpaced = <T>(items: T[], limit: number): T[] => {
  if (items.length <= limit) return items
  if (limit === 1) return [items[Math.floor(items.length / 2)]!]

  const selectedIndexes = new Set<number>()
  for (let index = 0; index < limit; index++) {
    selectedIndexes.add(Math.round((index * (items.length - 1)) / (limit - 1)))
  }
  return [...selectedIndexes].map((index) => items[index]!)
}

/** Caps approximate boundary choices while retaining exact component topology. */
export class ApproximatePortPointLimiterSolver extends BaseSolver {
  private output: SharedEdgeSegment[] = []

  constructor(public readonly params: ApproximatePortPointLimiterSolverParams) {
    super()
    this.MAX_ITERATIONS = 1
    if (
      !Number.isInteger(params.maxPortsPerLayerPerEdge) ||
      params.maxPortsPerLayerPerEdge <= 0
    ) {
      throw new Error(
        "Pipeline10 maxPortsPerLayerPerEdge must be a positive integer",
      )
    }
  }

  override getConstructorParams(): [ApproximatePortPointLimiterSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const nodeById = new Map(
      this.params.capacityMeshNodes.map((node) => [
        node.capacityMeshNodeId,
        node,
      ]),
    )
    let inputPortCount = 0
    let outputPortCount = 0
    let preservedExactSegmentCount = 0
    let obstacleRejectedPortCount = 0
    let bridgedObstacleSegmentCount = 0
    const obstacleZLayers = new Map(
      this.params.obstacles.map((obstacle) => [
        obstacle,
        getObstacleZLayers(obstacle, this.params.layerCount),
      ]),
    )

    this.output = this.params.sharedEdgeSegments.map((segment) => {
      inputPortCount += segment.portPoints.length
      const nodes = segment.nodeIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId)
        return node ? [node] : []
      })
      const touchesExactComponent = nodes.some(
        (node) =>
          node._isComponentTopologyNode &&
          !node._isApproximateTerminalRefinement,
      )
      if (touchesExactComponent) {
        outputPortCount += segment.portPoints.length
        preservedExactSegmentCount++
        return segment
      }

      const touchesApproximateTerminal = nodes.some(
        (node) => node._isApproximateTerminalRefinement,
      )
      const candidatePortPoints = touchesApproximateTerminal
        ? segment.portPoints
        : segment.portPoints.flatMap((portPoint) => {
            const availableZ = portPoint.availableZ.filter(
              (z) =>
                !pointIsBlockedByObstacle({
                  point: portPoint,
                  z,
                  obstacles: this.params.obstacles,
                  obstacleZLayers,
                  margin: this.params.obstacleSamplingMargin,
                }),
            )
            if (availableZ.length === 0) {
              obstacleRejectedPortCount++
              return []
            }
            return [{ ...portPoint, availableZ }]
          })

      const portPointsByLayer = new Map<number, typeof segment.portPoints>()
      for (const portPoint of candidatePortPoints) {
        for (const z of portPoint.availableZ) {
          const layerPortPoints = portPointsByLayer.get(z) ?? []
          layerPortPoints.push(portPoint)
          portPointsByLayer.set(z, layerPortPoints)
        }
      }
      const selectedPortPointIds = new Set(
        [...portPointsByLayer.values()].flatMap((layerPortPoints) =>
          selectEvenlySpaced(
            [...layerPortPoints].sort(
              (a, b) =>
                a.x - b.x ||
                a.y - b.y ||
                a.segmentPortPointId.localeCompare(b.segmentPortPointId),
            ),
            this.params.maxPortsPerLayerPerEdge,
          ).map((portPoint) => portPoint.segmentPortPointId),
        ),
      )
      let portPoints = candidatePortPoints.filter((portPoint) =>
        selectedPortPointIds.has(portPoint.segmentPortPointId),
      )
      if (portPoints.length === 0 && segment.portPoints.length > 0) {
        const bridgePort = [...segment.portPoints].sort(
          (a, b) =>
            a.distToCentermostPortOnZ - b.distToCentermostPortOnZ ||
            a.segmentPortPointId.localeCompare(b.segmentPortPointId),
        )[0]!
        portPoints = [
          {
            ...bridgePort,
            tinyHypergraphPortPenalty: Math.max(
              bridgePort.tinyHypergraphPortPenalty ?? 0,
              1_000,
            ),
          },
        ]
        bridgedObstacleSegmentCount++
      }
      outputPortCount += portPoints.length

      return {
        ...segment,
        portPoints,
        availableZ: [
          ...new Set(portPoints.flatMap((portPoint) => portPoint.availableZ)),
        ].sort((a, b) => a - b),
      }
    })
    this.stats = {
      segmentCount: this.output.length,
      inputPortCount,
      outputPortCount,
      removedPortCount: inputPortCount - outputPortCount,
      preservedExactSegmentCount,
      obstacleRejectedPortCount,
      bridgedObstacleSegmentCount,
    }
    this.solved = true
  }

  getOutput(): SharedEdgeSegment[] {
    if (!this.solved) {
      throw new Error(
        "ApproximatePortPointLimiterSolver output requested before solve",
      )
    }
    return this.output
  }

  override visualize(): GraphicsObject {
    return {
      title: `Pipeline10 limited port points (${this.output.reduce((total, segment) => total + segment.portPoints.length, 0)})`,
      points: this.output.flatMap((segment) =>
        segment.portPoints.map((portPoint) => ({
          x: portPoint.x,
          y: portPoint.y,
          color: "#7c3aed",
          label: portPoint.segmentPortPointId,
          layer: `z${portPoint.availableZ[0]}`,
        })),
      ),
      lines: [],
      rects: [],
      circles: [],
    }
  }
}
