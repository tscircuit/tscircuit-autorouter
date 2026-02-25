import {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"
import { ExploredPortPoint } from "./types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"

type GetCandidatesAtDepthUsingBfsSolverInput = {
  target: CapacityMeshNode
  mapOfCapacityMeshNodeIdToSegmentPortPoints: Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export class GetCandidatesAtDepthUsingBfsSolver extends BaseSolver {
  private queue: ExploredPortPoint[] = []
  private resultCandidates: ExploredPortPoint[] = []
  private currentCandidate: ExploredPortPoint | null = null
  private visitedPortPoints: SegmentPortPoint[] = []
  private bestCandidateForPort = new Map<
    ExploredPortPoint["port"],
    ExploredPortPoint
  >()

  constructor(private input: GetCandidatesAtDepthUsingBfsSolverInput) {
    super()
    if (this.input.depthLimit < 1) {
      throw new Error("Depth limit must be at least 1")
    }
    this.setup()
  }

  override getSolverName() {
    return "GetCandidatesAtDepthUsingBfsSolver"
  }

  override setup(): void {
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
      this.bestCandidateForPort.set(seedPort, initialCandidate)
      this.queue.push(initialCandidate)
    }
    this.visitedPortPoints = [
      ...new Set(this.queue.map((candidate) => candidate.port)),
    ]
  }

  override step() {
    if (this.queue.length === 0) {
      this.currentCandidate = null
      this.solved = true
      return
    }

    const depthInThisStep = this.queue[0]!.depth

    while (
      this.queue.length > 0 &&
      this.queue[0]!.depth === depthInThisStep &&
      !this.solved
    ) {
      this.currentCandidate = this.queue.shift()!

      if (this.currentCandidate.depth === this.input.depthLimit) {
        this.resultCandidates.push(this.currentCandidate)
        continue
      }

      const nextNodes = this.currentCandidate.port.nodeIds.map((nodeId) => {
        const cmNode = this.input.mapOfCapacityMeshNodeIdToRef.get(nodeId)
        if (!cmNode) {
          throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
        }
        return cmNode
      })

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
          depth: this.currentCandidate.depth + 1,
          parent: this.currentCandidate,
          countOfCrampedPortPointsInPath:
            this.currentCandidate.countOfCrampedPortPointsInPath +
            (nextPort.cramped ? 1 : 0),
        }
        const existingCandidate = this.bestCandidateForPort.get(nextPort)

        if (
          existingCandidate &&
          existingCandidate.depth < nextCandidate.depth
        ) {
          continue
        }
        if (
          existingCandidate &&
          existingCandidate.depth === nextCandidate.depth &&
          existingCandidate.countOfCrampedPortPointsInPath <=
            nextCandidate.countOfCrampedPortPointsInPath
        ) {
          continue
        }

        this.bestCandidateForPort.set(nextPort, nextCandidate)
        this.queue.push(nextCandidate)
      }
    }

    if (this.queue.length === 0) {
      this.solved = true
    }

    this.visitedPortPoints = [
      ...new Set(this.queue.map((candidate) => candidate.port)),
      ...this.visitedPortPoints,
    ]
  }

  getOutput() {
    return this.resultCandidates
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      rects: [],
    }

    for (const candidate of this.visitedPortPoints) {
      if (!candidate.cramped) {
        graphics.points!.push({
          ...candidate,
          color: "green",
        })
      } else {
        graphics.rects!.push({
          center: {
            x: candidate.x,
            y: candidate.y,
          },
          width: 0.1,
          height: 0.1,
          fill: "green",
        })
      }
    }

    return graphics
  }
}
