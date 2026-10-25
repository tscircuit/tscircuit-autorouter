import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("the finite pool combines distinct donor geometry after an incompatible pool remains UNKNOWN", (): void => {
  const a = columnRoute("a", [{ x: -4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }])
  const b = columnRoute("b", [{ x: 0, y: -4, z: 0 }, { x: 0, y: 4, z: 0 }])
  const alternative = columnRoute("a", [
    { x: -4, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, { x: -3, y: 0, z: 1 },
    { x: 3, y: 0, z: 1 }, { x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 },
  ], [{ x: -3, y: 0 }, { x: 3, y: 0 }])
  const pool = columnPool([a, b])
  pool.offerRoute(a, "priority")
  pool.offerRoute(b, "native")
  expect(pool.solvedRoutes).toBeUndefined()
  expect(pool.params.diagnostics.routeColumnFinitePoolUnknown).toBe(1)
  expect(pool.exhausted).toBe(false)
  pool.offerRoute(alternative, "a01")
  expect(pool.solvedRoutes).toHaveLength(2)
  expect(pool.solvedRoutes![0]!.route).toEqual(alternative.route)
  expect(pool.solvedRoutes![1]!.route).toEqual(b.route)
  expect(pool.params.diagnostics.routeColumnCrossDonorSolutions).toBe(1)
  alternative.route[1]!.y = 3
  expect(pool.solvedRoutes![0]!.route[1]!.y).toBe(0)
  expect(pool.workUnits).toBeLessThanOrEqual(pool.workLimit)
})
