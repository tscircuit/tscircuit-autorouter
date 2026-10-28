import { expect, test } from "bun:test"
import { CertifiedDirectAutoroutingPipelineSolver } from "lib/testing/CertifiedDirectAutoroutingPipelineSolver"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("genuine preloaded copper is retained in the original general solver rather than discarded by a fast path", () => {
  const input = getCertifiedDirectTestInput()
  input.traces = [{ type: "pcb_trace", pcb_trace_id: "user_trace", connection_name: "signal", route: [
    { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.2 },
    { route_type: "wire", x: -0.5, y: 0, layer: "top", width: 0.2 },
  ] }]
  const before = JSON.stringify(input)
  const solver = new CertifiedDirectAutoroutingPipelineSolver(input, { cacheProvider: null })
  expect(solver.selectedStrategy).toBe("pipeline9")
  expect(solver.pipeline9!.srj.traces).toEqual(input.traces)
  expect(solver.pipeline9!.iterations).toBe(0)
  expect(solver.selection.eligible).toBe(false)
  expect(JSON.stringify(input)).toBe(before)
})
