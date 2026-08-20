import { expect, test } from "bun:test"
import stageInput from "../../fixtures/bug-reports/bugreport95-mangopi-r3c-high-density-timeout/bugreport95-mangopi-r3c-high-density-timeout.input.json" with {
  type: "json",
}

test.skip("bugreport95 completes the captured MangoPi high-density stage", async () => {
  const [{ ConnectivityMap }, { HighDensitySolver }] = await Promise.all([
    import("circuit-json-to-connectivity-map"),
    import("lib/solvers/HighDensitySolver/HighDensitySolver"),
  ])
  const { connMapNetMap, ...solverParams } = stageInput.solverParams as any
  const solver = new HighDensitySolver({
    ...solverParams,
    connMap: new ConnectivityMap(connMapNetMap),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
