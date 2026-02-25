import { BaseSolver } from "@tscircuit/solver-utils"
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { GraphicsObject, mergeGraphics } from "graphics-debug"
import { isAllCandidatesBlockedByObstacles } from "./isAllCandidatesBlockedByObstacles"
import { costFunction } from "./costFunction"
import { ExploredPortPoint } from "./types"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { SingleTargetNecessaryCrampedPortPointSolver } from "./SingleTargetNecessaryCrampedPortPointSolver"

export type MultiTargetNecessaryCrampedPortPointSolverInput = {
  sharedEdgeSegments: SharedEdgeSegment[]
  capacityMeshNodes: CapacityMeshNode[]
  simpleRouteJson: SimpleRouteJson
}

/**
 * This solver filters out cramped port points that are not necessary.
 */
export class MultiTargetNecessaryCrampedPortPointSolver extends BaseSolver {
  private unprocessedTargets: CapacityMeshNode[] = []
  private targetNode: CapacityMeshNode[] = []

  private currentTarget: CapacityMeshNode | undefined

  private crampedPortPointsToKeep: Set<SegmentPortPoint> = new Set()
  private candidatesAtDepth: ExploredPortPoint[] = []
  private isRunningCrampedPass = false

  override activeSubSolver: SingleTargetNecessaryCrampedPortPointSolver | null =
    null

  /**
   * NOTE: I do not like maps, add a capacityMeshNode ref inside SegmentPortPoints
   * in future so we do not need the capacityMeshNodeId
   */
  private nodeMap = new Map<CapacityMeshNodeId, CapacityMeshNode>()
  private mapOfCapacityMeshNodeIdToSegmentPortPoints = new Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >()
  constructor(private input: MultiTargetNecessaryCrampedPortPointSolverInput) {
    super()
    /**
     * TODO: AutoroutingPipeline2_HgPortPointSolver does not call setup
     * Add support for calling setup in the pipeline runner and remove this call to setup in the constructor.
     */
    this._setup()
  }

  getSolverName(): string {
    return "multiTargetNecessaryCrampedPortPointSolver"
  }

  override _setup(): void {
    this.targetNode = this.input.capacityMeshNodes.filter(
      (cm) => cm._containsObstacle,
    )
    const collectPointsToConnect =
      this.input.simpleRouteJson.connections.flatMap(
        (connection) => connection.pointsToConnect,
      )
    this.targetNode = this.targetNode.filter((cmNode) => {
      let pointIsInsideObstacle = false
      collectPointsToConnect.forEach((point) => {
        const distance = pointToBoxDistance(point, cmNode)
        if (distance <= 0) {
          pointIsInsideObstacle = true
        }
      })
      return pointIsInsideObstacle
    })
    this.unprocessedTargets = [...this.targetNode]
    this.unprocessedTargets.sort((a, b) => a.center.x - b.center.x)

    for (const cmNode of this.input.capacityMeshNodes) {
      this.nodeMap.set(cmNode.capacityMeshNodeId, cmNode)
    }

    for (const sharedEdgeSegment of this.input.sharedEdgeSegments) {
      for (const segmentPortPoint of sharedEdgeSegment.portPoints) {
        const cmNodeIds = segmentPortPoint.nodeIds
        for (const id of cmNodeIds) {
          const cmNode = this.nodeMap.get(id)
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
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver._step()
      if (!this.activeSubSolver.solved) {
        return
      }
      if (this.activeSubSolver.failed) {
        this.failed = true
        this.error = this.activeSubSolver.error
        return
      }

      this.candidatesAtDepth = this.activeSubSolver.getOutput()
      this.activeSubSolver = null

      if (!this.currentTarget) {
        this.failed = true
        this.error = "Missing current capacity mesh node while finishing BFS"
        return
      }

      if (!this.isRunningCrampedPass) {
        const areAllCandidatesBlocked = isAllCandidatesBlockedByObstacles({
          candidates: this.candidatesAtDepth,
          mapOfCapacityMeshNodeIdToRef: this.nodeMap,
        })

        if (areAllCandidatesBlocked || this.candidatesAtDepth.length === 0) {
          this.isRunningCrampedPass = true
          this.activeSubSolver =
            new SingleTargetNecessaryCrampedPortPointSolver({
              target: this.currentTarget,
              depthLimit: 2,
              shouldIgnoreCrampedPortPoints: false,
              mapOfCapacityMeshNodeIdToSegmentPortPoints:
                this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
              mapOfCapacityMeshNodeIdToRef: this.nodeMap,
            })
          return
        }

        this.currentTarget = undefined
        return
      }

      let crampedCandidates = this.candidatesAtDepth.filter((candidate) => {
        const port = candidate.port
        const capacityMeshNodes = port.nodeIds.map((nodeId) => {
          const cmNode = this.nodeMap.get(nodeId)
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

      const areAllCrampedCandidatesBlocked = isAllCandidatesBlockedByObstacles({
        candidates: crampedCandidates,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      })

      if (areAllCrampedCandidatesBlocked) {
        this.error = `All candidates are blocked by obstacles even after including cramped port points for capacity mesh node ${this.currentTarget.capacityMeshNodeId}`
      }

      this.candidatesAtDepth = [...crampedCandidates].sort(
        (a, b) => costFunction(a) - costFunction(b),
      )
      const bestCandidate = this.candidatesAtDepth[0]
      if (!bestCandidate || crampedCandidates.length === 0) {
        this.error = `No candidates found for capacity mesh node ${this.currentTarget.capacityMeshNodeId} even after including cramped port points`
      } else {
        this.crampedPortPointsToKeep.add(bestCandidate.port)
      }

      this.isRunningCrampedPass = false
      this.currentTarget = undefined
      return
    }

    if (!this.currentTarget) {
      this.currentTarget = this.unprocessedTargets.shift()
      if (!this.currentTarget) {
        this.solved = true
        return
      }
      this.isRunningCrampedPass = false
      this.candidatesAtDepth = []
      this.activeSubSolver = new SingleTargetNecessaryCrampedPortPointSolver({
        target: this.currentTarget,
        depthLimit: 2,
        shouldIgnoreCrampedPortPoints: true,
        mapOfCapacityMeshNodeIdToSegmentPortPoints:
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      })
      return
    }
  }

  override getOutput(): SharedEdgeSegment[] {
    return this.input.sharedEdgeSegments.map((segment) => ({
      ...segment,
      portPoints: segment.portPoints.filter((portPoint) => {
        if (portPoint.cramped) {
          return this.crampedPortPointsToKeep.has(portPoint)
        }
        return true
      }),
    }))
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const obstacleCmNode of this.targetNode) {
      graphics.rects!.push({
        ...obstacleCmNode,
        fill:
          this.currentTarget?.capacityMeshNodeId ===
          obstacleCmNode.capacityMeshNodeId
            ? "rgba(255, 0, 0, 0.5)"
            : "rgba(255, 0, 0, 0.2)",
      })
    }

    for (const candidate of this.candidatesAtDepth) {
      graphics.points!.push({
        ...candidate.port,
        color: candidate.port.cramped ? "blue" : "green",
      })
    }

    for (const crampedPortPoint of this.crampedPortPointsToKeep) {
      graphics.points!.push({
        ...crampedPortPoint,
        color: "blue",
      })
    }

    if (this.activeSubSolver) {
      return mergeGraphics(graphics, this.activeSubSolver.visualize())
    }

    return graphics
  }
}
