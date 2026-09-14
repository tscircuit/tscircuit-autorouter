import { type Candidate, EPSILON, getPathCost } from "./padJunctionGeometry"

/** The stem must meet a straight part of the head within its middle 50%.
 * Measure along both trunk paths, including bends, rather than the anchor chord.
 */
export function candidateHasCenteredTJunction(candidate: Candidate): boolean {
  const [firstArm, secondArm] = candidate.trunk
  const firstLength = getPathCost(firstArm).length
  const secondLength = getPathCost(secondArm).length
  const headLength = firstLength + secondLength
  if (
    firstLength <= EPSILON ||
    secondLength <= EPSILON ||
    Math.min(firstLength, secondLength) < headLength / 4 - EPSILON
  ) {
    return false
  }

  const directions: { x: number; y: number }[] = []
  for (const arm of [firstArm, secondArm, candidate.padStem]) {
    const [start, next] = arm
    if (!start || !next) return false
    if (
      start.z !== candidate.junction.z ||
      next.z !== candidate.junction.z ||
      Math.hypot(
        start.x - candidate.junction.x,
        start.y - candidate.junction.y,
      ) > EPSILON
    ) {
      return false
    }
    const dx = next.x - start.x
    const dy = next.y - start.y
    const length = Math.hypot(dx, dy)
    if (length <= EPSILON) return false
    directions.push({ x: dx / length, y: dy / length })
  }
  const [first, second, stem] = directions
  if (!first || !second || !stem) return false
  return (
    Math.abs(first.x * second.y - first.y * second.x) <= EPSILON &&
    first.x * second.x + first.y * second.y < 0 &&
    Math.abs(first.x * stem.x + first.y * stem.y) <= EPSILON
  )
}
