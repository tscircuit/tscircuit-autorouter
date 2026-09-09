import type {
  Candidate,
  JunctionPath,
  PadJunctionProblem,
} from "./padJunctionGeometry"
import {
  EPSILON,
  getItemOrThrow,
  getPathCost,
  simplifyJunctionPath,
} from "./padJunctionGeometry"

/** Join offset anchors with a 45-degree chamfer, then attach a perpendicular stem. */
export function getOctilinearCandidates(
  problem: PadJunctionProblem,
): Candidate[] {
  const first = problem.branches[0].anchor
  const second = problem.branches[1].anchor
  const paths: JunctionPath[] = []
  // Small lead-ins retain the incoming trace direction when a direct head would
  // turn backwards at a preserved anchor. They remain outside the target pad.
  const leads = (index: 0 | 1): JunctionPath => {
    const branch = problem.branches[index]
    const vx = branch.terminal.x - branch.anchor.x
    const vy = branch.terminal.y - branch.anchor.y
    const length = Math.hypot(vx, vy)
    if (length < EPSILON) return [branch.anchor]
    const maximum = Math.min(length / 3, Math.max(problem.width * 2, 0.25))
    return [0, maximum / 4, maximum / 2, maximum].map((distance) => ({
      x: branch.anchor.x + (vx * distance) / length,
      y: branch.anchor.y + (vy * distance) / length,
      z: problem.z,
    }))
  }
  for (const a of leads(0))
    for (const b of leads(1)) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
      const diagonalX = Math.sign(dx) * diagonal
      const diagonalY = Math.sign(dy) * diagonal
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const before = {
          x: a.x + (dx - diagonalX) * fraction,
          y: a.y + (dy - diagonalY) * fraction,
          z: problem.z,
        }
        const after = {
          x: before.x + diagonalX,
          y: before.y + diagonalY,
          z: problem.z,
        }
        paths.push(simplifyJunctionPath([first, a, before, after, b, second]))
      }
    }
  const candidates: Candidate[] = []
  for (const path of paths) {
    const totalLength = getPathCost(path).length
    let prefixLength = 0
    for (let index = 1; index < path.length; index++) {
      const start = getItemOrThrow(path, index - 1)
      const end = getItemOrThrow(path, index)
      const sx = end.x - start.x
      const sy = end.y - start.y
      const squaredLength = sx * sx + sy * sy
      if (squaredLength < EPSILON) continue
      // Every trunk segment is cardinal or 45 degrees, so its normal is too.
      const projection =
        ((problem.targetPad.center.x - start.x) * sx +
          (problem.targetPad.center.y - start.y) * sy) /
        squaredLength
      const segmentLength = Math.sqrt(squaredLength)
      const minimum = Math.max(
        problem.width / segmentLength,
        (totalLength * 0.25 - prefixLength) / segmentLength,
      )
      const maximum = Math.min(
        1 - problem.width / segmentLength,
        (totalLength * 0.75 - prefixLength) / segmentLength,
      )
      prefixLength += segmentLength
      if (minimum > maximum) continue
      const fractions = [
        projection,
        0.5,
        (totalLength * 0.5 - (prefixLength - segmentLength)) / segmentLength,
        minimum,
        maximum,
      ]
      for (const proposed of fractions) {
        const fraction = Math.max(minimum, Math.min(maximum, proposed))
        if (fraction < EPSILON || fraction > 1 - EPSILON) continue
        const junction = {
          x: start.x + fraction * sx,
          y: start.y + fraction * sy,
          z: problem.z,
        }
        const normalSign =
          -sy * (problem.targetPad.center.x - junction.x) +
            sx * (problem.targetPad.center.y - junction.y) >=
          0
            ? 1
            : -1
        const normal = { x: -sy * normalSign, y: sx * normalSign }
        let enter = 0
        let leave = Infinity
        const axes: ("x" | "y")[] = ["x", "y"]
        for (const axis of axes) {
          const halfSize =
            ((axis === "x"
              ? problem.targetPad.width
              : problem.targetPad.height) -
              problem.width) /
            2
          const minimum = problem.targetPad.center[axis] - halfSize
          const maximum = problem.targetPad.center[axis] + halfSize
          if (Math.abs(normal[axis]) < EPSILON) {
            if (junction[axis] < minimum || junction[axis] > maximum) leave = -1
            continue
          }
          const firstHit = (minimum - junction[axis]) / normal[axis]
          const secondHit = (maximum - junction[axis]) / normal[axis]
          enter = Math.max(enter, Math.min(firstHit, secondHit))
          leave = Math.min(leave, Math.max(firstHit, secondHit))
        }
        if (enter <= EPSILON || enter > leave) continue
        const entry = {
          x: junction.x + enter * normal.x,
          y: junction.y + enter * normal.y,
          z: problem.z,
        }
        candidates.push({
          junction,
          trunk: [
            [junction, ...path.slice(0, index).reverse()],
            [junction, ...path.slice(index)],
          ],
          padStem: [junction, entry],
        })
      }
    }
  }
  const cost = (
    candidate: Candidate,
  ): { bends: number; length: number; centerOffset: number } => {
    const trunk = getPathCost(
      simplifyJunctionPath(
        [...candidate.trunk[0]].reverse().concat(candidate.trunk[1].slice(1)),
      ),
    )
    const stem = getPathCost(candidate.padStem)
    const firstLength = getPathCost(candidate.trunk[0]).length
    const entry = getItemOrThrow(
      candidate.padStem,
      candidate.padStem.length - 1,
    )
    const terminal = problem.branches[0].terminal
    return {
      bends: trunk.bends + stem.bends,
      length:
        trunk.length +
        stem.length +
        Math.hypot(entry.x - terminal.x, entry.y - terminal.y),
      centerOffset: Math.abs(firstLength / trunk.length - 0.5),
    }
  }
  const unique = new Map<string, Candidate>()
  for (const candidate of candidates)
    unique.set(JSON.stringify(candidate), candidate)
  return [...unique.values()].sort(
    (a, b) =>
      cost(a).centerOffset - cost(b).centerOffset ||
      cost(a).length - cost(b).length ||
      cost(a).bends - cost(b).bends,
  )
}
