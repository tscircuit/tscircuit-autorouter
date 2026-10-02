import {
  NegotiateTraceClearanceSolver,
  negotiateTraceClearance,
  type NegotiatedClearanceInput,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { negotiationInput } from "../fixtures/repair04StepFixtures"

test("negotiation reserves enough child steps for fixed copper setup within a tiny search budget", (): void => {
  const route = negotiationInput.routes[0]!
  const input: NegotiatedClearanceInput = {
    ...negotiationInput,
    routes: [route],
    maxPathSearchNodes: 1,
    maxPathSearchCalls: 1,
    srj: {
      ...negotiationInput.srj,
      obstacles: [],
      traces: Array.from({ length: 10_000 }, (_, index) => ({
        type: "pcb_trace",
        pcb_trace_id: `preloaded_${index}`,
        connection_name: route.connectionName,
        route: [
          { route_type: "wire", x: -4.5, y: 0, layer: "top", width: 0.1 },
          { route_type: "wire", x: 4.5, y: 0, layer: "top", width: 0.1 },
        ],
      })),
    },
  }
  const solver = new NegotiateTraceClearanceSolver(input)
  const originalLimit = solver.MAX_ITERATIONS
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBeGreaterThan(originalLimit)
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(originalLimit)
  expect(solver.getOutput()).toEqual(negotiateTraceClearance(input))
  expect(solver.getOutput().pathSearchCalls).toBe(1)
  expect(solver.getOutput().pathSearchNodes).toBe(0)
  expect(solver.getOutput().unresolvedSpanCount).toBe(0)
})
