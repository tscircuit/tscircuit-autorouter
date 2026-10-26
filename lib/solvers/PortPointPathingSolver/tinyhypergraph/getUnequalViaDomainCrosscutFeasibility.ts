import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"
import { doesUnequalViaDomainBlockCrossing } from "./doesUnequalViaDomainBlockCrossing"
import { haveAlternatingBoundaryContacts } from "./getNoViaPlanarCrossingFeasibility"
import type { ThroughViaDemand } from "./getThroughViaCrosscutFeasibility"
import type { PlanarCrosscutDemand } from "./getViaApproachCrosscutFeasibility"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Input = {
  bounds: Bounds
  vias: ThroughViaDemand[]
  wires: PlanarCrosscutDemand[]
  radius: number
  minimumForeignViaSpacing: number
  minimumSameOwnerViaSpacing: number
  minimumTraceSpacing: number
  slack: number
}

/** Attribute a forced crossing whose extra via barrels cannot bypass each other. */
export function getUnequalViaDomainCrosscutFeasibility({
  bounds,
  vias,
  wires,
  radius,
  minimumForeignViaSpacing,
  minimumSameOwnerViaSpacing,
  minimumTraceSpacing,
  slack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  for (const mandatory of vias) {
    for (const restricted of wires) {
      if (mandatory.owner === restricted.owner) continue
      for (const other of wires) {
        if (
          other.owner === mandatory.owner ||
          other.owner === restricted.owner ||
          other.layer !== restricted.layer
        )
          continue
        if (
          !haveAlternatingBoundaryContacts(
            bounds,
            restricted,
            other,
            minimumTraceSpacing,
            slack,
          )
        )
          continue
        if (
          !doesUnequalViaDomainBlockCrossing({
            cellBounds: bounds,
            mandatoryViaBounds: mandatory.bounds,
            restrictedWireViaBounds: restricted.viaBounds,
            otherWireViaBounds: other.viaBounds,
            minimumForeignViaDistance: minimumForeignViaSpacing,
            minimumSameOwnerDrillDistance: minimumSameOwnerViaSpacing,
            traceExclusionRadius: radius,
            slack,
          })
        )
          continue
        const alternatives = new Map<string, number[]>()
        for (const demand of [mandatory, restricted, other]) {
          if (demand.candidate) continue
          if (demand.routeIds.length === 0)
            throw new Error(
              "A removable unequal-domain crossing demand has no committed routes",
            )
          const routes = [...new Set(demand.routeIds)].sort((a, b) => a - b)
          alternatives.set(JSON.stringify(routes), routes)
        }
        return alternatives.size === 0
          ? { feasible: false, blockerRouteIds: [] }
          : {
              feasible: false,
              alternativeBlockerRouteIdSets: [...alternatives.values()],
            }
      }
    }
  }
  return { feasible: true }
}
