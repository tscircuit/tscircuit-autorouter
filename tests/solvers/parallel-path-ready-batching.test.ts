import { expect, test } from "bun:test"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import {
  takeParallelPathReadyBatch,
  MAX_PARALLEL_PATH_BATCH_POINTS,
  MAX_PARALLEL_PATH_BATCH_ROUTES,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/takeParallelPathReadyBatch"

function routeWithPoints(count: number): HighDensityRoute {
  return { connectionName: String(count), traceThickness: .1, viaDiameter: .3, vias: [],
    route: Array.from({ length: count }, (_, index) => ({x:index,y:0,z:0})) }
}

test("ready-path batches retain heavy singletons, ascending native order and bounded work while dividing idle slots", (): void => {
  const routes = [routeWithPoints(300), ...Array.from({ length: 80 }, () => routeWithPoints(8))]
  const ready = routes.map((_, index) => index)
  expect(takeParallelPathReadyBatch(ready, routes, 4)).toEqual([0])
  const consumed: number[] = [0]
  while (ready.length > 0) {
    const previous = [...ready]
    const batch = takeParallelPathReadyBatch(ready, routes, 4)
    expect(batch.length).toBeLessThanOrEqual(MAX_PARALLEL_PATH_BATCH_ROUTES)
    expect(batch.reduce((sum, index) => sum + routes[index]!.route.length, 0)).toBeLessThanOrEqual(MAX_PARALLEL_PATH_BATCH_POINTS)
    expect(batch).toEqual([...batch].sort((left, right) => left - right))
    expect([...batch, ...ready].sort((left, right) => left - right)).toEqual(previous.sort((left, right) => left - right))
    consumed.push(...batch)
  }
  expect(consumed).toEqual(routes.map((_, index) => index))
  const reverse = [80, 5, 1, 9]
  expect(takeParallelPathReadyBatch(reverse, routes, 1)).toEqual([1, 5, 9, 80])
  expect(reverse).toEqual([])
  expect(takeParallelPathReadyBatch([], routes, 4)).toEqual([])
  expect(() => takeParallelPathReadyBatch([1], routes, 0)).toThrow("positive available worker count")
  const two = [1, 2]
  expect(takeParallelPathReadyBatch(two, routes, 4)).toEqual([1])
  expect(two).toEqual([2])
  const medium = Array.from({ length: 12 }, () => routeWithPoints(32))
  expect(takeParallelPathReadyBatch(medium.map((_, index) => index), medium, 1)).toEqual([0, 1, 2, 3])
})
