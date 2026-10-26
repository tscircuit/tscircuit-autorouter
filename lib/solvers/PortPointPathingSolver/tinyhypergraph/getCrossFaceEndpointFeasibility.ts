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
  return blockers.size === 0
    ? { feasible: true }
    : { feasible: false, blockerRouteIds: [...blockers].sort((a, b) => a - b) }
}
