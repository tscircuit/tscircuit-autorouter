import {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"
import { ExploredPortPoint } from "./types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"

const CRAMPED_PORT_COST = 1000

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
    this.setup()
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

    for (let index = 0; index < this.queue.length; index++) {
      this.currentExploredPortPoints = this.queue[index]!
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

      const parent = this.currentExploredPortPoints
      const depth = parent.depth + 1
      for (const nodeId of parent.port.nodeIds) {
        if (!this.input.mapOfCapacityMeshNodeIdToRef.has(nodeId)) {
          throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
        }
        const ports =
          this.input.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(nodeId)
        if (!ports) continue
        for (const port of ports) {
          if (this.input.shouldIgnoreCrampedPortPoints && port.cramped) continue
          const crampedCount =
            parent.countOfCrampedPortPointsInPath + (port.cramped ? 1 : 0)
          const existing = this.visitedExploredPortPoints.get(port)
          const cost = depth + crampedCount * CRAMPED_PORT_COST
          if (existing && this.getCandidateCost(existing) <= cost) continue
          const candidate = {
            port,
            depth,
            parent,
            countOfCrampedPortPointsInPath: crampedCount,
          }
          this.visitedExploredPortPoints.set(port, candidate)
          this.queue.push(candidate)
        }
      }
    }
    this.queue.length = 0
    this.solved = true
  }

  private getCandidateCost(candidate: ExploredPortPoint): number {
    return (
      candidate.depth +
      candidate.countOfCrampedPortPointsInPath * CRAMPED_PORT_COST
    )
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
