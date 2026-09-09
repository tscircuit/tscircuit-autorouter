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
  const dx = second.x - first.x
  const dy = second.y - first.y
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
  const diagonalX = Math.sign(dx) * diagonal
  const diagonalY = Math.sign(dy) * diagonal
  const paths: JunctionPath[] = [
    simplifyJunctionPath([
      first,
      { x: first.x + diagonalX, y: first.y + diagonalY, z: problem.z },
      second,
    ]),
    simplifyJunctionPath([
      first,
      { x: second.x - diagonalX, y: second.y - diagonalY, z: problem.z },
      second,
    ]),
  ]
  const candidates: Candidate[] = []
  for (const path of paths) {
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
      const insetFraction = Math.min(
        0.25,
        problem.width / Math.sqrt(squaredLength),
      )
      const fraction = Math.max(
        insetFraction,
        Math.min(1 - insetFraction, projection),
      )
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
          ((axis === "x" ? problem.targetPad.width : problem.targetPad.height) -
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
  const cost = (candidate: Candidate): { bends: number; length: number } => {
    const trunk = getPathCost(
      simplifyJunctionPath(
        [...candidate.trunk[0]].reverse().concat(candidate.trunk[1].slice(1)),
      ),
    )
    const stem = getPathCost(candidate.padStem)
    return {
      bends: trunk.bends + stem.bends,
      length: trunk.length + stem.length,
    }
  }
  return candidates.sort(
    (a, b) => cost(a).bends - cost(b).bends || cost(a).length - cost(b).length,
  )
}
