export type ViaDomainRectangle = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type ConvexViaExclusion = ViaDomainRectangle & { radius: number }

type Input = {
  bounds: ViaDomainRectangle
  exclusions: readonly ConvexViaExclusion[]
  slack: number
}

// This limits geometry work only. Every unprocessed cell remains in the domain.
const maximumCoverChecks = 127

/** A rounded rectangle is convex, so covering four corners covers the cell. */
function coversRectangle(
  cell: ViaDomainRectangle,
  exclusion: ConvexViaExclusion,
  slack: number,
): boolean {
  const radius = exclusion.radius - slack
  if (radius <= 0) return false
  for (const x of [cell.minX, cell.maxX]) {
    for (const y of [cell.minY, cell.maxY]) {
      const dx = Math.max(exclusion.minX - x, x - exclusion.maxX, 0)
      const dy = Math.max(exclusion.minY - y, y - exclusion.maxY, 0)
      if (Math.hypot(dx, dy) >= radius) return false
    }
  }
  return true
}

/** Retain unresolved cells while combining certified convex obstacle covers. */
export function refineViaDomainByConvexCover({
  bounds,
  exclusions,
  slack,
}: Input): ViaDomainRectangle {
  if (![...Object.values(bounds), slack].every(Number.isFinite) || slack < 0)
    throw new Error(
      "Convex via-domain refinement requires finite geometry and nonnegative slack",
    )
  if (
    bounds.minX >= bounds.maxX ||
    bounds.minY >= bounds.maxY ||
    exclusions.length === 0
  )
    return bounds
  const guard = Math.max(
    slack,
    64 * Number.EPSILON * Math.max(1, ...Object.values(bounds).map(Math.abs)),
  )
  const known = exclusions.filter(
    (exclusion) =>
      [
        exclusion.minX,
        exclusion.maxX,
        exclusion.minY,
        exclusion.maxY,
        exclusion.radius,
      ].every(Number.isFinite) &&
      exclusion.minX <= exclusion.maxX &&
      exclusion.minY <= exclusion.maxY &&
      exclusion.radius > guard &&
      Math.hypot(
        Math.max(exclusion.minX - bounds.maxX, bounds.minX - exclusion.maxX, 0),
        Math.max(exclusion.minY - bounds.maxY, bounds.minY - exclusion.maxY, 0),
      ) <
        exclusion.radius - guard,
  )
  if (known.length === 0) return bounds
  const pending: ViaDomainRectangle[] = [bounds]
  const retained: ViaDomainRectangle[] = []
  let next = 0
  for (
    let checks = 0;
    next < pending.length && checks < maximumCoverChecks;
    checks++
  ) {
    const cell = pending[next++]!
    if (known.some((exclusion) => coversRectangle(cell, exclusion, guard)))
      continue
    if (cell.maxX - cell.minX >= cell.maxY - cell.minY) {
      const mid = cell.minX + (cell.maxX - cell.minX) / 2
      if (mid > cell.minX && mid < cell.maxX) {
        pending.push({ ...cell, maxX: mid }, { ...cell, minX: mid })
        continue
      }
    } else {
      const mid = cell.minY + (cell.maxY - cell.minY) / 2
      if (mid > cell.minY && mid < cell.maxY) {
        pending.push({ ...cell, maxY: mid }, { ...cell, minY: mid })
        continue
      }
    }
    retained.push(cell)
  }
  retained.push(...pending.slice(next))
  if (retained.length === 0)
    return {
      minX: bounds.maxX,
      maxX: bounds.minX,
      minY: bounds.maxY,
      maxY: bounds.minY,
    }
  return {
    minX: Math.min(...retained.map((cell) => cell.minX)),
    maxX: Math.max(...retained.map((cell) => cell.maxX)),
    minY: Math.min(...retained.map((cell) => cell.minY)),
    maxY: Math.max(...retained.map((cell) => cell.maxY)),
  }
}
