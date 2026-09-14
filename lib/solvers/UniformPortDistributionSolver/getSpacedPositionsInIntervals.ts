import type { RoutingInterval } from "./types"

/** Places ordered centers in free intervals without borrowing space from copper. */
export function getSpacedPositionsInIntervals({
  intervals,
  preferredPositions,
  spacing,
  boundaryLabel,
}: {
  intervals: RoutingInterval[]
  preferredPositions: number[]
  spacing: number
  boundaryLabel: string
}): number[] {
  const latestPositions = new Array<number>(preferredPositions.length)
  let upperLimit = Number.POSITIVE_INFINITY
  for (let index = preferredPositions.length - 1; index >= 0; index--) {
    let latest = Number.NEGATIVE_INFINITY
    for (const interval of intervals) {
      const candidate = Math.min(interval.max, upperLimit)
      if (candidate >= interval.min - 1e-6) latest = Math.max(latest, candidate)
    }
    if (!Number.isFinite(latest)) {
      throw new Error(
        `Shared edge "${boundaryLabel}" has insufficient copper-clear capacity for ${preferredPositions.length} ports`,
      )
    }
    latestPositions[index] = latest
    upperLimit = latest - spacing
  }
  const positions: number[] = []
  let lowerLimit = Number.NEGATIVE_INFINITY
  for (const [index, preferred] of preferredPositions.entries()) {
    let selected = Number.NaN
    let distance = Number.POSITIVE_INFINITY
    for (const interval of intervals) {
      const min = Math.max(interval.min, lowerLimit)
      const max = Math.min(interval.max, latestPositions[index]!)
      if (min > max + 1e-6) continue
      const candidate = Math.max(min, Math.min(max, preferred))
      const candidateDistance = Math.abs(candidate - preferred)
      if (candidateDistance < distance) {
        selected = candidate
        distance = candidateDistance
      }
    }
    if (!Number.isFinite(selected)) {
      throw new Error(
        `Shared edge "${boundaryLabel}" cannot place port ${index} inside its copper-clear intervals`,
      )
    }
    positions.push(selected)
    lowerLimit = selected + spacing
  }
  return positions
}
