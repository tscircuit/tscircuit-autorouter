import { NodeWithPortPoints } from "lib/types/high-density-types"

/**
 * Maps a boundary point to a 1D perimeter coordinate.
 * Starting at top-left corner, going clockwise:
 * - Top edge (y=ymax): t = x - xmin
 * - Right edge (x=xmax): t = W + (ymax - y)
 * - Bottom edge (y=ymin): t = 2W + H + (xmax - x)
 * - Left edge (x=xmin): t = 2W + 2H + (y - ymin)
 */
function perimeterT(
  p: { x: number; y: number },
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
): number {
  const W = xmax - xmin
  const H = ymax - ymin
  const eps = 1e-6

  // Top edge
  if (Math.abs(p.y - ymax) < eps) {
    return p.x - xmin
  }
  // Right edge
  if (Math.abs(p.x - xmax) < eps) {
    return W + (ymax - p.y)
  }
  // Bottom edge
  if (Math.abs(p.y - ymin) < eps) {
    return W + H + (xmax - p.x)
  }
  // Left edge
  if (Math.abs(p.x - xmin) < eps) {
    return 2 * W + H + (p.y - ymin)
  }

  // Point is not exactly on boundary - find closest edge
  const distTop = Math.abs(p.y - ymax)
  const distRight = Math.abs(p.x - xmax)
  const distBottom = Math.abs(p.y - ymin)
  const distLeft = Math.abs(p.x - xmin)

  const minDist = Math.min(distTop, distRight, distBottom, distLeft)

  if (minDist === distTop) {
    return Math.max(0, Math.min(W, p.x - xmin))
  }
  if (minDist === distRight) {
    return W + Math.max(0, Math.min(H, ymax - p.y))
  }
  if (minDist === distBottom) {
    return W + H + Math.max(0, Math.min(W, xmax - p.x))
  }
  // Left edge
  return 2 * W + H + Math.max(0, Math.min(H, p.y - ymin))
}

/**
 * Check if two perimeter coordinates are coincident (within epsilon)
 */
function areCoincident(t1: number, t2: number, eps: number = 1e-6): boolean {
  return Math.abs(t1 - t2) < eps
}

/**
 * Count necessary crossings between chords on a circle using the interleaving criterion.
 * Two chords (a,b) and (c,d) with a < b and c < d cross iff: a < c < b < d OR c < a < d < b
 *
 * Chords that share a coincident endpoint do NOT count as crossing.
 *
 * Uses O(n^2) algorithm to correctly handle coincident endpoints.
 */
function countChordCrossings(chords: Array<[number, number]>): number {
  if (chords.length < 2) return 0

  // Normalize each chord so first endpoint is smaller
  const normalizedChords = chords.map(([t1, t2]) =>
    t1 < t2 ? ([t1, t2] as [number, number]) : ([t2, t1] as [number, number]),
  )

  let crossings = 0

  // Check all pairs of chords
  for (let i = 0; i < normalizedChords.length; i++) {
    const [a, b] = normalizedChords[i]
    for (let j = i + 1; j < normalizedChords.length; j++) {
      const [c, d] = normalizedChords[j]

      // Skip if chords share a coincident endpoint
      if (
        areCoincident(a, c) ||
        areCoincident(a, d) ||
        areCoincident(b, c) ||
        areCoincident(b, d)
      ) {
        continue
      }

      // Two chords cross iff their endpoints interleave: a < c < b < d OR c < a < d < b
      if ((a < c && c < b && b < d) || (c < a && a < d && d < b)) {
        crossings++
      }
    }
  }

  return crossings
}

/**
 * Compute intra-node crossings using the circle/perimeter mapping approach.
 *
 * This is topologically correct: two connections MUST cross if their boundary
 * points interleave around the perimeter, regardless of which side of the
 * rectangle they are on.
 *
 * Returns the same output structure as getIntraNodeCrossings.
 */
export const getIntraNodeCrossingsUsingCircle = (node: NodeWithPortPoints) => {
  const xmin = node.center.x - node.width / 2
  const xmax = node.center.x + node.width / 2
  const ymin = node.center.y - node.height / 2
  const ymax = node.center.y + node.height / 2

  // Group port points by connectionName
  const connectionPointsMap = new Map<
    string,
    Array<{ x: number; y: number; z: number }>
  >()

  for (const pp of node.portPoints) {
    const points = connectionPointsMap.get(pp.connectionName) ?? []
    // Avoid duplicate points
    if (!points.some((p) => p.x === pp.x && p.y === pp.y && p.z === pp.z)) {
      points.push({ x: pp.x, y: pp.y, z: pp.z })
    }
    connectionPointsMap.set(pp.connectionName, points)
  }

  // Separate same-layer pairs from transition pairs
  const sameLayerPairsByZ = new Map<number, Array<[number, number]>>()
  const transitionPairs: Array<[number, number]> = []
  let numEntryExitLayerChanges = 0

  for (const [connectionName, points] of connectionPointsMap) {
    if (points.length < 2) continue

    // Get the two endpoints for this connection
    const p1 = points[0]
    const p2 = points[1]

    // Map to perimeter coordinates
    const t1 = perimeterT(p1, xmin, xmax, ymin, ymax)
    const t2 = perimeterT(p2, xmin, xmax, ymin, ymax)

    if (p1.z === p2.z) {
      // Same layer - add to the layer's chord list
      const z = p1.z
      const chords = sameLayerPairsByZ.get(z) ?? []
      chords.push([t1, t2])
      sameLayerPairsByZ.set(z, chords)
    } else {
      // Transition pair - different layers
      numEntryExitLayerChanges++
      transitionPairs.push([t1, t2])
    }
  }

  // Count same-layer crossings (per layer, then sum)
  let numSameLayerCrossings = 0
  for (const [z, chords] of sameLayerPairsByZ) {
    numSameLayerCrossings += countChordCrossings(chords)
  }

  // Count transition pair crossings
  // Transition pairs can cross each other regardless of layer
  const numTransitionPairCrossings = countChordCrossings(transitionPairs)

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionPairCrossings,
  }
}
