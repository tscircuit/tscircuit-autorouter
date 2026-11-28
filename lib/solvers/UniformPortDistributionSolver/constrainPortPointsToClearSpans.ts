import { getSegmentCapsuleInterval } from "lib/utils/getSegmentCapsuleInterval"
import type { PortPoint } from "lib/types/high-density-types"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

export type PortPointClearSpans = (
  point: PortPointWithOwnerPair,
  edge: SharedEdge,
) => Array<[number, number]>

/** Place ordered crossings in clear edge intervals without collapsing neighbors. */
export function constrainPortPointsToClearSpans({
  sharedEdge,
  portPoints,
  getClearSpans,
  minimumSpacing,
  fixedPortPoints,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  getClearSpans: PortPointClearSpans
  minimumSpacing: number
  fixedPortPoints: readonly PortPoint[]
}): PortPointWithOwnerPair[] {
  const result: PortPointWithOwnerPair[] = []
  const layers = new Set(portPoints.map((point) => point.z))
  const fractionSpacing = minimumSpacing / sharedEdge.length
  for (const z of layers) {
    const points = portPoints.filter((point) => point.z === z).sort((a, b) =>
      sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
    )
    const spacingAfter = points.map((point, index) => {
      const next = points[index + 1]
      return next && (point.rootConnectionName ?? point.connectionName) !==
        (next.rootConnectionName ?? next.connectionName) ? fractionSpacing : 0
    })
    const spans = points.map((point) => {
      const blocked = fixedPortPoints.flatMap((fixed): Array<[number, number]> => {
        if (fixed.z !== point.z || (fixed.rootConnectionName ?? fixed.connectionName) ===
          (point.rootConnectionName ?? point.connectionName)) return []
        const interval = getSegmentCapsuleInterval({
          start: { x: sharedEdge.x1, y: sharedEdge.y1 },
          end: { x: sharedEdge.x2, y: sharedEdge.y2 },
          capsuleStart: fixed, capsuleEnd: fixed, radius: minimumSpacing,
        })
        return interval ? [interval] : []
      }).sort((a, b) => a[0] - b[0])
      return getClearSpans(point, sharedEdge).flatMap(([low, high]): Array<[number, number]> => {
        const clear: Array<[number, number]> = []
        let cursor = low
        for (const [entry, exit] of blocked) {
          if (exit <= cursor || entry >= high) continue
          if (entry > cursor) clear.push([cursor, Math.min(entry, high)])
          cursor = Math.max(cursor, exit)
        }
        if (cursor < high) clear.push([cursor, high])
        return clear
      })
    })
    const latest: number[] = new Array(points.length)
    let upper = 1
    for (let index = points.length - 1; index >= 0; index--) {
      const span = spans[index]!.findLast(([low]) => low <= upper + 1e-9)
      if (!span) throw new Error(`No clear shared-edge placement for "${points[index]!.connectionName}" at "${points[index]!.portPointId}"`)
      latest[index] = Math.min(upper, span[1])
      upper = latest[index]! - (spacingAfter[index - 1] ?? 0)
    }
    let lower = 0
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!
      const preferred = sharedEdge.orientation === "horizontal"
        ? (point.x - sharedEdge.x1) / sharedEdge.length
        : (point.y - sharedEdge.y1) / sharedEdge.length
      const candidates = spans[index]!.flatMap(([low, high]): number[] => {
        const start = Math.max(low, lower)
        const end = Math.min(high, latest[index]!)
        return start <= end + 1e-9
          ? [preferred >= start && preferred <= end ? preferred : (start + end) / 2]
          : []
      })
      candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
      if (candidates.length === 0) throw new Error(`No spaced shared-edge placement for "${point.connectionName}" at "${point.portPointId}"`)
      const fraction = candidates[0]!
      result.push({ ...point,
        x: sharedEdge.x1 + (sharedEdge.x2 - sharedEdge.x1) * fraction,
        y: sharedEdge.y1 + (sharedEdge.y2 - sharedEdge.y1) * fraction,
      })
      lower = fraction + spacingAfter[index]!
    }
  }
  return result
}
