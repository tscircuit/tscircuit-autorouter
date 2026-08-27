import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { PortId } from "tiny-hypergraph/lib/types"
import type { AllowedZByConnectionName } from "lib/types/high-density-types"

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>
  private allowedZByConnectionName: AllowedZByConnectionName = {}

  setAllowedZByConnectionName(
    allowedZByConnectionName: AllowedZByConnectionName,
  ): void {
    this.allowedZByConnectionName = allowedZByConnectionName
  }

  protected override isPortTransitionAllowed(
    firstPortId: PortId,
    secondPortId: PortId,
  ): boolean {
    const currentRouteId = this.state.currentRouteId
    const connectionName =
      currentRouteId === undefined
        ? undefined
        : this.problem.routeMetadata?.[currentRouteId]?.simpleRouteConnection
            ?.name
    const allowedZ = connectionName
      ? this.allowedZByConnectionName[connectionName]
      : undefined
    if (!allowedZ) return true

    return (
      allowedZ.includes(this.topology.portZ[firstPortId]) &&
      allowedZ.includes(this.topology.portZ[secondPortId])
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
