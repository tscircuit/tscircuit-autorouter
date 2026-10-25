import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("fixed-copper screening expands to actual donor wire widths beyond the minimum-size node envelope", (): void => {
  const a = columnRoute("a", [{ x: -6, y: 5.8, z: 0 }, { x: 6, y: 5.8, z: 0 }])
  const b = columnRoute("b", [{ x: -4, y: -4, z: 0 }, { x: 4, y: -4, z: 0 }])
  const physical = { obstacles: [{ type: "rect" as const, center: { x: 0, y: 7.5 },
    width: 0.2, height: 0.2, layers: ["top"], __zLayers: [0], connectedTo: [] }] }
  for (const perPoint of [false, true]) {
    const wide = { ...a, traceThickness: perPoint ? 0.1 : 4,
      route: a.route.map((point) => ({ ...point, ...(perPoint ? { traceThickness: 4 } : {}) })) }
    const pool = columnPool([a, b], physical)
    pool.offerRoute(a, "native")
    expect(pool.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
    pool.offerRoute(wide, "a01")
    expect(pool.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
    expect(pool.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  }
})
