import { expect, test } from "bun:test"
import { BusLayerRoutingSolver } from "lib/solvers/BusLayerRoutingSolver"
import { createBusLayerInput } from "../fixtures/bus-layer-input"
import { createBusLayerHdRoute } from "../fixtures/createBusLayerHdRoute"

test("bus layer routing reports an exhausted search without throwing or publishing incomplete copper", (): void => {
  const srj = createBusLayerInput()
  const routes = [createBusLayerHdRoute()]
  const original = structuredClone(routes)
  const solver = new BusLayerRoutingSolver({ srj, hdRoutes: routes, effort: 0.000001 })
  expect(() => solver.solve()).not.toThrow()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.accepted).toBe(false)
  expect(solver.stats.pathSearchCalls).toBeGreaterThan(0)
  expect(solver.stats.unresolvedSpanCount).toBeGreaterThan(0)
  expect(solver.stats.busLayerViolationsAfter).toBe(1)
  expect(solver.getOutput()).toEqual(original)
  expect(routes).toEqual(original)
})
