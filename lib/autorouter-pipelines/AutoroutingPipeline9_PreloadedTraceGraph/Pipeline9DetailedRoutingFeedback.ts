import type { NodeWithPortPoints } from "../../types/high-density-types"
import type { DetailedRoutingFailureKind } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"

export type Pipeline9DetailedRoutingConflict = {
  kind: DetailedRoutingFailureKind
  node: NodeWithPortPoints
  geometryContext: string
  solverIterations: number
  error: string
}

export type DetailedRoutingRegionPenalty = {
  capacityMeshNodeId: string
  connectionName: string
  penalty: number
  evidenceKey: string
}

/**
 * Evidence belongs to one pipeline invocation. A local search failure is a
 * routing cost observation, never a proof that the board is infeasible.
 */
export class Pipeline9DetailedRoutingFeedback {
  readonly conflicts: Pipeline9DetailedRoutingConflict[] = []
  readonly stats = {
    detailedFeedbackLearnedConflictCount: 0,
    detailedFeedbackSingleLayerConflictCount: 0,
    detailedFeedbackSearchExhaustionCount: 0,
    detailedFeedbackReplanCount: 0,
    detailedFeedbackEarlyReplanCount: 0,
    detailedFeedbackPausedAttemptCount: 0,
    detailedFeedbackResumedAttemptCount: 0,
    detailedFeedbackInitialFailedAttemptCount: 0,
    detailedFeedbackFinalFailedAttemptCount: 0,
    detailedFeedbackChangedNodeAssignmentCount: 0,
    detailedFeedbackRoundLimitReached: 0,
    detailedFeedbackHardExclusionCount: 0,
  }
  private readonly evidenceKeys = new Set<string>()
  private readonly penalties = new Map<string, DetailedRoutingRegionPenalty>()
  private initialAssignments?: Map<string, string>

  learn(conflicts: readonly Pipeline9DetailedRoutingConflict[]): number {
    let learned = 0
    for (const conflict of conflicts) {
      const evidenceKey = JSON.stringify([
        conflict.geometryContext,
        conflict.kind,
        conflict.node,
      ])
      if (this.evidenceKeys.has(evidenceKey)) continue
      this.evidenceKeys.add(evidenceKey)
      this.conflicts.push(structuredClone(conflict))
      this.stats.detailedFeedbackLearnedConflictCount++
      if (conflict.kind === "single-layer-crossing") {
        this.stats.detailedFeedbackSingleLayerConflictCount++
      } else {
        this.stats.detailedFeedbackSearchExhaustionCount++
      }
      const connectionNames = new Set(
        conflict.node.portPoints.map((point) => point.connectionName),
      )
      for (const connectionName of connectionNames) {
        const key = JSON.stringify([
          conflict.node.capacityMeshNodeId,
          connectionName,
        ])
        const existing = this.penalties.get(key)
        // This finite cost generalizes a particular failed detailed problem to
        // its participating route/region choices. No transition is forbidden.
        this.penalties.set(key, {
          capacityMeshNodeId: conflict.node.capacityMeshNodeId,
          connectionName,
          penalty: (existing?.penalty ?? 0) + 8,
          evidenceKey,
        })
      }
      learned++
    }
    return learned
  }

  getPenalties(): DetailedRoutingRegionPenalty[] {
    return [...this.penalties.values()].map((penalty) => ({ ...penalty }))
  }

  recordAssignments(nodes: readonly NodeWithPortPoints[]): void {
    const assignments = new Map(
      nodes.map((node) => {
        const points = node.portPoints.map((point) => JSON.stringify([
          point.connectionName, point.rootConnectionName,
          point.portPointId, point.pcb_port_id, point.x, point.y, point.z,
        ])).sort()
        const pairs = node.portPointsInPairs?.map((pair) =>
          pair.map((point) => JSON.stringify([
            point.connectionName, point.rootConnectionName,
            point.portPointId, point.pcb_port_id, point.x, point.y, point.z,
          ])).sort().join("|"),
        ).sort()
        return [node.capacityMeshNodeId, JSON.stringify([
          node.center, node.width, node.height, node.availableZ, points, pairs,
        ])] as const
      }),
    )
    if (!this.initialAssignments) {
      this.initialAssignments = assignments
      return
    }
    const allIds = new Set([
      ...this.initialAssignments.keys(),
      ...assignments.keys(),
    ])
    this.stats.detailedFeedbackChangedNodeAssignmentCount = [...allIds].filter(
      (id) => this.initialAssignments!.get(id) !== assignments.get(id),
    ).length
  }
}
