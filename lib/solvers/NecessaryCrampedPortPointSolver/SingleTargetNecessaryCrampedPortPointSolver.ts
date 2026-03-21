import {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"
import { ExploredPortPoint } from "./types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"

type SingleTargetNecessaryCrampedPortPointSolverInput = {
  target: CapacityMeshNode
  mapOfCapacityMeshNodeIdToSegmentPortPoints: Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export class SingleTargetNecessaryCrampedPortPointSolver extends BaseSolver {
  private queue: ExploredPortPoint[] = []
  private resultExploredPortPoints: ExploredPortPoint[] = []
  private currentExploredPortPoints: ExploredPortPoint | null = null
  private visitedExploredPortPoints = new Map<
    SegmentPortPoint,
    ExploredPortPoint
  >()

  constructor(private input: SingleTargetNecessaryCrampedPortPointSolverInput) {
    super()
    if (this.input.depthLimit < 1) {
      throw new Error("Depth limit must be at least 1")
    }
    this._setup()
  }

  override getSolverName() {
    return "singleTargetNecessaryCrampedPortPointSolver"
  }

  override _setup(): void {
    const seedPorts =
      this.input.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(
        this.input.target.capacityMeshNodeId,
      ) ?? []
    for (const seedPort of seedPorts) {
      if (this.input.shouldIgnoreCrampedPortPoints && seedPort.cramped) continue
      const initialCandidate: ExploredPortPoint = {
        port: seedPort,
        depth: 1,
        parent: null,
        countOfCrampedPortPointsInPath: seedPort.cramped ? 1 : 0,
      }
      const existingCandidate = this.visitedExploredPortPoints.get(seedPort)
      if (
        !existingCandidate ||
        this.getCandidateCost(initialCandidate) <
          this.getCandidateCost(existingCandidate)
      ) {
        this.visitedExploredPortPoints.set(seedPort, initialCandidate)
        this.queue.push(initialCandidate)
      }
    }
  }

  override _step() {
    if (this.queue.length === 0) {
      this.currentExploredPortPoints = null
      this.solved = true
      return
    }

    while (this.queue.length > 0) {
      this.currentExploredPortPoints = this.queue.shift()!
      const bestKnownCandidate = this.visitedExploredPortPoints.get(
        this.currentExploredPortPoints.port,
      )
      if (bestKnownCandidate !== this.currentExploredPortPoints) {
        continue
      }

      if (this.currentExploredPortPoints.depth === this.input.depthLimit) {
        this.resultExploredPortPoints.push(this.currentExploredPortPoints)
        continue
      }

      const nextNodes = this.currentExploredPortPoints.port.nodeIds.map(
        (nodeId) => {
          const cmNode = this.input.mapOfCapacityMeshNodeIdToRef.get(nodeId)
          if (!cmNode) {
            throw new Error(
              `Could not find capacity mesh node for id ${nodeId}`,
            )
          }
          return cmNode
        },
      )

      const nextPorts = nextNodes.flatMap(
        (node) =>
          this.input.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(
            node.capacityMeshNodeId,
          ) ?? [],
      )

      for (const nextPort of nextPorts) {
        if (this.input.shouldIgnoreCrampedPortPoints && nextPort.cramped) {
          continue
        }

        const nextCandidate: ExploredPortPoint = {
          port: nextPort,
          depth: this.currentExploredPortPoints.depth + 1,
          parent: this.currentExploredPortPoints,
          countOfCrampedPortPointsInPath:
            this.currentExploredPortPoints.countOfCrampedPortPointsInPath +
            (nextPort.cramped ? 1 : 0),
        }
        const existingCandidate = this.visitedExploredPortPoints.get(nextPort)
        if (
          existingCandidate &&
          this.getCandidateCost(existingCandidate) <=
            this.getCandidateCost(nextCandidate)
        ) {
          continue
        }
        this.visitedExploredPortPoints.set(nextPort, nextCandidate)
        this.queue.push(nextCandidate)
      }
    }

    this.solved = true
  }

  private getCandidateCost(candidate: ExploredPortPoint): number {
    return candidate.depth + candidate.countOfCrampedPortPointsInPath * 1000
  }

  getOutput() {
    return this.resultExploredPortPoints
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      rects: [],
    }

    for (const candidate of this.visitedExploredPortPoints.keys()) {
      graphics.points!.push({
        ...candidate,
        color: candidate.cramped ? "blue" : "green",
      })
    }

    return graphics
  }
}
