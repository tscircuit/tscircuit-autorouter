import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

/** Match every surviving fault; total-count reductions cannot hide new faults. */
export const hasNoNewOrWorseCopperErrors = (
  initial: Pipeline9DrcError[],
  remaining: Pipeline9DrcError[],
): boolean => {
  const unmatched = [...initial]
  for (const error of remaining) {
    const identity = Object.entries(error).find(
      ([key, value]) => key.endsWith("_error_id") && typeof value === "string",
    )
    if (!identity) return false
    const index = unmatched.findIndex(
      (old) => old.type === error.type && old[identity[0]] === identity[1],
    )
    if (index < 0) return false
    const old = unmatched.splice(index, 1)[0]!
    if (typeof error.actual_clearance === "number") {
      if (
        !Number.isFinite(error.actual_clearance) ||
        typeof old.actual_clearance !== "number" ||
        !Number.isFinite(old.actual_clearance) ||
        error.minimum_clearance !== old.minimum_clearance ||
        error.actual_clearance + 1e-9 < old.actual_clearance
      ) {
        return false
      }
    } else {
      const gap = String(error.message).match(/gap: (-?\d+(?:\.\d+)?)mm/)
      const oldGap = String(old.message).match(/gap: (-?\d+(?:\.\d+)?)mm/)
      if (gap && oldGap) {
        if (Number(gap[1]) < Number(oldGap[1])) return false
      } else if (JSON.stringify(error) !== JSON.stringify(old)) {
        return false
      }
    }
  }
  return true
}

const getTraceGap = (a: HighDensityRoute, b: HighDensityRoute): number => {
  let gap = Number.POSITIVE_INFINITY
  for (let i = 1; i < a.route.length; i++) {
    const fromA = a.route[i - 1]!
    const toA = a.route[i]!
    if (fromA.z !== toA.z || fromA.toNextSegmentType) continue
    const radiusA =
      Math.max(
        fromA.traceThickness ?? a.traceThickness,
        toA.traceThickness ?? a.traceThickness,
      ) / 2
    for (let j = 1; j < b.route.length; j++) {
      const fromB = b.route[j - 1]!
      const toB = b.route[j]!
      if (fromB.z !== toB.z || fromB.z !== fromA.z || fromB.toNextSegmentType)
        continue
      const radiusB =
        Math.max(
          fromB.traceThickness ?? b.traceThickness,
          toB.traceThickness ?? b.traceThickness,
        ) / 2
      gap = Math.min(
        gap,
        minimumDistanceBetweenSegments(fromA, toA, fromB, toB) -
          radiusA -
          radiusB,
      )
    }
  }
  return gap
}

/** DRC messages round gaps; compare the continuous geometry as well. */
export const hasNoWorseTraceGapGeometry = (
  initial: HighDensityRoute[],
  candidate: HighDensityRoute[],
  errors: Pipeline9DrcError[],
): boolean => {
  for (const error of errors) {
    if (
      error.type !== "pcb_trace_error" ||
      !String(error.message).includes("gap:")
    )
      continue
    const indices = getDrcErrorTraceIds(error).map((id) =>
      initial.findIndex((route) => route.connectionName === id),
    )
    if (indices.length !== 2 || indices.some((index) => index < 0)) continue
    const [a, b] = indices as [number, number]
    if (initial[a] === candidate[a] && initial[b] === candidate[b]) continue
    const oldGap = getTraceGap(initial[a]!, initial[b]!)
    const newGap = getTraceGap(candidate[a]!, candidate[b]!)
    if (
      !Number.isFinite(oldGap) ||
      !Number.isFinite(newGap) ||
      newGap + 1e-9 < oldGap
    )
      return false
  }
  return true
}
