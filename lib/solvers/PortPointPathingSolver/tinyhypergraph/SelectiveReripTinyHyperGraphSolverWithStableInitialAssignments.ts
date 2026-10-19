import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { PortId } from "tiny-hypergraph/lib/types"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { AllowedZByConnection } from "lib/utils/getAllowedZByConnection"

type SerializedConnection = NonNullable<SerializedHyperGraph["connections"]>[number]

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  allowedZByConnection?: AllowedZByConnection
  private initialAssignmentRouteIds?: ReadonlySet<number>

  override isPortReservedForDifferentNet(portId: PortId): boolean {
    if (super.isPortReservedForDifferentNet(portId)) return true
    const routeId = this.state.currentRouteId
    if (routeId === undefined || routeId === null) return false
    const connection: SerializedConnection | undefined =
      this.problem.routeMetadata?.[routeId]
    if (!connection) return false
    const allowedZ = this.allowedZByConnection?.get(connection.connectionId)
    return (
      allowedZ !== undefined &&
      !allowedZ.includes(this.topology.portZ[portId]!)
    )
  }

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    if (!this.initialAssignmentRouteIds) {
      this.initialAssignmentRouteIds = new Set(
        (this.problem.initialAssignments ?? []).map(
          (assignment) => assignment.routeId,
        ),
      )
    }
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return

    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}
