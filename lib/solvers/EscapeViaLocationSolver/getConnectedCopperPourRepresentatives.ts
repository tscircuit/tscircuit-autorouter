import type { Obstacle } from "lib/types"

/** Rectangles are board-world copper in mm (+X right, +Y up). A shared edge
 * conducts; a corner-only contact or a positive gap does not join regions.
 */
function copperRectsTouch(first: Obstacle, second: Obstacle): boolean {
  const firstAngle = ((first.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const secondAngle = ((second.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const firstAxes = [
    { x: Math.cos(firstAngle), y: Math.sin(firstAngle) },
    { x: -Math.sin(firstAngle), y: Math.cos(firstAngle) },
  ]
  const secondAxes = [
    { x: Math.cos(secondAngle), y: Math.sin(secondAngle) },
    { x: -Math.sin(secondAngle), y: Math.cos(secondAngle) },
  ]
  const contactAxes: { x: number; y: number }[] = []
  const tolerance = 1e-9
  for (const axis of [...firstAxes, ...secondAxes]) {
    const firstRadius =
      (first.width / 2) *
        Math.abs(axis.x * firstAxes[0].x + axis.y * firstAxes[0].y) +
      (first.height / 2) *
        Math.abs(axis.x * firstAxes[1].x + axis.y * firstAxes[1].y)
    const secondRadius =
      (second.width / 2) *
        Math.abs(axis.x * secondAxes[0].x + axis.y * secondAxes[0].y) +
      (second.height / 2) *
        Math.abs(axis.x * secondAxes[1].x + axis.y * secondAxes[1].y)
    const separation = Math.abs(
      (second.center.x - first.center.x) * axis.x +
      (second.center.y - first.center.y) * axis.y,
    )
    const overlap = firstRadius + secondRadius - separation
    if (overlap < -tolerance) return false
    if (
      overlap <= tolerance &&
      !contactAxes.some(
        (other) => Math.abs(other.x * axis.x + other.y * axis.y) > 1 - tolerance,
      )
    ) {
      contactAxes.push(axis)
    }
  }
  return contactAxes.length < 2
}

/** The caller supplies pours already restricted to one electrical net. Group
 * physically touching rectangles on the target layer, including transitive
 * strip contacts. A net alias alone never joins separate islands or layers.
 */
export function getConnectedCopperPourRepresentatives(
  copperPours: Obstacle[],
): Map<Obstacle, Obstacle> {
  const parents = copperPours.map((_, index) => index)
  function root(index: number): number {
    let current = index
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]]
      current = parents[current]
    }
    return current
  }
  for (let first = 0; first < copperPours.length; first++) {
    for (let second = first + 1; second < copperPours.length; second++) {
      const firstPour = copperPours[first]
      const secondPour = copperPours[second]
      if (firstPour.layers[0] !== secondPour.layers[0]) continue
      const firstRoot = root(first)
      const secondRoot = root(second)
      if (firstRoot === secondRoot) continue
      if (copperRectsTouch(firstPour, secondPour)) {
        parents[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot)
      }
    }
  }
  return new Map(copperPours.map((pour, index) => [pour, copperPours[root(index)]]))
}
