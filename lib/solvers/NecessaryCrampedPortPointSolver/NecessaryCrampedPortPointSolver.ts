import { BaseSolver } from "@tscircuit/solver-utils"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { GraphicsObject } from "graphics-debug"
import { getCandidatesAtDepthUsingBfs } from "./getCandidatesAtDepthUsingBfs"
import { isAllCandidatesBlockedByObstacles } from "./isAllCandidatesBlockedByObstacles"
import { costFunction } from "./costFunction"
import {
  DepthLimitedBfsCandidate,
  NecessaryCrampedPortPointSolverInput,
} from "./types"

/**
 * This solver filters out cramped port points that are not necessary.
 */
export class NecessaryCrampedPortPointSolver extends BaseSolver {
  private obstacleCapacityMeshesNodeQueue: CapacityMeshNode[] = []
  private obstacleCapacityMeshesNode: CapacityMeshNode[] = []

  private currentCapacityMeshNode: CapacityMeshNode | undefined

  private crampedPortPointsToKeep: Set<SegmentPortPoint> = new Set()
  private candidatesAtDepth: DepthLimitedBfsCandidate[] = []

  /**
   * NOTE: I do not like maps, add a capacityMeshNode ref inside SegmentPortPoints
   * in future so we do not need the capacityMeshNodeId
   */
  private mapOfCapacityMeshNodeIdToRef = new Map<
    CapacityMeshNodeId,
    CapacityMeshNode
  >()
  private mapOfCapacityMeshNodeIdToSegmentPortPoints = new Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >()
  constructor(private input: NecessaryCrampedPortPointSolverInput) {
    super()
    this.setup()
  }

  getSolverName(): string {
    return "necessaryCrampedPortPointSolver"
  }

  override setup(): void {
    this.obstacleCapacityMeshesNode = this.input.capacityMeshNodes.filter(
      (cm) => cm._containsObstacle,
    )
    this.obstacleCapacityMeshesNodeQueue = [...this.obstacleCapacityMeshesNode]
    this.obstacleCapacityMeshesNodeQueue.sort((a, b) => a.center.x - b.center.x)

    for (const cmNode of this.input.capacityMeshNodes) {
      this.mapOfCapacityMeshNodeIdToRef.set(cmNode.capacityMeshNodeId, cmNode)
    }

    for (const segmentPortPoint of this.input.segmentPortPoints) {
      const cmNodeIds = segmentPortPoint.nodeIds
      for (const id of cmNodeIds) {
        const cmNode = this.mapOfCapacityMeshNodeIdToRef.get(id)
        if (!cmNode) {
          throw new Error(`Could not find capacity mesh node for id ${id}`)
        }
        const existingSegmentPortPoints =
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(id) || []
        this.mapOfCapacityMeshNodeIdToSegmentPortPoints.set(id, [
          ...existingSegmentPortPoints,
          segmentPortPoint,
        ])
      }
    }
  }

  override step(): void {
    this.currentCapacityMeshNode = this.obstacleCapacityMeshesNodeQueue.shift()

    if (!this.currentCapacityMeshNode) {
      this.solved = true
      return
    }

    this.candidatesAtDepth = getCandidatesAtDepthUsingBfs({
      target: this.currentCapacityMeshNode,
      depthLimit: 2,
      shouldIgnoreCrampedPortPoints: true,
      mapOfCapacityMeshNodeIdToSegmentPortPoints:
        this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
      mapOfCapacityMeshNodeIdToRef: this.mapOfCapacityMeshNodeIdToRef,
    })

    const areAllCandidatesBlocked = isAllCandidatesBlockedByObstacles({
      candidates: this.candidatesAtDepth,
      mapOfCapacityMeshNodeIdToRef: this.mapOfCapacityMeshNodeIdToRef,
    })

    if (areAllCandidatesBlocked) {
      let candidatesAtDepthIncludingCramped = getCandidatesAtDepthUsingBfs({
        target: this.currentCapacityMeshNode,
        depthLimit: 2,
        shouldIgnoreCrampedPortPoints: false,
        mapOfCapacityMeshNodeIdToSegmentPortPoints:
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
        mapOfCapacityMeshNodeIdToRef: this.mapOfCapacityMeshNodeIdToRef,
      })

      candidatesAtDepthIncludingCramped =
        candidatesAtDepthIncludingCramped.filter((candidates) => {
          const port = candidates.port
          const capacityMeshNodes = port.nodeIds.map((nodeId) => {
            const cmNode = this.mapOfCapacityMeshNodeIdToRef.get(nodeId)
            if (!cmNode) {
              this.failed = true
              this.error = `Could not find capacity mesh node for id ${nodeId}`
              throw new Error(
                `Could not find capacity mesh node for id ${nodeId}`,
              )
            }
            return cmNode
          })
          return (
            capacityMeshNodes.every((cmNode) => !cmNode._containsObstacle) &&
            port.cramped
          )
        })

      const areAllCandidatesIncludingCrampedBlocked =
        isAllCandidatesBlockedByObstacles({
          candidates: candidatesAtDepthIncludingCramped,
          mapOfCapacityMeshNodeIdToRef: this.mapOfCapacityMeshNodeIdToRef,
        })

      if (areAllCandidatesIncludingCrampedBlocked) {
        this.solved = false
        this.error = `All candidates are blocked by obstacles even after including cramped port points for capacity mesh node ${this.currentCapacityMeshNode.capacityMeshNodeId}`
      }

      candidatesAtDepthIncludingCramped.sort(
        (a, b) => costFunction(a) - costFunction(b),
      )
      const bestCandidate = candidatesAtDepthIncludingCramped[0]
      this.candidatesAtDepth = candidatesAtDepthIncludingCramped
      if (!bestCandidate) {
        this.solved = false
        this.error = `No candidates found for capacity mesh node ${this.currentCapacityMeshNode.capacityMeshNodeId} even after including cramped port points`
      }

      this.crampedPortPointsToKeep.add(bestCandidate.port)
    }
  }

  override getOutput(): SegmentPortPoint[] {
    const allPortPoints = this.input.segmentPortPoints
    const portPointsIncludingCrampedPortPointsToKeep = allPortPoints.filter(
      (portPoint) => {
        if (portPoint.cramped) {
          return this.crampedPortPointsToKeep.has(portPoint)
        }
        return true
      },
    )
    return portPointsIncludingCrampedPortPointsToKeep
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const obstacleCmNode of this.obstacleCapacityMeshesNode) {
      graphics.rects!.push({
        ...obstacleCmNode,
        fill:
          this.currentCapacityMeshNode?.capacityMeshNodeId ===
          obstacleCmNode.capacityMeshNodeId
            ? "rgba(255, 0, 0, 0.5)"
            : "rgba(255, 0, 0, 0.2)",
      })
    }

    for (const candidate of this.candidatesAtDepth) {
      if (candidate.port.cramped) {
        graphics.rects!.push({
          center: {
            x: candidate.port.x,
            y: candidate.port.y,
          },
          width: 0.1,
          height: 0.1,
          fill: this.crampedPortPointsToKeep.has(candidate.port)
            ? "rgba(0, 255, 0, 1)"
            : "rgba(0, 0, 0, 0.2)",
        })
      } else {
        graphics.points!.push({
          ...candidate.port,
          color: "rgba(0, 255, 0, 1)",
        })
      }
    }

    return graphics
  }
}
