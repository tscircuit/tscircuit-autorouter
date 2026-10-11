import type { HighDensityRoute } from "../../types/high-density-types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type ParallelPathDependencies = {
  predecessors: number[][]
  successors: number[][]
  maximumReadyCount: number
}

const roundingValue = new Float64Array(1)
const roundingBits = new BigUint64Array(roundingValue.buffer)

function roundOutward(value: number, upward: boolean): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return upward ? Number.MIN_VALUE : -Number.MIN_VALUE
  roundingValue[0] = value
  roundingBits[0] += value > 0 === upward ? 1n : -1n
  return roundingValue[0]!
}

function pathsIgnoreEachOther(left: HighDensityRoute, right: HighDensityRoute, connMap: ConnectivityMap | undefined): boolean {
  const leftIds = [left.connectionName, left.rootConnectionName].filter((id): id is string => id !== undefined)
  const rightIds = [right.connectionName, right.rootConnectionName].filter((id): id is string => id !== undefined)
  const forward = leftIds.some((leftId) => rightIds.some((rightId) => leftId === rightId || connMap?.areIdsConnected(leftId, rightId)))
  const backward = rightIds.some((rightId) => leftIds.some((leftId) => rightId === leftId || connMap?.areIdsConnected(rightId, leftId)))
  // Both native predicates must ignore the peer; aliased/custom maps can be asymmetric.
  return forward && backward
}

/** A later overlapping path observes the completed earlier path, not its input. */
export function getParallelPathDependencies(
  routes: ReadonlyArray<HighDensityRoute>,
  useTraceWidthAwareClearance: boolean,
  connMap?: ConnectivityMap,
): ParallelPathDependencies {
  let radius = 0.15 / 2
  for (const route of routes) {
    radius = Math.max(radius, Math.abs(route.viaDiameter / 2))
    if (useTraceWidthAwareClearance) {
      radius = Math.max(radius, Math.abs(route.traceThickness / 2))
      for (const point of route.route) radius = Math.max(radius, Math.abs((point.traceThickness ?? route.traceThickness) / 2))
    }
  }
  const expansion = roundOutward(radius + 0.1 + 1e-9, true)
  const bounds: Bounds[] = routes.map((route) => {
    const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const point of [...route.route, ...route.vias]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }
      }
      box.minX = Math.min(box.minX, roundOutward(roundOutward(point.x, false) - expansion, false))
      box.maxX = Math.max(box.maxX, roundOutward(roundOutward(point.x, true) + expansion, true))
      box.minY = Math.min(box.minY, roundOutward(roundOutward(point.y, false) - expansion, false))
      box.maxY = Math.max(box.maxY, roundOutward(roundOutward(point.y, true) + expansion, true))
    }
    return box
  })
  const predecessors = routes.map(() => [] as number[])
  const successors = routes.map(() => [] as number[])
  const hasJumpers = routes.some((route) => route.jumpers?.length)
  for (let left = 0; left < routes.length; left++) {
    for (let right = left + 1; right < routes.length; right++) {
      const a = bounds[left]!
      const b = bounds[right]!
      if (!hasJumpers && (a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY)) continue
      if (!hasJumpers && pathsIgnoreEachOther(routes[left]!, routes[right]!, connMap)) continue
      predecessors[right]!.push(left)
      successors[left]!.push(right)
    }
  }
  const remaining = predecessors.map((indexes) => indexes.length)
  let ready = remaining.flatMap((count, index) => count === 0 ? [index] : [])
  let maximumReadyCount = ready.length
  while (ready.length > 0) {
    const next: number[] = []
    for (const index of ready) {
      for (const successor of successors[index]!) {
        remaining[successor]!--
        if (remaining[successor] === 0) next.push(successor)
      }
    }
    maximumReadyCount = Math.max(maximumReadyCount, next.length)
    ready = next
  }
  return { predecessors, successors, maximumReadyCount }
}
