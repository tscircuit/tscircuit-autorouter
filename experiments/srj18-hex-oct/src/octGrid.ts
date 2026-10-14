import type { GridProvider } from "./gridRouter"

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Eight-direction square lattice (also called octile routing).
 *
 * Regular octagons alone cannot tile the plane. This experiment therefore
 * interprets "octagonal grid" as eight allowed headings, 45 degrees apart,
 * on a square lattice. Cardinal edges cost pitch and diagonal edges cost
 * pitch * sqrt(2), so geometric wire length is preserved.
 */
export function createOctGrid(bounds: Bounds, pitch: number): GridProvider {
  if (!(pitch > 0) || !Number.isFinite(pitch)) {
    throw new Error("Octagonal grid pitch must be positive and finite")
  }
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw new Error("Octagonal grid bounds must be finite and ordered")
  }

  return {
    kind: "octagonal",
    pitch,
    directions: [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ],
    point(i, j) {
      return { x: bounds.minX + i * pitch, y: bounds.minY + j * pitch }
    },
    nearest(x, y) {
      // Keep negative indices valid; the router applies physical board bounds.
      return [
        Math.round((x - bounds.minX) / pitch),
        Math.round((y - bounds.minY) / pitch),
      ]
    },
    distance(i, j, ti, tj) {
      const di = Math.abs(ti - i)
      const dj = Math.abs(tj - j)
      const diagonalSteps = Math.min(di, dj)
      const cardinalSteps = Math.max(di, dj) - diagonalSteps
      return pitch * (cardinalSteps + Math.SQRT2 * diagonalSteps)
    },
  }
}

/** Equalize square-lattice node density with a triangular/hexagonal lattice. */
export function octPitchAtHexDensity(hexPitch: number): number {
  if (!(hexPitch > 0) || !Number.isFinite(hexPitch)) {
    throw new Error("Hexagonal grid pitch must be positive and finite")
  }
  // Hex lattice area per vertex is sqrt(3)/2 * hexPitch^2.
  return hexPitch * Math.sqrt(Math.sqrt(3) / 2)
}
