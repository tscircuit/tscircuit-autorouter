import type { Bounds, GridProvider } from "./gridRouter"

/** Axial coordinates: neighboring points are exactly pitch millimeters apart. */
export function createHexGrid(bounds: Bounds, pitch: number): GridProvider {
  if (!(pitch > 0)) throw new Error("Grid pitch must be positive")
  const h = Math.sqrt(3) / 2
  return {
    kind: "hex",
    pitch,
    directions: [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]],
    point(i, j) { return { x: bounds.minX + pitch * (i + j / 2), y: bounds.minY + pitch * h * j } },
    nearest(x, y) {
      const r = (y - bounds.minY) / (pitch * h)
      const q = (x - bounds.minX) / pitch - r / 2
      let qi = Math.round(q), ri = Math.round(r), si = Math.round(-q - r)
      const dq = Math.abs(qi - q), dr = Math.abs(ri - r), ds = Math.abs(si + q + r)
      if (dq > dr && dq > ds) qi = -ri - si
      else if (dr > ds) ri = -qi - si
      return [qi, ri]
    },
    distance(i, j, ti, tj) {
      const dq = i - ti, dr = j - tj
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) * pitch / 2
    },
  }
}
