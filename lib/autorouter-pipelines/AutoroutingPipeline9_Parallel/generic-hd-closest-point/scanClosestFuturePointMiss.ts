import { distance } from "@tscircuit/math-utils"
import { hasNativeGenericIntrinsicContext, type NativeGenericIntrinsicContext } from "../NativeGenericHistoryTaskAuthority"

type Point = { x: number; y: number; z: number }
type ScanOwner = { futureConnectionPoints: Point[]; readonly viaPenaltyDistance: number }
export type ClosestFuturePointMissResult = { point: Point | null; index: number }

function readCurrentMathObject(): typeof Math {
  // The pinned distance expression resolves its Math base once per point.
  // Keep this live lookup separate from the privately proven sqrt reference:
  // a getter supplying the base must still execute at the original site.
  const base = Math
  return base
}

function invokeNonCallableSqrt(callee: unknown, dx: number, dy: number): number {
  // This path cannot establish native exception formatting: bundling can
  // rename the local Math. Closed active admission must exclude noncallable
  // values before any point read; unsupported domains use the literal loop.
  const Math = { sqrt: callee as typeof globalThis.Math.sqrt }
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Dormant miss-only kernel; it is not wired into a native owner/receiver.
 * Positive admission additionally requires a closed plain-data miss readset;
 * genuine sqrt identity alone cannot admit arbitrary mutable getter inputs.
 */
export function scanClosestFuturePointMiss(
  owner: ScanOwner,
  node: Point,
  context?: NativeGenericIntrinsicContext,
): ClosestFuturePointMissResult {
  let minDist = Infinity
  let closestPoint: Point | null = null
  let closestPointIndex = -1
  let pointIndex = 0
  if (!hasNativeGenericIntrinsicContext(context)) {
    for (const point of owner.futureConnectionPoints) {
      const dist = distance(node, point) + (node.z !== point.z ? owner.viaPenaltyDistance : 0)
      if (dist < minDist) {
        minDist = dist
        closestPoint = point
        closestPointIndex = pointIndex
      }
      pointIndex++
    }
    return { point: closestPoint, index: closestPointIndex }
  }

  const originalSqrt = context.sqrt
  const nativeApply = context.apply
  let groupsEnabled = true
  let planarValid = false
  let viaValid = false
  let planarMinimum = Infinity
  let viaMinimum = Infinity
  let viaPenalty = 0
  for (const p2 of owner.futureConnectionPoints) {
    // Keep the pinned math-utils x/y evaluation and sqrt property lookup order.
    const p1 = node
    const dx = p1.x - p2.x
    const dy = p1.y - p2.y
    const Math = readCurrentMathObject()
    const callee = Math.sqrt
    const square = dx * dx + dy * dy
    const pureNumericSqrt = callee === originalSqrt && typeof square === "number" && square === square
    let baseDistance: number
    if (!pureNumericSqrt) {
      groupsEnabled = false
      baseDistance = typeof callee === "function"
        ? nativeApply(callee, Math, [square])
        : invokeNonCallableSqrt(callee, dx, dy)
    }
    const isVia = p1.z !== p2.z
    const penalty = isVia ? owner.viaPenaltyDistance : 0
    const numericPenalty = typeof penalty === "number" && penalty === penalty
    const samePenalty = numericPenalty && penalty === viaPenalty && (penalty !== 0 || 1 / penalty === 1 / viaPenalty)
    if (pureNumericSqrt && groupsEnabled && numericPenalty &&
      (isVia ? viaValid && samePenalty && square >= viaMinimum : planarValid && square >= planarMinimum)) {
      pointIndex++
      continue
    }
    if (pureNumericSqrt) baseDistance = nativeApply(callee, Math, [square])
    const dist = baseDistance! + penalty
    if (typeof dist !== "number" || dist !== dist || !numericPenalty) groupsEnabled = false
    if (groupsEnabled) {
      if (!isVia) {
        if (!planarValid || square < planarMinimum) planarMinimum = square
        planarValid = true
      } else {
        if (!viaValid || !samePenalty || square < viaMinimum) {
          viaMinimum = square
          viaPenalty = penalty
        }
        viaValid = true
      }
    }
    if (dist < minDist) {
      minDist = dist
      closestPoint = p2
      closestPointIndex = pointIndex
    }
    pointIndex++
  }
  return { point: closestPoint, index: closestPointIndex }
}
