import { MHPoint2 } from "./types2"
import { getEveryCombinationFromChoiceArray } from "./getEveryCombinationFromChoiceArray"
import { doSegmentsIntersect } from "@tscircuit/math-utils"

/**
 * Each item in viaCountVariants is an array specifying the number of vias
 * for each polyline. If a polyline has a layer change, it will always have
 * an odd number of vias, if it doesn't have a layer change, it will always
 * have an even number of vias or 0
 *
 * e.g. if we have...
 * SEGMENTS_PER_POLYLINE = 3
 * polyLine0 = no layer change
 * polyLine1 = layer change
 *
 * We would have these possible variants:
 * [
 *  [0, 1],
 *  [0, 3],
 *  [2, 1],
 *  [2, 3]
 * ]
 *
 * Likewise, if we have...
 * SEGMENTS_PER_POLYLINE = 4
 * polyLine0 = no layer change
 * polyLine1 = layer change
 * polyLine2 = no layer change
 * maxViaCount = 4
 * minViaCount = 2 (sometimes we know, because of same-layer intersections,
 *                  there must be at least N vias)
 *
 * We would have these possible variants:
 * [
 *  [0, 1, 0],
 *  [0, 1, 2],
 *  [0, 3, 0],
 *  [2, 1, 0],
 * ]
 */
export const computeViaCountVariants = (
  portPairsEntries: Array<
    [connectionName: string, { start: MHPoint2; end: MHPoint2 }]
  >,
  segmentsPerPolyline: number,
  maxViaCount: number,
  minViaCount: number,
): Array<number[]> => {
  const possibleViaCountsPerPolyline: number[][] = []

  for (const [, portPair] of portPairsEntries) {
    const needsLayerChange = portPair.start.z1 !== portPair.end.z1
    const possibleCounts: number[] = []

    for (let i = 0; i <= segmentsPerPolyline; i++) {
      const isOdd = i % 2 !== 0
      if (needsLayerChange && isOdd) {
        possibleCounts.push(i)
      } else if (!needsLayerChange && !isOdd) {
        possibleCounts.push(i)
      }
    }
    possibleViaCountsPerPolyline.push(possibleCounts)
  }

  // Generate Cartesian product of possible counts
  if (possibleViaCountsPerPolyline.length === 0) {
    return [[]] // No polylines, return one variant with empty counts
  }

  let variants: number[][] = getEveryCombinationFromChoiceArray(
    possibleViaCountsPerPolyline,
  ).filter((variant) => {
    for (let i = 0; i < variant.length; i++) {
      const viaCount = variant.reduce((acc, count) => acc + count, 0)
      if (viaCount < minViaCount) return false
    }
    return true
  })

  // If a port pair has a z change, it must always have at least 1 via
  variants = variants.filter((variant) => {
    for (let i = 0; i < portPairsEntries.length; i++) {
      const [, portPair1] = portPairsEntries[i]
      if (portPair1.start.z1 !== portPair1.start.z2) {
        if (variant[i] === 0) return false
      }
    }
    return true
  })

  // If two port pairs intersect, the sum of their via counts must be >= 2
  variants = variants.filter((variant) => {
    for (let i = 0; i < portPairsEntries.length; i++) {
      const [, portPair1] = portPairsEntries[i]
      if (portPairsEntries[i][1].start.z1 !== portPairsEntries[i][1].start.z2)
        continue
      for (let j = i + 1; j < portPairsEntries.length; j++) {
        if (portPairsEntries[j][1].start.z1 !== portPairsEntries[j][1].start.z2)
          continue

        const [, portPair2] = portPairsEntries[j]
        if (
          portPair1.start.z1 === portPair1.end.z1 &&
          portPair2.start.z1 === portPair2.end.z1 &&
          portPair1.start.z1 === portPair2.start.z1 &&
          doSegmentsIntersect(
            portPair1.start,
            portPair1.end,
            portPair2.start,
            portPair2.end,
          )
        ) {
          if (variant[i] + variant[j] < 2) return false
        }
      }
    }
    return true
  })

  variants = variants.filter((variant) => {
    const viaCount = variant.reduce((acc, count) => acc + count, 0)
    if (viaCount > maxViaCount) return false
    return true
  })

  return variants
}
