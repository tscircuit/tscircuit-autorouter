import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("setup, donor conversion and compatibility searches obey a deterministic budget and never infer physical UNSAT", (): void => {
  const a = columnRoute("a", [{ x: -4, y: -1, z: 0 }, { x: 4, y: -1, z: 0 }])
  const b = columnRoute("b", [{ x: -4, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }])
  for (const workLimit of [0, 1, 4, 8, 25, 50, 100, 200, 1_000]) {
    const pool = columnPool([a, b], { workLimit })
    let converted = 0
    pool.captureGridOutput(10, () => { converted++; return [a] }, "a01")
    pool.offerRoute(b, "native")
    expect(pool.workUnits).toBeLessThanOrEqual(workLimit)
    expect(pool.params.diagnostics.routeColumnWorkUnits ?? 0).toBe(pool.workUnits)
    expect(pool.params.diagnostics.routeColumnPreflightWorkUnits).toBeLessThanOrEqual(4096)
    if (workLimit < 18) expect(converted).toBe(0)
    if (!pool.solvedRoutes) expect(pool.exhausted).toBe(true)
    const spent = pool.workUnits
    pool.offerRoute(a, "native")
    if (pool.exhausted) expect(pool.workUnits).toBe(spent)
  }
  const tree = columnPool([a, b], { nodeWithPortPoints: {
    ...columnPool([a, b]).params.nodeWithPortPoints,
    portPoints: [...columnPool([a, b]).params.nodeWithPortPoints.portPoints,
      { x: 0, y: 2, z: 0, connectionName: "a", rootConnectionName: "a" }],
  } })
  expect(tree.eligible).toBe(false)
  tree.offerRoute(a, "native")
  expect(tree.solvedRoutes).toBeUndefined()
})
