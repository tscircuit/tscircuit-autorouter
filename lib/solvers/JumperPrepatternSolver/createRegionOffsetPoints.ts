export interface CreateRegionOffsetPointsParams {
  baseX: number
  baseY: number
  r1Center: { x: number; y: number } | undefined
  r2Center: { x: number; y: number } | undefined
  cameFromRegion1: boolean
  insideJumperPad: boolean
  offsetDistance?: number
}

/**
 * Creates two offset points for a port, one entering each adjacent region.
 * This helps subsequent force-directed solvers understand the segment lies within the region.
 */
export function createRegionOffsetPoints(
  params: CreateRegionOffsetPointsParams,
): Array<{ x: number; y: number; z: number; insideJumperPad: boolean }> {
  const {
    baseX,
    baseY,
    r1Center,
    r2Center,
    cameFromRegion1,
    insideJumperPad,
    offsetDistance = 0.02,
  } = params
  const createOffsetPoint = (
    regionCenter: { x: number; y: number } | undefined,
  ) => {
    if (!regionCenter) {
      return { x: baseX, y: baseY, z: 0, insideJumperPad }
    }

    const dx = regionCenter.x - baseX
    const dy = regionCenter.y - baseY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist === 0) {
      return { x: baseX, y: baseY, z: 0, insideJumperPad }
    }

    return {
      x: baseX + (dx / dist) * offsetDistance,
      y: baseY + (dy / dist) * offsetDistance,
      z: 0,
      insideJumperPad,
    }
  }

  // Order based on direction of travel: first point enters the region we came from,
  // second point enters the region we're going to
  if (cameFromRegion1) {
    return [createOffsetPoint(r1Center), createOffsetPoint(r2Center)]
  }
  return [createOffsetPoint(r2Center), createOffsetPoint(r1Center)]
}
