import { expect, test } from "bun:test"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import { krtTestBoard } from "./krtTestBoard"

test("direct backend produces an originally accepted multi-terminal board through its actual WASM selection", (): void => {
  const original = krtTestBoard()
  const before = structuredClone(original)
  const solver = new KrtAutoroutingPipelineSolver(original)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)
  expect(solver.krtAutorouterSolver?.stats.gridStep).toBe(0.1)
  expect(original).toEqual(before)
  expect(solver.getOutputSimpleRouteJson().connections).toEqual(before.connections)
  expect(solver.getOutputSimpleRouteJson().outline).toEqual(before.outline)
})
