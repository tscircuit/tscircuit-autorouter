import { expect, test } from "bun:test"
import { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import {
  createPipeline9ViaCoalescenceFixture,
  getPipeline9ViaCoalescenceInput,
} from "../fixtures/pipeline9-via-coalescence-fixture"

test("does not move a via owned by an immutable preloaded trace", (): void => {
  const fixture = createPipeline9ViaCoalescenceFixture()
  const fixedRoute = fixture.routes.pop()!
  fixture.srj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "preloaded_branch",
      connection_name: fixedRoute.connectionName,
      route: convertHdRouteToSimplifiedRoute(fixedRoute, 2, {
        defaultViaHoleDiameter: 0.2,
      }),
    },
  ]
  const originalRoutes = structuredClone(fixture.routes)
  const originalPreloads = structuredClone(fixture.srj.traces)
  const input = getPipeline9ViaCoalescenceInput(fixture, [fixedRoute])
  expect(input.prepareReference(input.routes).errors).toHaveLength(1)
  const solver = new Pipeline9FinalViaMergeSolver(input)
  solver.solve()
  const result = solver.getResult()
  expect(result.repaired).toBe(false)
  expect(result.attempted).toBe(false)
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.routes).toEqual(originalRoutes)
  expect(fixture.srj.traces).toEqual(originalPreloads)
})
