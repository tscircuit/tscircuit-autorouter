import { BaseSolver } from "@tscircuit/solver-utils"
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
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

export type MultiTargetNecessaryCrampedPortPointSolverInput = {
  sharedEdgeSegments: SharedEdgeSegment[]
  capacityMeshNodes: CapacityMeshNode[]
  simpleRouteJson: SimpleRouteJson
  originalConnections: SimpleRouteConnection[]
  /**
   * The minimum number of cramped escape paths to keep.
   * This is useful when there are multiple connections.
   * Setting this to more than one (e.g., 2) ensures that at least two connections can be routed.
   * Distinct local branches from sparse source-trace terminals are also
   * preserved so the limit cannot erase a valid escape direction.
   * Higher values may be beneficial, but can lead to more DRC errors.
   */
  numberOfCrampedPortPointsToKeep: number
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
  private sourceTraceConnectionIds = new Set<string>()
  private netConnectionIds = new Set<string>()
  private preloadedTraceIds = new Set<string>()
  private preloadedConnectionNames = new Set<string>()
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
    this.sourceTraceConnectionIds.clear()
    this.netConnectionIds.clear()
    for (const connection of this.input.originalConnections) {
      const connectionIds = [
        connection.name,
        ...(connection.__rootConnectionNames ?? []),
        ...(connection.source_trace_id ? [connection.source_trace_id] : []),
      ]
      const destination = connection.source_trace_id
        ? this.sourceTraceConnectionIds
        : this.netConnectionIds
      for (const connectionId of connectionIds) destination.add(connectionId)
    }
    this.preloadedTraceIds = new Set(
      this.input.simpleRouteJson.traces?.map((trace) => trace.pcb_trace_id),
    )
    this.preloadedConnectionNames = new Set(
      this.input.simpleRouteJson.traces?.map((trace) => trace.connection_name),
    )
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
          // Sparse source-trace terminals can be nested behind consecutive
          // cramped boundaries. Dense/net topology and preloaded traces
          // keep the legacy selection so this pass cannot reshape their graph.
          const shouldPreserveNestedCrampedEscapes =
            this.shouldPreserveNestedCrampedEscapes(this.currentTarget)
          this.isRunningCrampedPass = true
          this.activeSubSolver =
            new SingleTargetNecessaryCrampedPortPointSolver({
              target: this.currentTarget,
              depthLimit: shouldPreserveNestedCrampedEscapes ? 3 : 2,
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

      const shouldPreserveNestedCrampedEscapes =
        this.shouldPreserveNestedCrampedEscapes(this.currentTarget)
      this.candidatesAtDepth = [...crampedCandidates].sort(
        (a, b) =>
          costFunction(a) - costFunction(b) ||
          (shouldPreserveNestedCrampedEscapes
            ? this.getCandidateExitCapacity(b) -
              this.getCandidateExitCapacity(a)
            : 0),
      )
      if (this.candidatesAtDepth.length === 0) {
        this.error = `No candidates found for capacity mesh node ${this.currentTarget.capacityMeshNodeId} even after including cramped port points`
      } else {
        let candidatesToKeep: ExploredPortPoint[]
        if (!shouldPreserveNestedCrampedEscapes) {
          candidatesToKeep = this.candidatesAtDepth.slice(
            0,
            this.input.numberOfCrampedPortPointsToKeep,
          )
        } else {
          const firstCandidateByBranchPath = new Map<
            string,
            ExploredPortPoint
          >()
          for (const candidate of this.candidatesAtDepth) {
            const branchPathId = [candidate.parent?.port, candidate.port]
              .filter((port): port is SegmentPortPoint => Boolean(port))
              .map((port) => port.segmentPortPointId)
              .join("->")
            if (!firstCandidateByBranchPath.has(branchPathId)) {
              firstCandidateByBranchPath.set(branchPathId, candidate)
            }
          }
          const diverseCandidates = [...firstCandidateByBranchPath.values()]
          const diverseCandidateSet = new Set(diverseCandidates)
          candidatesToKeep = [
            ...diverseCandidates,
            ...this.candidatesAtDepth.filter(
              (candidate) => !diverseCandidateSet.has(candidate),
            ),
          ].slice(
            0,
            Math.max(
              this.input.numberOfCrampedPortPointsToKeep,
              diverseCandidates.length,
            ),
          )
        }

        for (const candidate of candidatesToKeep) {
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
    const previousNodeIds = new Set(candidate.parent?.port.nodeIds ?? [])
    const exitNodes = candidate.port.nodeIds
      .filter((nodeId) => !previousNodeIds.has(nodeId))
      .map((nodeId) => this.nodeMap.get(nodeId))
      .filter((node): node is CapacityMeshNode => Boolean(node))
    const nodesToMeasure =
      exitNodes.length > 0
        ? exitNodes
        : candidate.port.nodeIds.map((nodeId) => this.nodeMap.get(nodeId)!)
    return Math.max(
      0,
      ...nodesToMeasure.map(
        (node) => node.width * node.height * node.availableZ.length,
      ),
    )
  }

  private shouldPreserveNestedCrampedEscapes(
    target: CapacityMeshNode,
  ): boolean {
    const connectedTo = target._connectedTo ?? []
    const isSourceTraceConnection = connectedTo.some((connectionId) =>
      this.sourceTraceConnectionIds.has(connectionId),
    )
    const isNetConnection = connectedTo.some((connectionId) =>
      this.netConnectionIds.has(connectionId),
    )
    const hasPreloadedTrace =
      connectedTo.some((connectionId) =>
        this.preloadedConnectionNames.has(connectionId),
      ) ||
      connectedTo.some((connectionId) =>
        this.preloadedTraceIds.has(connectionId),
      )
    // The setup lifecycle can index the same port object more than once, so
    // sparsity must be measured by stable port IDs rather than array length.
    const incidentPortCount = new Set(
      (
        this.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(
          target.capacityMeshNodeId,
        ) ?? []
      ).map((port) => port.segmentPortPointId),
    ).size
    const maximumSparseTerminalPortCount =
      this.input.numberOfCrampedPortPointsToKeep + 2
    return (
      isSourceTraceConnection &&
      !isNetConnection &&
      !hasPreloadedTrace &&
      incidentPortCount <= maximumSparseTerminalPortCount
    )
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
