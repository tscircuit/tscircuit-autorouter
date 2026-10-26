import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"
import type {
  CrosscutBoundaryContact,
  PlanarCrosscutDemand,
} from "./getViaApproachCrosscutFeasibility"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Input = {
  bounds: Bounds
  wires: PlanarCrosscutDemand[]
  minimumTraceSpacing: number
  slack: number
}

/** Map an entire legal boundary interval to the rectangle's cyclic perimeter. */
function perimeterInterval(contact: CrosscutBoundaryContact, bounds: Bounds, slack: number): [number, number] | undefined {
  if (![contact.min, contact.max, contact.normal].every(Number.isFinite) || contact.min > contact.max)
    return undefined
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY
  if (contact.side === "top" || contact.side === "bottom") {
    const normal = contact.side === "top" ? bounds.maxY : bounds.minY
    if (Math.abs(contact.normal - normal) > slack || contact.min < bounds.minX || contact.max > bounds.maxX)
      return undefined
    return contact.side === "top"
      ? [contact.min - bounds.minX, contact.max - bounds.minX]
      : [width + height + bounds.maxX - contact.max, width + height + bounds.maxX - contact.min]
  }
  if (contact.side !== "left" && contact.side !== "right") return undefined
  const normal = contact.side === "left" ? bounds.minX : bounds.maxX
  if (Math.abs(contact.normal - normal) > slack || contact.min < bounds.minY || contact.max > bounds.maxY)
    return undefined
  return contact.side === "right"
    ? [width + bounds.maxY - contact.max, width + bounds.maxY - contact.min]
    : [2 * width + height + contact.min - bounds.minY, 2 * width + height + contact.max - bounds.minY]
}

/** Prove alternating contact order for every point in four boundary domains. */
export function haveAlternatingBoundaryContacts(
  bounds: Bounds,
  first: Pick<PlanarCrosscutDemand, "first" | "second">,
  second: Pick<PlanarCrosscutDemand, "first" | "second">,
  minimumTraceSpacing: number,
  slack: number,
): boolean {
  if (![...Object.values(bounds), minimumTraceSpacing, slack].every(Number.isFinite) ||
    bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY ||
    slack < 0 || minimumTraceSpacing <= 4 * slack)
    return false
  const endpoints = [first.first, first.second, second.first, second.second].map((contact, index) => ({
    owner: index < 2 ? 0 : 1,
    interval: perimeterInterval(contact, bounds, slack),
  }))
  if (endpoints.some((entry) => entry.interval === undefined)) return false
  endpoints.sort((a, b) => a.interval![0] - b.interval![0] || a.interval![1] - b.interval![1] || a.owner - b.owner)
  // Touching intervals retain their order: positive foreign trace spacing
  // prevents the two owners from selecting the same boundary junction.
  if (endpoints.some((entry, index) => index > 0 && endpoints[index - 1]!.interval![1] > entry.interval![0]))
    return false
  return endpoints[0]!.owner !== endpoints[1]!.owner &&
    endpoints[0]!.owner === endpoints[2]!.owner && endpoints[1]!.owner === endpoints[3]!.owner
}

/** Enforce the ordinary planar crossing invariant for owners with no via site. */
export function getNoViaPlanarCrossingFeasibility({
  bounds, wires, minimumTraceSpacing, slack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  if (![...Object.values(bounds), minimumTraceSpacing, slack].every(Number.isFinite) ||
    bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY ||
    slack < 0 || minimumTraceSpacing <= 4 * slack)
    return { feasible: true }
  const trapped = wires.filter((wire) => Object.values(wire.viaBounds).every(Number.isFinite) &&
    (wire.viaBounds.minX > wire.viaBounds.maxX || wire.viaBounds.minY > wire.viaBounds.maxY))
  for (let firstIndex = 0; firstIndex < trapped.length; firstIndex++) {
    const first = trapped[firstIndex]!
    for (let secondIndex = firstIndex + 1; secondIndex < trapped.length; secondIndex++) {
      const second = trapped[secondIndex]!
      if (first.owner === second.owner || first.layer !== second.layer) continue
      if (!haveAlternatingBoundaryContacts(bounds, first, second, minimumTraceSpacing, slack))
        continue
      const alternatives = new Map<string, number[]>()
      for (const wire of [first, second]) {
        if (wire.candidate) continue
        if (wire.routeIds.length === 0) throw new Error("A removable no-via crossing has no committed routes")
        const routes = [...new Set(wire.routeIds)].sort((a, b) => a - b)
        alternatives.set(JSON.stringify(routes), routes)
      }
      return alternatives.size === 0
        ? { feasible: false, blockerRouteIds: [] }
        : { feasible: false, alternativeBlockerRouteIdSets: [...alternatives.values()] }
    }
  }
  return { feasible: true }
}
