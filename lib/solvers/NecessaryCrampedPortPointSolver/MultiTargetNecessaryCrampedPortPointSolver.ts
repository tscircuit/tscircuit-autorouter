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

const CRAMPED_NON_NECESSARY_PORT_PENALTY = 1_000
const MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP = 5
/**
 * A target that reaches fewer (port point, node) hops than this through the
 * port points the output keeps is in a closed pocket and needs its cramped
 * escapes. Matches the hop count the tiny-hypergraph static reachability
 * precheck treats as reachable.
 */
const MIN_OPEN_ESCAPE_HOP_COUNT = 16

type PocketHop = {
  portPoint: SegmentPortPoint | null
  nodeId: CapacityMeshNodeId
}

export type MultiTargetNecessaryCrampedPortPointSolverInput = {
  sharedEdgeSegments: SharedEdgeSegment[]
  /**
   * Shared edge segments the caller keeps whole instead of passing in for
   * filtering (for example component-local regions). They lead to nodes this
   * solver is not given, but their port points stay in the routing graph, so
   * they are ways out of a pocket.
   */
  preservedSharedEdgeSegments: readonly SharedEdgeSegment[]
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
  private filteredOutput?: SharedEdgeSegment[]
  private targetsWithCrampedEscapes = new Set<CapacityMeshNodeId>()
  private unprocessedPocketTargets: CapacityMeshNode[] = []
  private nodeIdsWithPreservedExits = new Set<CapacityMeshNodeId>()

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
    this.targetNode = this.targetNode.filter((cmNode) => {
      for (const connection of this.input.simpleRouteJson.connections) {
        for (const point of connection.pointsToConnect) {
          if (pointToBoxDistance(point, cmNode) <= 0) {
            return true
          }
        }
      }
      return false
    })
    this.unprocessedTargets = [...this.targetNode]
    this.unprocessedTargets.sort((a, b) => a.center.x - b.center.x)
    this.unprocessedPocketTargets = [...this.unprocessedTargets]

    for (const cmNode of this.input.capacityMeshNodes) {
      this.nodeMap.set(cmNode.capacityMeshNodeId, cmNode)
    }

    for (const preservedSegment of this.input.preservedSharedEdgeSegments) {
      if (preservedSegment.portPoints.length === 0) continue
      for (const nodeId of preservedSegment.nodeIds) {
        this.nodeIdsWithPreservedExits.add(nodeId)
      }
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
          this.startCrampedPass(this.currentTarget)
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

      this.candidatesAtDepth = [...crampedCandidates].sort((a, b) => {
        const costDifference = costFunction(a) - costFunction(b)
        if (costDifference !== 0) {
          return costDifference
        }
        return (
          this.getCandidateExitCapacity(b) - this.getCandidateExitCapacity(a)
        )
      })
      if (this.candidatesAtDepth.length === 0) {
        this.error = `No candidates found for capacity mesh node ${this.currentTarget.capacityMeshNodeId} even after including cramped port points`
      } else {
        const firstCandidateByBranchPath = new Map<string, ExploredPortPoint>()
        for (const candidate of this.candidatesAtDepth) {
          if (!candidate.parent) {
            throw new Error(
              `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
            )
          }
          const branchPathId = `${candidate.parent.port.segmentPortPointId}->${candidate.port.segmentPortPointId}`
          if (!firstCandidateByBranchPath.has(branchPathId)) {
            firstCandidateByBranchPath.set(branchPathId, candidate)
            if (
              firstCandidateByBranchPath.size ===
              MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP
            ) {
              break
            }
          }
        }
        const diverseCandidates = [...firstCandidateByBranchPath.values()]
        for (const candidate of diverseCandidates) {
          this.keepCandidatePath(candidate)
        }
      }

      this.isRunningCrampedPass = false
      this.currentTarget = undefined
      return
    }

    if (!this.currentTarget) {
      this.currentTarget = this.unprocessedTargets.shift()
      if (!this.currentTarget) {
        // Second pass, once every target has its first-pass escapes: a target
        // still sealed in a pocket by the port points the output keeps would
        // fail the static reachability precheck, so it keeps its cramped
        // escapes too.
        const pocketTarget = this.unprocessedPocketTargets.shift()
        if (!pocketTarget) {
          this.solved = true
          return
        }
        if (
          !this.targetsWithCrampedEscapes.has(
            pocketTarget.capacityMeshNodeId,
          ) &&
          this.isInClosedPocket(pocketTarget)
        ) {
          this.currentTarget = pocketTarget
          this.candidatesAtDepth = []
          this.startCrampedPass(pocketTarget)
        }
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
    if (this.filteredOutput) {
      return this.filteredOutput
    }

    this.filteredOutput = this.input.sharedEdgeSegments.map((segment) => ({
      ...segment,
      portPoints: segment.portPoints.flatMap((portPoint) => {
        if (!portPoint.cramped || this.crampedPortPointsToKeep.has(portPoint)) {
          return [portPoint]
        }

        if (this.isMultilayerEscapePort(portPoint)) {
          return [
            {
              ...portPoint,
              tinyHypergraphPortPenalty: CRAMPED_NON_NECESSARY_PORT_PENALTY,
            },
          ]
        }

        return []
      }),
    }))
    return this.filteredOutput
  }

  private getCandidateExitCapacity(candidate: ExploredPortPoint): number {
    if (!candidate.parent) {
      throw new Error(
        `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      )
    }
    const previousNodeIds = new Set(candidate.parent.port.nodeIds)
    const exitNodes = candidate.port.nodeIds
      .filter((nodeId) => !previousNodeIds.has(nodeId))
      .map((nodeId) => {
        const node = this.nodeMap.get(nodeId)
        if (!node) {
          throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
        }
        return node
      })
    if (exitNodes.length === 0) {
      throw new Error(
        `Could not find exit node for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      )
    }
    return Math.max(
      0,
      ...exitNodes.map(
        (node) => node.width * node.height * node.availableZ.length,
      ),
    )
  }

  private startCrampedPass(target: CapacityMeshNode): void {
    this.isRunningCrampedPass = true
    this.targetsWithCrampedEscapes.add(target.capacityMeshNodeId)
    this.activeSubSolver = new SingleTargetNecessaryCrampedPortPointSolver({
      target,
      depthLimit: 3,
      shouldIgnoreCrampedPortPoints: false,
      mapOfCapacityMeshNodeIdToSegmentPortPoints:
        this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
      mapOfCapacityMeshNodeIdToRef: this.nodeMap,
    })
  }

  /**
   * The depth-limited search can reach an obstacle-free node that is itself
   * enclosed: a strip of small free nodes along a fine-pitch pad row whose
   * only ways out are cramped. Walk from the target the way the static
   * reachability precheck does, through the port points the output keeps and
   * obstacle-free nodes; if the walk runs out before MIN_OPEN_ESCAPE_HOP_COUNT
   * hops, the target is in a closed pocket. A node with a preserved segment
   * is a way out: the region beyond it stays in the routing graph whole.
   */
  private isInClosedPocket(target: CapacityMeshNode): boolean {
    const queue: PocketHop[] = [
      { portPoint: null, nodeId: target.capacityMeshNodeId },
    ]
    const seenHopIds = new Set<string>()

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const hop = queue[queueIndex]!
      if (this.nodeIdsWithPreservedExits.has(hop.nodeId)) return false
      const portPoints =
        this.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(hop.nodeId) ?? []
      for (const portPoint of portPoints) {
        if (portPoint === hop.portPoint) continue
        if (
          portPoint.cramped &&
          !this.crampedPortPointsToKeep.has(portPoint) &&
          !this.isMultilayerEscapePort(portPoint)
        ) {
          continue
        }
        const nextNodeId = portPoint.nodeIds.find((id) => id !== hop.nodeId)
        if (!nextNodeId) {
          throw new Error(
            `Port point ${portPoint.segmentPortPointId} does not lead out of node ${hop.nodeId}`,
          )
        }
        const nextNode = this.nodeMap.get(nextNodeId)
        if (!nextNode) {
          throw new Error(
            `Could not find capacity mesh node for id ${nextNodeId}`,
          )
        }
        if (nextNode._containsObstacle) continue
        const hopId = `${portPoint.segmentPortPointId}>${nextNodeId}`
        if (seenHopIds.has(hopId)) continue
        seenHopIds.add(hopId)
        if (seenHopIds.size >= MIN_OPEN_ESCAPE_HOP_COUNT) return false
        queue.push({ portPoint, nodeId: nextNodeId })
      }
    }

    return true
  }

  private keepCandidatePath(candidate: ExploredPortPoint): void {
    this.crampedPortPointsToKeep.add(candidate.port)
    let parent = candidate.parent
    while (parent) {
      this.crampedPortPointsToKeep.add(parent.port)
      parent = parent.parent
    }
  }

  private isMultilayerEscapePort(portPoint: SegmentPortPoint): boolean {
    return portPoint.nodeIds.some(
      (nodeId) => (this.nodeMap.get(nodeId)?.availableZ.length ?? 0) > 1,
    )
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
