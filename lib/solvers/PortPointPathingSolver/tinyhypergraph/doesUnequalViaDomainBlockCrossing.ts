export type ViaDomainBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type UnequalViaDomainCrossingInput = {
  cellBounds: ViaDomainBounds
  mandatoryViaBounds: ViaDomainBounds
  restrictedWireViaBounds: ViaDomainBounds
  otherWireViaBounds: ViaDomainBounds
  minimumForeignViaDistance: number
  minimumSameOwnerDrillDistance: number
  traceExclusionRadius: number
  slack: number
}

function hasAtMostOneRestrictedBarrel(
  width: number,
  height: number,
  foreignDistance: number,
  drillDistance: number,
  epsilon: number,
): boolean {
  if (foreignDistance > Math.hypot(width, height) + epsilon) return true
  if (foreignDistance <= Math.max(width, height) + epsilon) return false
  const dx = Math.max(
    0,
    Math.sqrt(foreignDistance ** 2 - height ** 2) - epsilon,
  )
  const dy = Math.max(0, Math.sqrt(foreignDistance ** 2 - width ** 2) - epsilon)
  if (dx <= width / 2 + epsilon || dy <= height / 2 + epsilon) return false
  // For any mandatory barrel, every restricted barrel is in its opposite
  // corner box. Two distinct drills cannot fit inside that box.
  const diameter = Math.hypot(Math.max(0, width - dx), Math.max(0, height - dy))
  return diameter + epsilon < drillDistance
}

function hasConnectedOtherBarrels(
  width: number,
  height: number,
  foreignDistance: number,
  exclusionRadius: number,
  epsilon: number,
): boolean {
  const separation = 2 * exclusionRadius
  if (Math.hypot(width, height) + epsilon < separation) return true
  if (
    separation <= Math.max(width, height) + epsilon ||
    foreignDistance <= height + epsilon
  )
    return false
  const dx = Math.max(0, Math.sqrt(separation ** 2 - height ** 2) - epsilon)
  const dy = Math.max(0, Math.sqrt(separation ** 2 - width ** 2) - epsilon)
  if (dx <= width / 2 + epsilon || dy <= height / 2 + epsilon) return false
  const cornerWidth = Math.max(0, width - dx)
  const cornerHeight = Math.max(0, height - dy)
  if (cornerHeight >= foreignDistance - epsilon) return false
  const minimumReach = Math.max(
    0,
    Math.sqrt(foreignDistance ** 2 - height ** 2) - epsilon,
  )
  if (minimumReach <= cornerWidth + epsilon) return false
  const oppositeReach = Math.max(
    0,
    Math.sqrt(foreignDistance ** 2 - cornerHeight ** 2) - epsilon,
  )
  // A pair separated by two exclusion radii lies in opposite corner boxes.
  // Its foreign-via discs cover both outside edges and overlap on every
  // horizontal slice: their summed reach is concave, so check its endpoints.
  // They would cover the mandatory barrel, making such a pair impossible.
  return minimumReach + oppositeReach > width + epsilon
}

/**
 * Certifies the geometry for two alternating, same-layer wire crosscuts and a
 * third owner's mandatory through-via. The caller must certify those demands,
 * their distinct owners, the complete barrel domains, and the absence of owned
 * multilayer contacts. False means this proof does not establish a conflict.
 */
export function doesUnequalViaDomainBlockCrossing({
  cellBounds,
  mandatoryViaBounds,
  restrictedWireViaBounds,
  otherWireViaBounds,
  minimumForeignViaDistance,
  minimumSameOwnerDrillDistance,
  traceExclusionRadius,
  slack,
}: UnequalViaDomainCrossingInput): boolean {
  const domains = [
    cellBounds,
    mandatoryViaBounds,
    restrictedWireViaBounds,
    otherWireViaBounds,
  ]
  const values = [
    ...domains.flatMap((bounds) => Object.values(bounds)),
    minimumForeignViaDistance,
    minimumSameOwnerDrillDistance,
    traceExclusionRadius,
    slack,
  ]
  if (
    !values.every(Number.isFinite) ||
    minimumForeignViaDistance <= 0 ||
    minimumSameOwnerDrillDistance <= 0 ||
    traceExclusionRadius <= 0 ||
    slack < 0
  )
    return false
  const epsilon = Math.max(
    slack,
    64 * Number.EPSILON * Math.max(1, ...values.map(Math.abs)),
  )
  for (const bounds of domains) {
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= epsilon ||
      height <= epsilon ||
      bounds.minX < cellBounds.minX ||
      bounds.maxX > cellBounds.maxX ||
      bounds.minY < cellBounds.minY ||
      bounds.maxY > cellBounds.maxY
    )
      return false
  }
  const [mandatory, restricted, other] = domains.slice(1).map((bounds) => ({
    minX: Math.max(cellBounds.minX, bounds.minX - epsilon),
    maxX: Math.min(cellBounds.maxX, bounds.maxX + epsilon),
    minY: Math.max(cellBounds.minY, bounds.minY - epsilon),
    maxY: Math.min(cellBounds.maxY, bounds.maxY + epsilon),
  }))
  const signal = {
    minX: Math.min(mandatory!.minX, restricted!.minX),
    maxX: Math.max(mandatory!.maxX, restricted!.maxX),
    minY: Math.min(mandatory!.minY, restricted!.minY),
    maxY: Math.max(mandatory!.maxY, restricted!.maxY),
  }
  if (
    signal.minX < other!.minX ||
    signal.maxX > other!.maxX ||
    signal.minY < other!.minY ||
    signal.maxY > other!.maxY
  )
    return false
  const foreignDistance = minimumForeignViaDistance - epsilon
  const drillDistance = minimumSameOwnerDrillDistance - epsilon
  const radius = traceExclusionRadius - epsilon
  if (foreignDistance <= 0 || drillDistance <= 0 || radius <= 0) return false
  if (
    !hasAtMostOneRestrictedBarrel(
      signal.maxX - signal.minX,
      signal.maxY - signal.minY,
      foreignDistance,
      drillDistance,
      epsilon,
    )
  )
    return false
  const width = other!.maxX - other!.minX
  const height = other!.maxY - other!.minY
  return hasConnectedOtherBarrels(
    Math.max(width, height),
    Math.min(width, height),
    foreignDistance,
    radius,
    epsilon,
  )
}
