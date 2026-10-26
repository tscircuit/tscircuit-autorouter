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
  private expandedCostByNodeAndDepth = new Map<
    CapacityMeshNodeId,
    Map<number, number>
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

    for (let queueIndex = 0; queueIndex < this.queue.length; queueIndex++) {
      this.currentExploredPortPoints = this.queue[queueIndex]!
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

      const currentCost = this.getCandidateCost(this.currentExploredPortPoints)
      for (const node of nextNodes) {
        // At equal depth a cheaper prefix dominates every adjacent port.
        // Keep depths separate for the search limit; ties retain the first parent.
        let costsByDepth = this.expandedCostByNodeAndDepth.get(node.capacityMeshNodeId)
        const previousCost = costsByDepth?.get(this.currentExploredPortPoints.depth)
        if (previousCost !== undefined && previousCost <= currentCost) continue
        if (!costsByDepth) {
          costsByDepth = new Map<number, number>()
          this.expandedCostByNodeAndDepth.set(node.capacityMeshNodeId, costsByDepth)
        }
        costsByDepth.set(this.currentExploredPortPoints.depth, currentCost)
        const nextPorts = this.input.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(node.capacityMeshNodeId) ?? []
        for (const nextPort of nextPorts) {
        if (this.input.shouldIgnoreCrampedPortPoints && nextPort.cramped) {
          continue
        }

        const nextCost = currentCost + 1 + (nextPort.cramped ? 1000 : 0)
        const existingCandidate = this.visitedExploredPortPoints.get(nextPort)
        if (existingCandidate && this.getCandidateCost(existingCandidate) <= nextCost) continue
        const nextCandidate: ExploredPortPoint = {
          port: nextPort,
          depth: this.currentExploredPortPoints.depth + 1,
          parent: this.currentExploredPortPoints,
          countOfCrampedPortPointsInPath:
            this.currentExploredPortPoints.countOfCrampedPortPointsInPath +
            (nextPort.cramped ? 1 : 0),
        }
        this.visitedExploredPortPoints.set(nextPort, nextCandidate)
        this.queue.push(nextCandidate)
        }
      }
    }

    this.queue = []
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
