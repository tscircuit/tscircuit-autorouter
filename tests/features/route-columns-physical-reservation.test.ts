import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("physical helper work and outline scans are prepaid and budget exhaustion stays UNKNOWN", (): void => {
  const a = columnRoute("a", [{ x: -0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }])
  const b = columnRoute("b", [{ x: -0.5, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0 }])
  let inspectedVertices = 0
  const outline = new Proxy(Array.from({ length: 1000 }, (_, index) => ({
    x: Math.cos(index * Math.PI / 500) * 3, y: Math.sin(index * Math.PI / 500) * 2,
  })), { get(target, key, receiver) {
    if (typeof key === "string" && /^\d+$/.test(key)) inspectedVertices++
    return Reflect.get(target, key, receiver)
  } })
  const pool = columnPool([a, b], { workLimit: 1000,
    boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, outline } })
  pool.offerRoute(a, "native")
  expect(inspectedVertices).toBe(0)
  expect(pool.exhausted).toBe(true)
  expect(pool.workUnits).toBeLessThanOrEqual(1000)
  expect(pool.params.diagnostics.routeColumnBudgetUnknown).toBe(1)
  expect(pool.params.diagnostics.routeColumnRejectedStatic).toBeUndefined()
  expect(pool.solvedRoutes).toBeUndefined()
  const short = columnPool([a, b], { workLimit: 20 })
  short.offerRoute(a, "native")
  expect(short.exhausted).toBe(true)
  expect(short.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(0)
  expect(short.workUnits).toBeLessThanOrEqual(short.workLimit)
})
