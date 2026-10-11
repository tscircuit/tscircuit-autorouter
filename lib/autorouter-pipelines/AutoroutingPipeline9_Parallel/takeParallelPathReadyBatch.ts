import type { HighDensityRoute } from "../../types/high-density-types"

export const MAX_PARALLEL_PATH_BATCH_ROUTES = 16
export const MAX_PARALLEL_PATH_BATCH_POINTS = 128
export const MAX_PARALLEL_PATH_SMALL_ROUTE_POINTS = 32

/** Only currently ready DAG nodes can share a native worker job. */
export function takeParallelPathReadyBatch(
  ready: number[],
  routes: ReadonlyArray<HighDensityRoute>,
  availableWorkers: number,
): number[] {
  if (!Number.isSafeInteger(availableWorkers) || availableWorkers < 1) {
    throw new Error("Path batching requires a positive available worker count")
  }
  if (ready.length === 0) return []
  // The coordinator already orders ready nodes by descending original size.
  // Divide small work among idle slots, retaining one job per heavy route.
  const targetCount = Math.min(MAX_PARALLEL_PATH_BATCH_ROUTES,
    Math.ceil(ready.length / availableWorkers))
  const first = ready.shift()!
  const batch = [first]
  let pointCount = routes[first]!.route.length
  if (pointCount > MAX_PARALLEL_PATH_SMALL_ROUTE_POINTS) return batch
  while (batch.length < targetCount && ready.length > 0) {
    const next = ready[0]!
    const nextPoints = routes[next]!.route.length
    if (nextPoints > MAX_PARALLEL_PATH_SMALL_ROUTE_POINTS ||
      pointCount + nextPoints > MAX_PARALLEL_PATH_BATCH_POINTS) break
    batch.push(ready.shift()!)
    pointCount += nextPoints
  }
  // The existing native worker requires ascending indexes: earlier completed
  // routes become visible, while every later peer keeps original geometry.
  return batch.sort((left, right) => left - right)
}
