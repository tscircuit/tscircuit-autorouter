import { spyOn } from "bun:test"
import {
  RouteStitchClearanceValidator,
  type StitchSegment,
} from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { BaseSolver } from "lib/solvers/BaseSolver"

/** Temporary hosted diagnostic for a failed stitch; removed after extraction. */
export function diagnoseStitchRepair(solver: BaseSolver): void {
  let rejected:
    | { segment: StitchSegment; validator: RouteStitchClearanceValidator }
    | undefined
  const original = RouteStitchClearanceValidator.prototype.findClearPath
  const spy = spyOn(
    RouteStitchClearanceValidator.prototype,
    "findClearPath",
  ).mockImplementation(function (
    this: RouteStitchClearanceValidator,
    segment: StitchSegment,
  ): ReturnType<typeof original> {
    const path = original.call(this, segment)
    if (!path) rejected = { segment, validator: this }
    return path
  })
  try {
    solver.solve()
  } finally {
    spy.mockRestore()
  }
  if (solver.failed && rejected) {
    console.error(
      "STITCH_REPAIR_FAILURE",
      JSON.stringify(rejected, (key, value) => {
        if (
          key === "sameNetCache" ||
          key === "segmentIndexesByLayer" ||
          key === "viaIndex" ||
          key === "obstacleIndex"
        )
          return undefined
        if (value instanceof Map) return [...value.entries()]
        if (value instanceof Set) return [...value]
        return value
      }),
    )
  }
}
