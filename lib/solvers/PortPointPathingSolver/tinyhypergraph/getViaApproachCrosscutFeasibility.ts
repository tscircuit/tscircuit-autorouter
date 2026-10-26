import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Side = "left" | "right" | "top" | "bottom"
export type CrosscutBoundaryContact = {
  side: Side
  normal: number
  min: number
  max: number
}
type Demand = { owner: string; routeIds: number[]; candidate: boolean }
export type ViaApproachDemand = Demand & {
  layer: number
  bounds: Bounds
  contact: CrosscutBoundaryContact
}
export type PlanarCrosscutDemand = Demand & {
  layer: number
  viaBounds: Bounds
  first: CrosscutBoundaryContact
  second: CrosscutBoundaryContact
}
type Input = {
  bounds: Bounds
  approaches: ViaApproachDemand[]
  wires: PlanarCrosscutDemand[]
  radius: number
  minimumForeignViaSpacing: number
  minimumSameOwnerViaSpacing: number
  minimumTraceSpacing: number
  slack: number
}

/** Bound the largest possible distance between two legal via-center domains. */
function maximumDomainDistance(first: Bounds, second: Bounds): number {
  const dx = Math.max(
    Math.abs(first.minX - second.maxX),
    Math.abs(first.maxX - second.minX),
  )
  const dy = Math.max(
    Math.abs(first.minY - second.maxY),
    Math.abs(first.maxY - second.minY),
  )
  return Math.hypot(dx, dy)
}

/** Certify boundary contacts without inferring topology from port names. */
function isBoundaryContact(
  contact: CrosscutBoundaryContact,
  cell: Bounds,
  slack: number,
): boolean {
  if (
    ![contact.normal, contact.min, contact.max].every(Number.isFinite) ||
    !["left", "right", "top", "bottom"].includes(contact.side)
  )
    return false
  const vertical = contact.side === "left" || contact.side === "right"
  const normal =
    contact.side === "left"
      ? cell.minX
      : contact.side === "right"
        ? cell.maxX
        : contact.side === "bottom"
          ? cell.minY
          : cell.maxY
  const low = vertical ? cell.minY : cell.minX
  const high = vertical ? cell.maxY : cell.maxX
  return (
    Math.abs(contact.normal - normal) <= slack &&
    contact.min >= low - slack &&
    contact.max <= high + slack &&
    contact.min <= contact.max
  )
}

/** Prove that a required via approach separates the other same-layer route. */
export function getViaApproachCrosscutFeasibility({
  bounds,
  approaches,
  wires,
  radius,
  minimumForeignViaSpacing,
  minimumSameOwnerViaSpacing,
  minimumTraceSpacing,
  slack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  const rules = [
    ...Object.values(bounds),
    radius,
    minimumForeignViaSpacing,
    minimumSameOwnerViaSpacing,
    minimumTraceSpacing,
    slack,
  ]
  if (
    !rules.every(Number.isFinite) ||
    radius <= 0 ||
    minimumForeignViaSpacing <= 0 ||
    minimumSameOwnerViaSpacing <= 0 ||
    slack < 0 ||
    minimumTraceSpacing <= 4 * slack ||
    bounds.minX >= bounds.maxX ||
    bounds.minY >= bounds.maxY
  )
    return { feasible: true }
  for (const approach of approaches) {
    const box = approach.bounds
    if (
      !Object.values(box).every(Number.isFinite) ||
      box.minX > box.maxX ||
      box.minY > box.maxY ||
      box.minX < bounds.minX ||
      box.maxX > bounds.maxX ||
      box.minY < bounds.minY ||
      box.maxY > bounds.maxY ||
      !isBoundaryContact(approach.contact, bounds, slack) ||
      maximumDomainDistance(box, box) + slack >= minimumSameOwnerViaSpacing
    )
      continue
    for (const wire of wires) {
      if (
        approach.owner === wire.owner ||
        approach.layer !== wire.layer ||
        !isBoundaryContact(wire.first, bounds, slack) ||
        !isBoundaryContact(wire.second, bounds, slack)
      )
        continue
      const near =
        wire.first.side === approach.contact.side
          ? wire.first
          : wire.second.side === approach.contact.side
            ? wire.second
            : undefined
      if (!near) continue
      const far = near === wire.first ? wire.second : wire.first
      const opposite =
        (near.side === "left" && far.side === "right") ||
        (near.side === "right" && far.side === "left") ||
        (near.side === "top" && far.side === "bottom") ||
        (near.side === "bottom" && far.side === "top")
      if (!opposite) continue
      const other = wire.viaBounds
      if (!Object.values(other).every(Number.isFinite)) continue
      const emptyOther = other.minX > other.maxX || other.minY > other.maxY
      if (
        !emptyOther &&
        maximumDomainDistance(box, other) + slack >= minimumForeignViaSpacing
      )
        continue
      const verticalFace = near.side === "left" || near.side === "right"
      const farCoordinate =
        far.side === "left"
          ? bounds.minX
          : far.side === "right"
            ? bounds.maxX
            : far.side === "bottom"
              ? bounds.minY
              : bounds.maxY
      const lowNormal = verticalFace ? box.minX : box.minY
      const highNormal = verticalFace ? box.maxX : box.maxY
      if (Math.max(Math.abs(farCoordinate - lowNormal), Math.abs(farCoordinate - highNormal)) + slack >= radius)
        continue
      const low = verticalFace ? box.minY : box.minX
      const high = verticalFace ? box.maxY : box.maxX
      const below = near.max <= approach.contact.min &&
        high + radius < Math.min(approach.contact.min, far.min) - slack
      const above = near.min >= approach.contact.max &&
        low - radius > Math.max(approach.contact.max, far.max) + slack
      if (!below && !above) continue
      // Positive trace spacing prevents equal junction points from inverting
      // boundary order. The shrunk forbidden tube also covers rounding-sized
      // normal projections of the native boundary contacts.
      const alternatives = new Map<string, number[]>()
      for (const demand of [approach, wire]) {
        if (demand.candidate) continue
        if (demand.routeIds.length === 0) throw new Error("A removable approach crosscut has no committed routes")
        const routes = [...new Set(demand.routeIds)].sort((first, second) => first - second)
        alternatives.set(JSON.stringify(routes), routes)
      }
      return alternatives.size === 0
        ? { feasible: false, blockerRouteIds: [] }
        : { feasible: false, alternativeBlockerRouteIdSets: [...alternatives.values()] }
    }
  }
  return { feasible: true }
}
