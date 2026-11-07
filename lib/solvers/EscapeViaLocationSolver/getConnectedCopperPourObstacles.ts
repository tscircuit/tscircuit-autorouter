import type { Obstacle } from "../../types"

const COORDINATE_TOLERANCE = 1e-8

/** Map each rectangular pour tile to one representative of its copper island. */
export function getConnectedCopperPourObstacles(
  copperPours: Obstacle[],
): Map<Obstacle, Obstacle> {
  const representativeByObstacle = new Map<Obstacle, Obstacle>()
  for (const representative of copperPours) {
    if (representativeByObstacle.has(representative)) continue
    representativeByObstacle.set(representative, representative)
    const pending = [representative]
    while (pending.length > 0) {
      const current = pending.pop()!
      for (const candidate of copperPours) {
        if (representativeByObstacle.has(candidate)) continue
        // Escape vias target the first layer of a pour obstacle. Overlapping
        // planes on different layers are not electrically connected.
        if (current.layers[0] !== candidate.layers[0]) continue
        if (
          !current.connectedTo.some((net) =>
            candidate.connectedTo.includes(net),
          )
        ) {
          continue
        }
        // Bounding boxes only establish contact for axis-aligned rectangles.
        if (
          current.shape === "circle" ||
          candidate.shape === "circle" ||
          (current.ccwRotationDegrees ?? 0) % 360 !== 0 ||
          (candidate.ccwRotationDegrees ?? 0) % 360 !== 0
        ) {
          continue
        }
        const overlapX =
          (current.width + candidate.width) / 2 -
          Math.abs(current.center.x - candidate.center.x)
        const overlapY =
          (current.height + candidate.height) / 2 -
          Math.abs(current.center.y - candidate.center.y)
        // A shared edge joins tiles. A corner alone has no conductive width.
        if (
          overlapX < -COORDINATE_TOLERANCE ||
          overlapY < -COORDINATE_TOLERANCE ||
          (overlapX <= COORDINATE_TOLERANCE && overlapY <= COORDINATE_TOLERANCE)
        ) {
          continue
        }
        representativeByObstacle.set(candidate, representative)
        pending.push(candidate)
      }
    }
  }
  return representativeByObstacle
}
