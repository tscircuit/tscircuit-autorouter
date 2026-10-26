import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"

export type EndpointDomainEvent = {
  portId: number
  faceKey: string
  owner: string
  z: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  routeIds: number[]
  candidate: boolean
}

type Input = {
  events: EndpointDomainEvent[]
  minimumSpacing: number
  slack: number
}

type Bounds = EndpointDomainEvent["bounds"]
type WorkingDomain = {
  event: EndpointDomainEvent
  bounds: Bounds
  proof: Set<number>
  candidateRelated: boolean
}

/** Remove an open forbidden strip, retaining its boundary and any split hull. */
function trimOutsideOpenStrip(
  bounds: Bounds,
  axis: "x" | "y",
  low: number,
  high: number,
): "unchanged" | "changed" | "empty" {
  const min = axis === "x" ? "minX" : "minY"
  const max = axis === "x" ? "maxX" : "maxY"
  if (low >= high || bounds[max] <= low || bounds[min] >= high)
    return "unchanged"
  const left = bounds[min] <= low, right = bounds[max] >= high
  if (left && right) return "unchanged"
  if (!left && !right) return "empty"
  if (left) bounds[max] = low
  else bounds[min] = high
  return "changed"
}

/** Combine necessary pair-distance bounds without choosing endpoint positions. */
function contractEndpointDomains({ events, minimumSpacing, slack }: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  if (events.length < 3) return { feasible: true }
  const scale = events.reduce((maximum, event) => Math.max(maximum,
    ...Object.values(event.bounds).map(Math.abs)), Math.max(1, minimumSpacing))
  const error = Math.max(slack, 128 * Number.EPSILON * scale)
  const gap = minimumSpacing - error
  if (gap <= 0) return { feasible: true }
  const domains: WorkingDomain[] = events.map((event, index) => ({
    event, bounds: { ...event.bounds }, proof: new Set([index]), candidateRelated: event.candidate,
  }))
  // Stopping early only leaves wider domains. Empty domains always carry the
  // exact endpoint-event obligations used to derive their necessary bounds.
  for (let pass = 0; pass < 2; pass++) {
    let changed = false
    for (const first of domains) for (const second of domains) {
      if (first === second || first.event.portId === second.event.portId ||
        first.event.faceKey === second.event.faceKey || first.event.z !== second.event.z ||
        first.event.owner === second.event.owner ||
        (!first.candidateRelated && !second.candidateRelated))
        continue
      const minDX = Math.max(first.bounds.minX - second.bounds.maxX, second.bounds.minX - first.bounds.maxX, 0)
      const minDY = Math.max(first.bounds.minY - second.bounds.maxY, second.bounds.minY - first.bounds.maxY, 0)
      if (minDX * minDX + minDY * minDY >= minimumSpacing * minimumSpacing) continue
      for (const axis of ["x", "y"] as const) {
        const transverse = axis === "x"
          ? Math.max(Math.abs(first.bounds.minY - second.bounds.maxY), Math.abs(first.bounds.maxY - second.bounds.minY))
          : Math.max(Math.abs(first.bounds.minX - second.bounds.maxX), Math.abs(first.bounds.maxX - second.bounds.minX))
        if (transverse >= gap) continue
        const radius = gap * Math.sqrt(Math.max(0, 1 - (transverse / gap) ** 2)) - error
        if (radius <= 0) continue
        const low = (axis === "x" ? second.bounds.maxX : second.bounds.maxY) - radius
        const high = (axis === "x" ? second.bounds.minX : second.bounds.minY) + radius
        const result = trimOutsideOpenStrip(first.bounds, axis, low, high)
        if (result === "unchanged") continue
        first.candidateRelated ||= second.candidateRelated
        for (const index of second.proof) first.proof.add(index)
        if (result === "changed") { changed = true; continue }
        const alternatives = new Map<string, number[]>()
        for (const index of first.proof) {
          const event = domains[index]!.event
          if (event.candidate) continue
          if (event.routeIds.length === 0)
            throw new Error("A removable endpoint-domain obligation has no committed routes")
          const routes = [...new Set(event.routeIds)].sort((a, b) => a - b)
          alternatives.set(JSON.stringify(routes), routes)
        }
        return alternatives.size === 0
          ? { feasible: false, blockerRouteIds: [] }
          : { feasible: false, alternativeBlockerRouteIdSets: [...alternatives.values()] }
      }
    }
    if (!changed) break
  }
  return { feasible: true }
}

/** Reject endpoint pairs whose complete domains cannot reach trace pitch. */
export function getCrossFaceEndpointFeasibility({
  events,
  minimumSpacing,
  slack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  if (
    !Number.isFinite(minimumSpacing) ||
    minimumSpacing <= 0 ||
    !Number.isFinite(slack) ||
    slack < 0
  )
    return { feasible: true }
  const valid = events.filter((event) => {
    const bounds = event.bounds
    return (
      Object.values(bounds).every(Number.isFinite) &&
      bounds.minX <= bounds.maxX &&
      bounds.minY <= bounds.maxY
    )
  })
  const blockers = new Set<number>()
  for (const candidate of valid) {
    if (!candidate.candidate) continue
    for (const peer of valid) {
      if (
        peer.candidate ||
        candidate.portId === peer.portId ||
        candidate.faceKey === peer.faceKey ||
        candidate.z !== peer.z ||
        candidate.owner === peer.owner
      )
        continue
      const first = candidate.bounds
      const second = peer.bounds
      const dx = Math.max(
        Math.abs(first.minX - second.maxX),
        Math.abs(first.maxX - second.minX),
      )
      const dy = Math.max(
        Math.abs(first.minY - second.maxY),
        Math.abs(first.maxY - second.minY),
      )
      const error = Math.max(
        slack,
        128 *
          Number.EPSILON *
          Math.max(
            1,
            ...Object.values(first).map(Math.abs),
            ...Object.values(second).map(Math.abs),
          ),
      )
      if (Math.hypot(dx, dy) + error >= minimumSpacing) continue
      if (peer.routeIds.length === 0)
        throw new Error("A removable endpoint event has no committed routes")
      for (const routeId of peer.routeIds) blockers.add(routeId)
    }
  }
  if (blockers.size > 0)
    return { feasible: false, blockerRouteIds: [...blockers].sort((a, b) => a - b) }
  return contractEndpointDomains({ events: valid, minimumSpacing, slack })
}
